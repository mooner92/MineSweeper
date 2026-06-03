# API 레퍼런스

Minesweeper 의 HTTP API 는 Next.js 14 App Router 의 Route Handler(`src/app/api/**/route.ts`)로
구현되어 있습니다. 모든 라우트는 다음 두 줄을 명시해 **Node.js 런타임** 에서 **요청마다 동적으로**
실행됩니다(파일 I/O · DB · 백그라운드 큐 적재가 필요하므로 Edge 런타임이나 정적 캐시는 쓰지 않습니다).

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

- `runtime = 'nodejs'` — `node:fs` · `@libsql/client` · `adm-zip` · `exceljs` 등 Node 전용 모듈을 사용.
- `dynamic = 'force-dynamic'` — 업로드/조회/내보내기는 매 요청 결과가 달라지므로 캐시를 강제로 끔.

이 시스템의 대원칙은 **"자동추출은 초안, 최종판단은 사람"** 입니다. 따라서 쓰기 계열 API(`/api/persons`)는
사람이 내린 결정을 기록하고 그 이력(`corrections`)을 남기는 데 초점이 맞춰져 있습니다.

관련 문서: [데이터 모델](./data-model.md) · [검토 UI](./ui.md) · [보안](./security.md)

---

## 엔드포인트 한눈에 보기

| 메서드 | 경로 | 입력 | 출력 | 용도 |
|---|---|---|---|---|
| `POST` | `/api/upload` | `multipart/form-data` (zip) | JSON | 지원자 zip 업로드 → applicant·documents 생성 + job enqueue |
| `GET` | `/api/status/[applicantId]` | 경로 파라미터 | JSON | 백그라운드 job 상태·진행률·집계 수 조회 |
| `POST` | `/api/persons/[id]` | JSON | JSON | 집계된 관계자에 대한 사람의 검토 결정 적용 |
| `GET` | `/api/export/[applicantId]` | 경로 + `?format` | 파일(CSV/XLSX) | 최종 관계자 명단 내보내기 |
| `GET` | `/api/file/[documentId]` | 경로 파라미터 | 파일(원문 바이트) | 원본 문서 파일 서빙 |
| `GET` | `/api/review-queue/export` | `?flag` | 파일(CSV) | 검토 필요 큐 CSV 내보내기 |

처리 흐름상의 위치(4단 파이프라인 `Ingest→Type→Extract→Aggregate` 와의 관계)는 다음과 같습니다.

```
POST /api/upload ─▶ applicants + documents 행 생성 ─▶ enqueueApplicant() ─┐
                                                                          ▼
                                              jobs 테이블 (status=queued)  ── 워커가 폴링
                                                                          │  (4단 파이프라인)
GET /api/status/[applicantId] ◀── job.status / progress / aggregateCount ─┘
                                                                          ▼
                                              person_aggregates (검토 대상)
GET  /api/file/[documentId]        ── 원문 미리보기(검토 UI)
POST /api/persons/[id]             ── confirm/exclude/reject/edit (corrections 적재)
GET  /api/export/[applicantId]     ── 최종 명단(CSV/XLSX)
GET  /api/review-queue/export      ── 검토 필요 큐(CSV)
```

---

## `POST /api/upload`

지원자 한 명의 첨부서류 zip 을 업로드합니다. 압축을 풀어 폴더=카테고리 구조를 보존하면서 `documents`
행을 만들고, 백그라운드 처리 job 을 큐에 넣은 뒤 식별자들을 반환합니다.

소스: `src/app/api/upload/route.ts`

### 요청

- 메서드 / 경로: `POST /api/upload`
- 본문 형식: `multipart/form-data`
- 필드: `file` — zip 파일 1개. **반드시 `File` 인스턴스여야 함**. 없거나 타입이 아니면 `400`.

```ts
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'a zip file field "file" is required' }, { status: 400 });
  }
  ...
}
```

### 크기 제한

업로드 본문 크기는 환경변수로 제한합니다(기본 200 MiB). 초과 시 `413`.

```ts
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);
if (file.size > MAX_UPLOAD_BYTES) {
  return NextResponse.json(
    { error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` },
    { status: 413 },
  );
}
```

> 압축 해제 단계에는 **별도의 zip-bomb 방어**가 더 있습니다(`unzipApplicant`): 엔트리 수
> `MAX_ZIP_ENTRIES`(기본 5000), 비압축 총 크기 `MAX_ZIP_TOTAL_BYTES`(기본 500 MiB), 그리고
> zip-slip(추출 경로가 대상 디렉터리 밖으로 새는 경우) 검사. 자세한 내용은 [보안](./security.md) 참고.

### 동작

1. `applicantId = crypto.randomUUID()` 를 만들고 `UPLOAD_DIR/<applicantId>/`(기본 `./data/uploads`)에
   원본 zip 을 `upload.zip` 으로 저장.
2. `unzipApplicant(zipPath, extractDir)` 로 `files/` 아래에 풀고, 단일 최상위 폴더가 있으면 그것을
   `applicantFolder` 로 인식.
3. 지원자 이름 결정 — 폴더명이 `"<id> (<name>)"` 형식이면 `parseApplicantFolder(...).applicantName`,
   아니면 업로드 파일명에서 `.zip` 확장자를 제거한 값으로 폴백:

   ```ts
   const applicantName =
     (applicantFolder ? parseApplicantFolder(applicantFolder).applicantName : null) ??
     file.name.replace(/\.zip$/i, '');
   ```
4. `applicants` 행 1개 삽입(`{ id: applicantId, name: applicantName }`).
5. 풀린 파일마다 `detectFormat(filepath)` 로 `SourceFormat`(`pdf|image|hwp|text`)을 판정. **인식 못 하는
   확장자는 건너뜀**(`flatMap` 으로 빈 배열 반환). 인식된 파일만 `documents` 행으로 적재:

   ```ts
   const docRows: NewDocument[] = files.flatMap((f) => {
     const fmt = detectFormat(f.filepath);
     if (!fmt) return [];
     return [{
       applicantId,
       folderCategory: f.folderCategory,
       sourceFormat: fmt,
       filename: f.relativePath.split('/').pop() ?? f.relativePath,
       filepath: f.filepath,
     }];
   });
   if (docRows.length) await db.insert(documents).values(docRows);
   ```

   > 문서유형(`docType`)은 여기서 정하지 않습니다. 형식 차이는 1단(Ingest)에서만, 문서유형 차이는
   > 3단(Extract)에서만 다뤄지며, `docType` 의 기본값은 스키마상 `'unknown'` 입니다.
6. `enqueueApplicant(db, applicantId)` 로 `jobs` 테이블에
   `{ type: 'process_applicant', status: 'queued', payload: { applicantId } }` 행을 넣고 그 `jobId` 를 받음.

### 응답

`200`, JSON:

```json
{
  "applicantId": "0e2d6c3a-....",
  "jobId": "a91f...",
  "documentCount": 7
}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `applicantId` | `string` (UUID) | 새로 만든 지원자 id. 이후 status/export 호출에 사용 |
| `jobId` | `string` (UUID) | 큐에 적재된 처리 job id |
| `documentCount` | `number` | 적재된 `documents` 행 수(인식된 형식만 카운트) |

### 상태 코드

| 코드 | 조건 |
|---|---|
| `200` | 정상 |
| `400` | `file` 필드 누락 또는 `File` 아님 |
| `413` | `file.size > MAX_UPLOAD_BYTES` |

> 압축 해제 단계의 zip-bomb / zip-slip 위반은 `unzipApplicant` 가 `throw` 하므로, 처리되지 않은 예외로
> 표면화됩니다(명시적 4xx 매핑은 없음).

### curl 예시

```bash
curl -X POST http://localhost:3000/api/upload \
  -F 'file=@"0323-000001 (장선주).zip"'
# => {"applicantId":"...","jobId":"...","documentCount":7}
```

---

## `GET /api/status/[applicantId]`

지원자의 가장 최근 처리 job 상태와 진행률, 그리고 현재까지 만들어진 집계 인원 수를 반환합니다. 업로드
직후 폴링하여 처리 완료를 감지하는 용도입니다.

소스: `src/app/api/status/[applicantId]/route.ts`

### 요청

- 메서드 / 경로: `GET /api/status/[applicantId]`
- 경로 파라미터: `applicantId` — 업로드 시 받은 UUID.
- 본문/쿼리 파라미터: 없음.

### 동작

해당 `applicantId` 의 job 은 `jobs.payload`(JSON) 안에 들어 있으므로 SQLite 의 `json_extract` 로 조회하며,
`createdAt` 내림차순으로 가장 최신 1건만 가져옵니다.

```ts
const job =
  (
    await db
      .select()
      .from(jobs)
      .where(sql`json_extract(${jobs.payload}, '$.applicantId') = ${applicantId}`)
      .orderBy(desc(jobs.createdAt))
      .limit(1)
  )[0] ?? null;

const aggregates = await db
  .select({ id: personAggregates.id })
  .from(personAggregates)
  .where(eq(personAggregates.applicantId, applicantId));
```

### 응답

`200`, JSON:

```json
{
  "status": "running",
  "progress": 40,
  "error": null,
  "aggregateCount": 0
}
```

| 필드 | 타입 | 기본값(없을 때) | 의미 |
|---|---|---|---|
| `status` | `JobStatus` 또는 `'unknown'` | `'unknown'` | `queued` \| `running` \| `done` \| `error` (job 미존재 시 `'unknown'`) |
| `progress` | `number` | `0` | 0~100 진행률 |
| `error` | `string \| null` | `null` | job 이 `error` 일 때의 메시지 |
| `aggregateCount` | `number` | — | 해당 지원자의 `person_aggregates` 행 수 |

> `JobStatus` 값은 도메인에 `JOB_STATUSES = ['queued','running','done','error']` 로 정의되어 있습니다.
> 폴링 측은 `status === 'done'`(또는 `'error'`)을 종료 조건으로 사용합니다.

### 상태 코드

| 코드 | 조건 |
|---|---|
| `200` | 항상(job 이 없으면 `status:'unknown'` 으로 정상 응답) |

### curl 예시

```bash
curl http://localhost:3000/api/status/0e2d6c3a-....
# => {"status":"done","progress":100,"error":null,"aggregateCount":12}
```

---

## `POST /api/persons/[id]`

집계된 관계자(`person_aggregates` 한 행)에 대해 검토자가 내린 결정을 적용합니다. 이 결정은 최종
상태(`finalStatus`)와 표시 이름(`canonicalName`)을 갱신하고, **모든 변경을 `corrections` 감사 로그에
기록**합니다(향후 학습 데이터 + 정확도 추적용).

소스: `src/app/api/persons/[id]/route.ts`

### 요청

- 메서드 / 경로: `POST /api/persons/[id]`
- 경로 파라미터: `id` — `person_aggregates.id`(집계 행 id).
- 본문 형식: `application/json`

```ts
interface Body {
  action: 'confirm' | 'exclude' | 'reject' | 'edit';
  name?: string;
}
```

| 필드 | 타입 | 필수 | 의미 |
|---|---|---|---|
| `action` | `'confirm' \| 'exclude' \| 'reject' \| 'edit'` | 예 | 적용할 결정 |
| `name` | `string` | `edit` 일 때만 사용 | 새 표시 이름(`canonicalName`). 공백 트림 후 빈 값이면 기존 이름 유지 |

### 동작

먼저 대상 집계 행을 조회하고, 없으면 `404`. 있으면 `action` 에 따라 `finalStatus`/`canonicalName` 을
계산합니다.

```ts
let finalStatus: ReviewStatus = agg.finalStatus;
let canonicalName = agg.canonicalName;

if (body.action === 'confirm') {
  finalStatus = 'confirmed';
} else if (body.action === 'exclude' || body.action === 'reject') {
  finalStatus = 'rejected';
} else if (body.action === 'edit') {
  finalStatus = 'edited';
  canonicalName = body.name?.trim() || agg.canonicalName;
}
```

| `action` | 결과 `finalStatus` | `canonicalName` |
|---|---|---|
| `confirm` | `confirmed` | 변경 없음 |
| `exclude` | `rejected` | 변경 없음 |
| `reject` | `rejected` | 변경 없음 |
| `edit` | `edited` | `body.name`(트림) 또는 기존값 |

> `ReviewStatus = ['pending','confirmed','rejected','edited']`. `exclude` 와 `reject` 는 둘 다
> `rejected` 로 수렴합니다(둘은 의도/문구만 다르고 결과 상태는 같음).

이어서 `person_aggregates` 를 갱신하고 `corrections` 에 1행을 적재합니다.

```ts
await db
  .update(personAggregates)
  .set({ finalStatus, canonicalName })
  .where(eq(personAggregates.id, params.id));

const isEdit = body.action === 'edit';
await db.insert(corrections).values({
  applicantId: agg.applicantId,
  personId: agg.id,
  field: isEdit ? 'canonicalName' : 'finalStatus',
  oldValue: isEdit ? agg.canonicalName : agg.finalStatus,
  newValue: isEdit ? canonicalName : finalStatus,
  action: body.action === 'reject' ? 'reject' : body.action,
});
```

`corrections` 행의 기록 규칙:

| `action`(요청) | `corrections.field` | `oldValue` | `newValue` | `corrections.action` |
|---|---|---|---|---|
| `confirm` | `finalStatus` | 이전 `finalStatus` | `confirmed` | `confirm` |
| `exclude` | `finalStatus` | 이전 `finalStatus` | `rejected` | `exclude` |
| `reject` | `finalStatus` | 이전 `finalStatus` | `rejected` | `reject` |
| `edit` | `canonicalName` | 이전 `canonicalName` | 새 이름 | `edit` |

> `corrections.action` 컬럼은 `'confirm' \| 'edit' \| 'reject' \| 'exclude'` 를 받습니다. 위 코드에서
> `body.action === 'reject'` 만 명시적으로 `'reject'` 로 두고, 그 외(`confirm`/`exclude`/`edit`)는
> `body.action` 을 그대로 넘기므로 4종이 모두 보존됩니다.

### 응답

`200`, JSON:

```json
{ "ok": true, "finalStatus": "confirmed", "canonicalName": "장선주" }
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `ok` | `true` | 처리 성공 |
| `finalStatus` | `ReviewStatus` | 갱신된 최종 상태 |
| `canonicalName` | `string` | 갱신된 표시 이름 |

### 상태 코드

| 코드 | 조건 |
|---|---|
| `200` | 정상 적용 |
| `404` | `id` 에 해당하는 `person_aggregates` 행 없음 (`{ "error": "not found" }`) |

### curl 예시

```bash
# 확정
curl -X POST http://localhost:3000/api/persons/PERSON_ID \
  -H 'content-type: application/json' \
  -d '{"action":"confirm"}'

# 이름 수정
curl -X POST http://localhost:3000/api/persons/PERSON_ID \
  -H 'content-type: application/json' \
  -d '{"action":"edit","name":"홍길동"}'

# 제외(본인 등) / 거부
curl -X POST http://localhost:3000/api/persons/PERSON_ID \
  -H 'content-type: application/json' \
  -d '{"action":"exclude"}'
```

검토 UI 에서 이 엔드포인트가 어떻게 호출되는지는 [검토 UI](./ui.md), 기록되는 데이터 구조는
[데이터 모델](./data-model.md) 을 참고하세요.

---

## `GET /api/export/[applicantId]`

지원자의 **최종 관계자 명단**을 CSV 또는 XLSX 파일로 내려받습니다. **본인(`isSelf`)과
`rejected` 항목은 제외**됩니다.

소스: `src/app/api/export/[applicantId]/route.ts`

### 요청

- 메서드 / 경로: `GET /api/export/[applicantId]`
- 경로 파라미터: `applicantId`.
- 쿼리 파라미터: `format` — `csv`(기본) 또는 `xlsx`.

```ts
const format = new URL(req.url).searchParams.get('format') ?? 'csv';
```

### 동작

`person_aggregates` 에서 해당 지원자의 행을 모두 읽고, **본인과 거부 항목을 제외**한 뒤 `AggregatedPerson`
형태로 매핑합니다.

```ts
// Final roster excludes the applicant themself and rejected entries.
const visible: AggregatedPerson[] = rows
  .filter((r) => !r.isSelf && r.finalStatus !== 'rejected')
  .map((r) => ({
    canonicalName: r.canonicalName,
    nameNormalized: r.nameNormalized,
    roles: r.roles,
    sources: r.sources,
    affiliation: r.affiliation,
    isSelf: r.isSelf,
    needsHuman: r.needsHuman,
  }));
```

`format === 'xlsx'` 이면 `toXlsxBuffer(visible)` 로 워크북을, 그 외에는 `toCsv(visible)` 로 문자열을
만듭니다. 두 출력 모두 동일한 컬럼 셋(`@/lib/export` 의 `HEADERS`)을 사용합니다.

| 출력 컬럼 | 출처 | 비고 |
|---|---|---|
| `canonical_name` | `canonicalName` | 표시 이름 |
| `roles` | `roles` | `ROLE_LABELS_KO` 한글 라벨을 `, ` 로 결합 |
| `affiliation` | `affiliation` | 없으면 빈 문자열 |
| `sources` | `sources` | `"<docType 한글> p.<page>"` 를 `; ` 로 결합 |
| `needs_human` | `needsHuman` | `Y` / `N` |
| `is_self` | `isSelf` | `Y` / `N` (명단엔 본인이 제외되므로 보통 `N`) |

> CSV 는 Excel 에서 한글이 깨지지 않도록 **UTF-8 BOM(`﻿`) 으로 시작**합니다. XLSX 시트 이름은 `관계자`,
> 헤더 행은 굵게 표시됩니다.

### 응답

파일 다운로드(JSON 아님).

- `format=csv`:
  - `content-type: text/csv; charset=utf-8`
  - `content-disposition: attachment; filename="relations-<applicantId>.csv"`
- `format=xlsx`:
  - `content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `content-disposition: attachment; filename="relations-<applicantId>.xlsx"`

### 상태 코드

| 코드 | 조건 |
|---|---|
| `200` | 정상(데이터가 없어도 헤더만 있는 파일 반환) |

### curl 예시

```bash
# CSV
curl -OJ 'http://localhost:3000/api/export/0e2d6c3a-...?format=csv'

# XLSX
curl -OJ 'http://localhost:3000/api/export/0e2d6c3a-...?format=xlsx'
```

---

## `GET /api/file/[documentId]`

원본 문서 파일(PDF/이미지/텍스트)의 바이트를 그대로 서빙합니다. 검토 UI 에서 원문 미리보기에 사용합니다.

소스: `src/app/api/file/[documentId]/route.ts`

### 요청

- 메서드 / 경로: `GET /api/file/[documentId]`
- 경로 파라미터: `documentId` — `documents.id`.
- 본문/쿼리 파라미터: 없음.

### 동작

`documents` 에서 행을 조회하고, **DB 에 저장된 `filepath` 만 사용**해 파일을 읽습니다. 경로는 통제된
unzip 단계에서 설정되며, **사용자 입력으로부터 경로를 받지 않습니다**(경로 조작 방지).

```ts
const doc = (
  await db.select().from(documents).where(eq(documents.id, params.documentId)).limit(1)
)[0];
if (!doc) return new NextResponse('not found', { status: 404 });

// Path comes from the DB (set during a controlled unzip), never from user input.
const buf = await readFile(doc.filepath).catch(() => null);
if (!buf) return new NextResponse('file missing', { status: 404 });

const type = MIME[extname(doc.filepath).toLowerCase()] ?? 'application/octet-stream';
```

MIME 매핑은 확장자 기반이며, 미지원 확장자는 `application/octet-stream` 으로 폴백합니다.

| 확장자 | content-type |
|---|---|
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.webp` | `image/webp` |
| `.gif` | `image/gif` |
| `.bmp` | `image/bmp` |
| `.tif`, `.tiff` | `image/tiff` |
| `.pdf` | `application/pdf` |
| `.txt` | `text/plain; charset=utf-8` |
| 그 외 | `application/octet-stream` |

### 응답

파일 바이트.

- `content-type`: 위 표에 따른 값
- `cache-control: private, max-age=60`

### 상태 코드

| 코드 | 조건 |
|---|---|
| `200` | 파일 반환 |
| `404` | `documentId` 행 없음(`not found`) 또는 디스크에서 읽기 실패(`file missing`) |

### curl 예시

```bash
curl -o doc.pdf http://localhost:3000/api/file/DOCUMENT_ID
```

> 보안 메모: 이 라우트는 DB 의 `filepath` 만 신뢰하므로 임의 파일 읽기가 불가능합니다. 자세한 위협 모델은
> [보안](./security.md) 참고.

---

## `GET /api/review-queue/export`

전역 **검토 필요 큐**(도장·손글씨·서명·저신뢰·동명이인·비전판독 등 사람이 직접 확인해야 하는 항목)를 CSV 로
내보냅니다. flag 종류로 필터링할 수 있습니다.

소스: `src/app/api/review-queue/export/route.ts`

### 요청

- 메서드 / 경로: `GET /api/review-queue/export`
- 쿼리 파라미터: `flag`(선택) — `FlagType` 값으로 필터. 값:
  `seal | handwriting | signature | low_confidence | ambiguous | needs_vision`.

### 동작

`getReviewQueue()`(`@/lib/data`)로 `status='open'` 인 플래그를 applicant/document/person 과 조인해
가져온 뒤, `flag` 가 주어지면 해당 `flagType` 만 남깁니다.

```ts
const flag = new URL(req.url).searchParams.get('flag');
const all = await getReviewQueue();
const items = flag ? all.filter((it) => it.flag.flagType === flag) : all;
```

CSV 본문은 다음 컬럼을 가지며, UTF-8 BOM 으로 시작합니다.

```ts
const headers = ['applicant', 'flag_type', 'item', 'filename', 'document_id'];
```

| 출력 컬럼 | 값 |
|---|---|
| `applicant` | `applicantName ?? applicantId` |
| `flag_type` | `FLAG_TYPE_LABELS_KO[flagType]`(한글 라벨) — 없으면 원래 키 |
| `item` | `personName ?? ''` |
| `filename` | `filename ?? ''` |
| `document_id` | `documentId ?? ''` |

`flag_type` 한글 라벨 매핑(`FLAG_TYPE_LABELS_KO`):

| `flagType` | 라벨 |
|---|---|
| `seal` | 도장 |
| `handwriting` | 손글씨 |
| `signature` | 서명 |
| `low_confidence` | 저신뢰 |
| `ambiguous` | 동명이인/약어 |
| `needs_vision` | 비전 판독 필요 |

### 응답

CSV 파일.

- `content-type: text/csv; charset=utf-8`
- `content-disposition: attachment; filename="review-queue.csv"`

### 상태 코드

| 코드 | 조건 |
|---|---|
| `200` | 정상(항목이 없으면 헤더만) |

### curl 예시

```bash
# 전체 큐
curl -OJ http://localhost:3000/api/review-queue/export

# 도장만
curl -OJ 'http://localhost:3000/api/review-queue/export?flag=seal'

# 비전 판독 필요만
curl -OJ 'http://localhost:3000/api/review-queue/export?flag=needs_vision'
```

---

## 공통 사항

- **인증**: Phase 1 MVP 는 내부망 사용을 전제로 하며, 라우트 자체에는 인증 로직이 없습니다. 배치 전제와
  네트워크 격리에 대해서는 [보안](./security.md) 을 참고하세요.
- **에러 표현**: JSON 라우트는 `{ "error": "..." }` 형태로, 파일 라우트(`/api/file`)는 평문 텍스트로
  에러를 반환합니다.
- **DB 접근**: 모든 라우트는 `getDb()`(`@/db/client`, Drizzle + `@libsql/client`)를 통해 동일한 DB 에
  접근합니다. 스키마/컬럼 정의는 [데이터 모델](./data-model.md) 참고.
- **런타임 고정**: 모든 라우트가 `runtime = 'nodejs'` + `dynamic = 'force-dynamic'` 를 명시합니다.

관련 문서: [데이터 모델](./data-model.md) · [검토 UI](./ui.md) · [보안](./security.md)
