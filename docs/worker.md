# 백그라운드 워커·작업 큐

> 관련 문서: [데이터 모델](./data-model.md) · [4단 파이프라인](./pipeline.md) · [추출기(Extractor)](./extractors.md)

추출 파이프라인은 무겁다. 한 채용 라운드에 지원자가 수십 명, 지원자 한 명이 학위논문·대표연구실적·학술논문·구글스칼라까지 여러 PDF를 첨부하고, 각 문서마다 LLM/VLM 호출이 일어난다. 이 작업을 HTTP 요청 안에서 동기로 돌리면 사용자는 브라우저 앞에서 몇 분을 기다리게 되고, 그 사이 게이트웨이·리버스 프록시·`fetch` 타임아웃이 먼저 끊어진다. Minesweeper 는 이를 **업로드 트랜잭션과 추출 트랜잭션을 분리**해서 해결한다. API 핸들러는 `jobs` 테이블에 한 줄을 적고 즉시 응답하고, 별도 프로세스인 **백그라운드 워커**가 그 줄을 집어 파이프라인을 돌린다.

이 문서는 `src/worker/` 세 파일과 `src/db/schema.ts` 의 `jobs` / `review_flags` 정의를 기준으로 워커의 동작을 설명한다.

```
src/worker/
├── queue.ts     # jobs 테이블 CRUD: enqueue / claim / complete / fail
├── process.ts   # processApplicant: runPipeline 실행 + 원자적 DB 교체
└── index.ts     # runWorkerTick(단건) + 폴링 루프 main()
```

---

## 1. 왜 워커를 분리하는가

| 동기(요청-안-추출) | 비동기(워커 분리) |
| --- | --- |
| 업로드 응답이 추출 완료까지 블록 | 업로드는 job 한 줄 쓰고 즉시 200 |
| 지원자 N명 × PDF M개 × LLM 호출 → 분 단위 지연 | 사용자 대기 시간은 job insert 한 번 |
| HTTP/프록시 타임아웃에 그대로 노출 | 타임아웃과 무관, 워커가 자기 페이스로 처리 |
| 동시 요청이 LLM 백엔드를 동시에 두드림 | 단일 워커가 하나씩(single-worker) 직렬 처리 |
| 실패 시 재시도하려면 사용자가 재업로드 | job 이 DB에 남아 있어 재실행 가능 |

핵심 원리는 README 의 4단 파이프라인 설계와 같다. 무거운 일(추출)을 가벼운 일(업로드)에서 떼어내고, 그 사이의 인터페이스를 **DB 테이블 한 장(`jobs`)** 으로 둔다. 큐가 외부 메시지 브로커가 아니라 같은 libsql DB의 한 테이블이라는 점이 중요하다. 별도 인프라가 필요 없고, 워커가 죽어도 큐는 그대로 보존된다.

추출기 자체는 pluggable 하다(stub / vlm). 워커는 어떤 추출기를 쓰는지 신경 쓰지 않고 `runPipeline` 만 호출한다 — 자세한 내용은 [extractors.md](./extractors.md) 참고.

---

## 2. `jobs` 테이블 모델과 상태머신

`src/db/schema.ts` 의 `jobs` 정의:

```ts
export interface JobPayload {
  applicantId: string;
}

/** Background batch queue. The worker polls this table. */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey().$defaultFn(uuid),
  type: text('type').notNull().default('process_applicant'),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  payload: text('payload', { mode: 'json' }).$type<JobPayload>().notNull(),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

`JobStatus` 는 `src/lib/domain.ts` 에서 네 가지로 고정된다:

```ts
export const JOB_STATUSES = ['queued', 'running', 'done', 'error'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
```

### 컬럼 의미

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | `text` PK | `crypto.randomUUID()` |
| `type` | `text` (기본 `'process_applicant'`) | 현재 한 종류뿐, 향후 job 종류 확장을 위한 자리 |
| `status` | `JobStatus` (기본 `'queued'`) | 상태머신의 현재 상태 |
| `payload` | JSON `{ applicantId }` | 어떤 지원자를 처리할지 |
| `progress` | `integer` (기본 0) | 0~100. 완료 시 100으로 마킹 |
| `attempts` | `integer` (기본 0) | claim 될 때마다 +1 (재시도 카운터) |
| `error` | `text` nullable | 실패 시 에러 메시지, 성공 시 `null` 로 클리어 |
| `createdAt` | timestamp | 큐 정렬 키(FIFO) |
| `updatedAt` | timestamp | 모든 상태 전이에서 갱신 |

### 상태머신

```
                 enqueueApplicant
                       │
                       ▼
                 ┌──────────┐
                 │  queued  │  ◀── insert (status='queued', progress=0)
                 └────┬─────┘
        claimNextJob  │  attempts += 1, updatedAt = now
                      ▼
                 ┌──────────┐
                 │ running  │
                 └──┬────┬──┘
       completeJob  │    │  failJob
   progress=100     │    │  error=<message>
   error=null       │    │
                    ▼    ▼
              ┌──────┐  ┌───────┐
              │ done │  │ error │
              └──────┘  └───────┘
```

상태 전이는 모두 `queue.ts` 의 함수 한 개당 하나씩 대응한다. `done`/`error` 는 종료 상태다. `error` 가 자동으로 `queued` 로 되돌아가는 재큐잉 로직은 없다 — `attempts` 컬럼이 준비돼 있어 재시도 정책을 붙일 자리는 있지만, 현재 구현은 단일 시도 후 종료다. 실패한 job 을 다시 돌리려면 같은 지원자로 `enqueueApplicant` 를 한 번 더 호출하면 된다(`processApplicant` 가 idempotent 하므로 안전 — 5절 참고).

---

## 3. `queue.ts` — 큐 연산 4종

모든 함수가 첫 인자로 `DB`(libsql/Drizzle 핸들)를 받는다. 전역 싱글턴을 잡지 않으므로 테스트에서 임시 인메모리 DB를 주입할 수 있다.

```ts
/** Insert a process-applicant job. Returns the new job id. */
export async function enqueueApplicant(db: DB, applicantId: string): Promise<string>

/** Atomically-ish claim the oldest queued job (single-worker model) and mark it running. */
export async function claimNextJob(db: DB): Promise<Job | null>

export async function completeJob(db: DB, id: string, progress = 100): Promise<void>

export async function failJob(db: DB, id: string, error: string): Promise<void>
```

### `enqueueApplicant`

업로드 API 가 호출하는 진입점. `crypto.randomUUID()` 로 id 를 만들고 `status: 'queued'`, `progress: 0`, `payload: { applicantId }` 로 한 줄을 insert 한 뒤 그 id 를 돌려준다. API 핸들러는 이 id 만 받고 즉시 응답할 수 있다.

### `claimNextJob`

워커가 다음에 처리할 일을 집는 연산.

1. `status = 'queued'` 인 행을 `createdAt` 오름차순으로 **1개**만 select (`limit(1)`) → 가장 오래된 것부터, 즉 FIFO.
2. 없으면 `null` 반환.
3. 있으면 `attempts + 1`, `status: 'running'`, `updatedAt: now` 로 update.
4. 메모리상에서 갱신된 필드를 합쳐 `{ ...job, status: 'running', attempts }` 를 반환.

함수 주석에 적힌 "Atomically-ish" 가 핵심 가정이다. select-then-update 가 단일 트랜잭션으로 묶여 있지 않으므로 엄밀한 원자성은 없지만, **단일 워커(single-worker) 모델**을 전제하기 때문에 두 워커가 같은 job 을 동시에 집는 경쟁이 발생하지 않는다. 워커를 여러 개로 늘리려면 이 부분을 `SELECT ... FOR UPDATE` 류나 조건부 update 로 강화해야 한다.

### `completeJob`

`status: 'done'`, `progress`(기본 100), `error: null`, `updatedAt: now`. 이전 시도에서 남았을 수 있는 `error` 를 명시적으로 클리어한다.

### `failJob`

`status: 'error'`, `error: <message>`, `updatedAt: now`. `progress` 는 건드리지 않는다(어디까지 진행됐는지 보존).

---

## 4. `runWorkerTick` 와 폴링 루프

`src/worker/index.ts` 는 두 층으로 나뉜다: **테스트 가능한 단건 처리 함수**와 그것을 무한 반복하는 **폴링 루프**.

### 단건: `runWorkerTick`

```ts
/** Process at most one queued job. Returns the job id processed, or null if the queue is empty. */
export async function runWorkerTick(db: DB, extractor?: Extractor): Promise<string | null> {
  const job = await claimNextJob(db);
  if (!job) return null;
  try {
    await processApplicant(db, job.payload.applicantId, extractor);
    await completeJob(db, job.id);
  } catch (err) {
    await failJob(db, job.id, err instanceof Error ? err.message : String(err));
  }
  return job.id;
}
```

이 함수가 워커의 "한 틱"이다. job 을 하나 claim → `processApplicant` 실행 → 성공이면 `completeJob`, 예외면 `failJob`. 큐가 비면 `null` 을 돌려준다. `try/catch` 로 예외를 흡수하기 때문에 한 job 의 실패가 루프를 죽이지 않는다.

`extractor` 인자가 옵션이라는 점이 테스트에 중요하다. 테스트는 인메모리 DB와 stub extractor 를 주입해 외부 LLM 없이 `runWorkerTick(db, stubExtractor)` 한 번으로 전 과정을 검증할 수 있다. 생략하면 `processApplicant` → `runPipeline` 이 env(`EXTRACTOR_MODE`) 기준으로 추출기를 고른다([extractors.md](./extractors.md)).

### 루프: `main`

```ts
async function main(): Promise<void> {
  const db = getDb();
  const interval = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
  const mode = process.env.EXTRACTOR_MODE ?? 'stub';
  console.log(`[worker] polling every ${interval}ms (extractor=${mode})`);
  for (;;) {
    const id = await runWorkerTick(db);
    if (id) {
      console.log(`[worker] processed job ${id}`);
    } else {
      await sleep(interval);
    }
  }
}
```

폴링 동작:

- `WORKER_POLL_INTERVAL_MS`(기본 **2000ms**) 마다 큐를 확인한다.
- job 이 있었으면(`id` 반환) **바로** 다음 틱으로 — 즉 큐가 밀려 있을 때는 sleep 없이 연속 처리(busy-drain).
- 큐가 비었으면 그때만 `interval` 만큼 sleep 한다.

```
┌──────────────┐   job 있음    ┌───────────────────┐
│ runWorkerTick│ ───────────▶ │ 즉시 다음 틱(no sleep)│
└──────┬───────┘              └───────────────────┘
       │ 큐 빔(null)
       ▼
  sleep(WORKER_POLL_INTERVAL_MS) ──┐
       ▲                           │
       └───────────────────────────┘
```

마지막의 가드는 이 파일이 **CLI로 직접 실행될 때만** `main()` 을 돌리기 위한 것이다:

```ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

`import` 로 가져올 때(테스트/다른 모듈)는 루프가 시작되지 않는다. 그래서 같은 파일이 `enqueueApplicant`/`processApplicant` 재노출(re-export)도 겸할 수 있다:

```ts
export { enqueueApplicant } from './queue';
export { processApplicant } from './process';
```

---

## 5. `processApplicant` — 파이프라인 실행과 원자적 교체

`src/worker/process.ts` 의 본체. 시그니처:

```ts
export async function processApplicant(
  db: DB,
  applicantId: string,
  extractor?: Extractor,
): Promise<void>
```

### 단계 1: 입력 수집과 파이프라인 실행

1. `applicants` 에서 지원자 한 명을 조회. 없으면 `throw new Error('applicant not found: ...')` → 호출자(`runWorkerTick`)가 `failJob` 으로 받는다.
2. 그 지원자의 모든 `documents` 를 조회.
3. 각 문서를 `PipelineFile` 로 매핑(`filepath`, `folderCategory`, `documentId`)한 뒤 `runPipeline` 호출:

```ts
const result = await runPipeline(files, { applicantName: applicant.name, extractor });
```

`applicantName` 을 넘기는 이유는 파이프라인이 **지원자 본인을 추출 결과에서 식별/제외**하기 위해서다(`isSelf`). 4단 파이프라인의 입출력은 [pipeline.md](./pipeline.md) 참고.

### 단계 2: `db.transaction` 으로 원자적 교체 (idempotent)

`runPipeline` 결과를 DB에 적재할 때 **이 지원자의 기존 결과를 먼저 지우고 새로 넣는다**. 전부 하나의 `db.transaction` 안에서 일어나므로, 중간에 실패하면 전체가 롤백되고 직전 상태가 그대로 남는다 — roster 가 절반만 재구성되는 일이 없다. 같은 job 을 다시 돌려도 결과가 누적되지 않으므로 **idempotent** 하다.

```ts
await db.transaction(async (tx) => {
  // (a) 기존 결과 삭제
  for (const d of docs) {
    await tx.delete(extractedPersons).where(eq(extractedPersons.documentId, d.id));
  }
  await tx.delete(personAggregates).where(eq(personAggregates.applicantId, applicantId));
  await tx.delete(reviewFlags).where(eq(reviewFlags.applicantId, applicantId));

  // (b) 문서 메타 갱신 + extracted_persons / review_flags 적재
  // (c) person_aggregates 적재
});
```

삭제 순서와 범위:

| 테이블 | 삭제 기준 |
| --- | --- |
| `extracted_persons` | 지원자의 각 문서 id 별로 |
| `person_aggregates` | `applicantId` 기준 |
| `review_flags` | `applicantId` 기준 |

### 단계 3: 문서 메타 갱신과 person 적재

문서별로 `runPipeline` 이 1단(Ingest)/3단(Type)에서 채운 메타를 documents 행에 되쓴다 — `docType`, `sourceFormat`(`doc.ingest.format`), `pageCount`, `hasTextLayer`.

그다음 추출된 사람 각각을 `extracted_persons` 에 insert 한다. 이 때 이름은 세 가지 형태로 저장된다:

```ts
nameRaw: p.nameRaw,
nameNormalized: normalizeName(p.nameRaw),
nameInitials: initialsForm(p.nameRaw),
```

그리고 사람 단위로 사람 손이 필요한지 판정한다:

```ts
const needsHuman = p.sourceKind !== 'printed' || p.confidence < HUMAN_REVIEW_CONFIDENCE;
```

`HUMAN_REVIEW_CONFIDENCE = 0.7`. 즉 **출력원이 인쇄가 아니거나(도장/손글씨/서명) 신뢰도가 0.7 미만**이면 사람 검토 대상이다. 이는 "자동추출은 초안, 최종판단은 사람"이라는 원칙을 코드로 박아둔 것이다.

### 단계 4: `flagForKind` — person-level 플래그

같은 함수 파일 상단의 분류기가 사람 한 명을 검토 필요 큐(`review_flags`)에 올릴지 결정한다:

```ts
function flagForKind(sourceKind: SourceKind, confidence: number): FlagType | null {
  if (sourceKind === 'seal') return 'seal';
  if (sourceKind === 'handwritten') return 'handwriting';
  if (sourceKind === 'signature') return 'signature';
  if (confidence < HUMAN_REVIEW_CONFIDENCE) return 'low_confidence';
  return null;
}
```

`SourceKind` → `FlagType` 매핑 (둘 다 `src/lib/domain.ts` 의 union):

| `sourceKind` | → `flagType` | 한국어 라벨 |
| --- | --- | --- |
| `seal` | `seal` | 도장 |
| `handwritten` | `handwriting` | 손글씨 |
| `signature` | `signature` | 서명 |
| `printed` (단 `confidence < 0.7`) | `low_confidence` | 저신뢰 |
| `printed` (`confidence ≥ 0.7`) | `null` (플래그 없음) | — |

판정 우선순위는 위에서 아래로다 — `sourceKind` 가 인쇄가 아니면 그 종류 플래그가 먼저 붙고, 인쇄일 때만 신뢰도로 `low_confidence` 를 본다. 반환이 `null` 이 아니면 `review_flags` 에 `personId`/`applicantId`/`documentId` 와 함께 `status: 'open'` 으로 insert 한다.

> 참고: `FLAG_TYPES` union 에는 `ambiguous`(동명이인/약어) 도 있지만, 워커의 `flagForKind` 는 이를 생성하지 않는다. `ambiguous` 는 다른 경로(집계/리뷰)에서 쓰이는 값이다.

### 단계 5: `needs_vision` — document-level 플래그

사람 단위 플래그와 달리, **문서가 비전 판독을 요구하는데 추출된 사람이 0명**이면 문서 레벨로 플래그를 단다:

```ts
const needsVision =
  doc.ingest.format === 'image' ||
  doc.ingest.format === 'hwp' ||
  (doc.ingest.format === 'pdf' && !doc.ingest.hasTextLayer);
if (needsVision && doc.persons.length === 0) {
  await tx.insert(reviewFlags).values({
    applicantId,
    documentId: doc.documentId,
    flagType: 'needs_vision',
    label: doc.ingest.note ?? null,
    status: 'open',
  });
}
```

즉 텍스트 레이어가 없는 스캔 PDF, 이미지, HWP 처럼 텍스트로 뽑아낼 게 없는데 stub 추출기로는 이름을 못 건진 문서를 "사람이/비전으로 봐야 함"으로 표시한다. `label` 에는 ingest 단계의 메모(`doc.ingest.note`)를 그대로 넣어 검토자가 맥락을 본다. 이 플래그는 `personId` 가 없는 review_flag 다(아래 표 참고).

### 단계 6: `person_aggregates` 적재

마지막으로 4단(Aggregate) 결과를 지원자 단위로 적재한다. `canonicalName`, `nameNormalized`, `roles`(JSON `Role[]`), `sources`(JSON `SourceRef[]`), `affiliation`, `isSelf`, `needsHuman`, `finalStatus: 'pending'`. 이 테이블이 리뷰 UI 가 읽는 "지원자별 이해충돌 관계자 명단"이다.

### `review_flags` 의 두 형태

`src/db/schema.ts` 주석대로 review_flag 는 두 가지 형태를 가진다 — `personId` 와 `documentId` 둘 다 nullable 이라 가능한 구조다:

```ts
// Either a person-level flag (seal/handwriting/...) or a document-level flag (needs_vision).
personId: text('person_id').references(() => extractedPersons.id, { onDelete: 'cascade' }),
documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
applicantId: text('applicant_id').notNull()...,
```

| 형태 | `personId` | `documentId` | `flagType` | 생성 위치 |
| --- | --- | --- | --- | --- |
| person-level | 있음 | 있음 | `seal`/`handwriting`/`signature`/`low_confidence` | `flagForKind` |
| document-level | 없음(`null`) | 있음 | `needs_vision` | needsVision 분기 |

자세한 컬럼 정의와 관계는 [data-model.md](./data-model.md) 를 참고하라.

---

## 6. 실행법

### 워커만 단독 실행

```bash
npm run worker
# => tsx src/worker/index.ts
```

env 로 동작을 조절한다:

| 환경변수 | 기본값 | 의미 |
| --- | --- | --- |
| `WORKER_POLL_INTERVAL_MS` | `2000` | 큐가 비었을 때 폴링 간격(ms) |
| `EXTRACTOR_MODE` | `stub` | 추출기 선택. `vlm` 이면 온프레 Ollama 사용 → [extractors.md](./extractors.md) |

기동 시 한 줄을 찍는다: `[worker] polling every 2000ms (extractor=stub)`. job 을 하나 끝낼 때마다 `[worker] processed job <id>` 를 찍는다.

### 웹 + 워커 동시 실행 (개발)

```bash
npm run dev:all
# => concurrently -n web,worker -c blue,green "next dev" "tsx watch src/worker/index.ts"
```

`concurrently` 로 Next dev 서버(파란색 `web`)와 워커(초록색 `worker`)를 한 터미널에 띄운다. 워커 쪽은 `tsx watch` 라 소스를 고치면 자동 재시작된다. 업로드 → 큐 적재 → 추출 → 리뷰 화면 반영까지 로컬에서 한 번에 돌려볼 수 있는 표준 개발 명령이다.

### 전형적인 흐름

```
[업로드 API]  enqueueApplicant(db, applicantId)  ──▶  jobs (queued)
                                                        │
[워커 루프]   runWorkerTick → claimNextJob ────────────┘ (running)
                            → processApplicant
                                 runPipeline (Ingest→Type→Extract→Aggregate)
                                 db.transaction: 삭제 후 재적재
                                   extracted_persons / review_flags / person_aggregates
                            → completeJob (done)   또는   failJob (error)
```

자동 추출 결과는 어디까지나 초안이다. `needsHuman`/`review_flags`/`finalStatus: 'pending'` 이 가리키는 모든 항목은 사람이 최종 확인한다 — 시스템은 절대 이름을 지어내지 않고, 불확실하면 플래그를 달아 사람에게 넘긴다.
