# 개발 가이드

Minesweeper(채용 이해충돌 관계자 추출 시스템)를 로컬에서 띄우고, 테스트를 돌리고, 새 형식·문서유형·추출기를
추가하는 실무 가이드입니다. 모든 명령은 저장소 루트(`/gits/MineSweeper`)에서 실행한다고 가정합니다.

연관 문서:
- 파이프라인 4단(Ingest→Type→Extract→Aggregate)의 동작: [./pipeline.md](./pipeline.md)
- Stage 3 추출기(stub / vlm)와 교체 방법: [./extractors.md](./extractors.md)
- DB 스키마·도메인 enum·테이블: [./data-model.md](./data-model.md)

> 설계 원칙(개발 중에도 동일): **자동추출은 초안, 최종판단은 사람.** 추출기는 문서에 실제로 있는 이름만
> 뽑고 없으면 비워 둡니다. 코드를 고칠 때도 "없으면 지어내지 않는다"는 계약을 깨지 마세요.

---

## 1. 사전 요구

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **22.x** | `devDependencies`의 `@types/node`가 `^22.9.0`. `tsconfig` target은 `ES2022`. |
| npm | Node 22 동봉본 | `package-lock.json` 있음 → 재현 설치는 `npm ci` 권장 |
| GPU / 모델 | 불필요(기본) | 기본 추출기는 `stub`(결정적). `vlm` 모드만 온프레 모델이 필요 |

네이티브 컴파일 의존성이 없습니다(better-sqlite3·sharp·canvas 미사용). DB는 libsql 파일모드
(`@libsql/client`)라 별도 DB 서버를 띄울 필요가 없습니다. `git clone && npm i` 후 곧바로 동작하는 것이
목표입니다.

Node 버전 확인:

```bash
node -v   # v22.x 이어야 함
```

---

## 2. 설치 · 초기화

```bash
npm install                  # 또는 재현 설치: npm ci
npm run db:migrate           # ./data/minesweeper.db 생성 + 마이그레이션 적용
```

`db:migrate`는 `src/db/migrate.ts`를 `tsx`로 실행합니다. 내부에서 `DATABASE_URL`(미설정 시 기본
`file:./data/minesweeper.db`)을 읽고, `file:` URL이면서 `:memory:`가 아니면 디렉터리를 먼저
`mkdirSync(..., { recursive: true })`로 만든 뒤 `./drizzle` 폴더의 생성된 마이그레이션을 적용합니다.

```ts
// src/db/migrate.ts
const url = process.env.DATABASE_URL ?? 'file:./data/minesweeper.db';
// ...
const db = createDb(url);
await runMigrations(db);            // migrate(db, { migrationsFolder: './drizzle' })
console.log(`✓ migrations applied to ${url}`);
```

성공하면 `✓ migrations applied to file:./data/minesweeper.db` 가 출력됩니다.

DB 위치/연결 문자열을 바꾸려면 환경변수로 덮어씁니다.

```bash
DATABASE_URL="file:./data/dev.db" npm run db:migrate
```

추출기를 온프레 VLM으로 바꾸려면 `EXTRACTOR_MODE=vlm`과 `VLM_*` 변수를 설정합니다(기본값은 로컬 Ollama).
자세한 환경변수는 [./extractors.md](./extractors.md) 참고. 기본값 요약:

| 변수 | 기본값 | 의미 |
|---|---|---|
| `EXTRACTOR_MODE` | `stub` | `vlm`이면 온프레 모델 호출 |
| `VLM_BASE_URL` | `http://localhost:11434/v1` | OpenAI 호환 엔드포인트(로컬 Ollama) |
| `VLM_MODEL` | `qwen3.5:9B` | 사용 모델 |
| `VLM_TIMEOUT_MS` | `120000` | 호출 타임아웃 |
| `WORKER_POLL_INTERVAL_MS` | `2000` | 워커 폴링 주기 |

---

## 3. npm 스크립트

`package.json`의 `scripts` 전부입니다.

| 스크립트 | 명령 | 용도 |
|---|---|---|
| `dev` | `next dev` | 웹(:3000)만 기동 |
| `dev:all` | `concurrently -n web,worker -c blue,green "next dev" "tsx watch src/worker/index.ts"` | 웹 + 워커 동시 기동(개발 표준) |
| `worker` | `tsx src/worker/index.ts` | 백그라운드 워커만 기동(잡 큐 폴링) |
| `build` | `next build` | 프로덕션 빌드 |
| `start` | `next start` | 빌드 결과 기동 |
| `db:generate` | `drizzle-kit generate` | 스키마 변경 → 마이그레이션 SQL 생성 |
| `db:migrate` | `tsx src/db/migrate.ts` | 마이그레이션 적용(DB 파일 생성 포함) |
| `typecheck` | `tsc --noEmit` | 타입 검사(빌드 없이) |
| `test` | `vitest run` | 전체 테스트 1회 실행 |
| `test:watch` | `vitest` | 워치 모드 테스트 |
| `lint` | `next lint` | ESLint |

가장 흔한 개발 루프:

```bash
npm run dev:all      # 웹 + 워커. http://localhost:3000 에서 zip 업로드 → 진행률 → 검토 화면
```

웹과 워커는 **별도 프로세스**입니다. 업로드 라우트는 `jobs` 테이블에 잡을 넣고, 워커
(`src/worker/index.ts`)가 이를 폴링해서 파이프라인을 돌립니다. 웹만 띄우면(`npm run dev`) 업로드는 되지만
추출이 진행되지 않으니, 추출까지 보려면 `dev:all`(또는 별도 터미널에서 `npm run worker`)을 쓰세요.

워커 루프는 한 틱에 잡 하나를 처리하고, 큐가 비면 `WORKER_POLL_INTERVAL_MS`만큼 쉽니다.

```ts
// src/worker/index.ts
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

---

## 4. 프로젝트 레이아웃

```
MineSweeper/
├─ src/
│  ├─ app/                      Next.js App Router (UI + API Route Handlers)
│  │  ├─ page.tsx               업로드 홈
│  │  ├─ applicants/[id]/       지원자별 관계자 명단 화면
│  │  ├─ review-queue/          검토 필요 큐 화면
│  │  └─ api/                   Route Handlers
│  │     ├─ upload/route.ts         zip 업로드 → 잡 enqueue
│  │     ├─ status/[applicantId]/   추출 진행률
│  │     ├─ persons/[id]/           검토 confirm/edit/reject
│  │     ├─ file/[documentId]/      원본 문서 서빙
│  │     ├─ export/[applicantId]/   지원자 단위 export
│  │     └─ review-queue/export/    큐 export
│  ├─ components/               badges.tsx, PersonActions.tsx, UploadForm.tsx
│  ├─ db/                       client.ts / schema.ts / migrate.ts
│  ├─ lib/
│  │  ├─ domain.ts              도메인 vocabulary(enum·라벨) — 단일 진실원
│  │  ├─ names.ts               이름 정규화/매칭(보수적 merge)
│  │  ├─ filename.ts            파일명/폴더 파싱
│  │  ├─ csv.ts / export.ts     CSV·XLSX export
│  │  ├─ data.ts                서버측 데이터 조회
│  │  ├─ unzip.ts               zip 해제(zip-slip 방어)
│  │  └─ pipeline/              4단 파이프라인 ↓
│  │     ├─ types.ts            PageBundle / IngestResult / RawPerson / Extractor ...
│  │     ├─ run.ts              runPipeline (1→2→3→4 오케스트레이션)
│  │     ├─ ingest/             (1) 형식 어댑터: detect / pdf / image / hwp / text
│  │     ├─ classify.ts         (2) 문서유형 분류
│  │     ├─ extract/            (3) 추출기: index(registry) / stub / vlm / roles / prompts / util
│  │     └─ aggregate.ts        (4) 사람 단위 집계
│  ├─ types/shims.d.ts          타입 shim
│  └─ worker/                   index(entry+tick) / queue(jobs) / process(applicant 처리)
├─ tests/                       vitest (51 tests) — §5
│  ├─ fixtures.ts               공유 텍스트/PDF 픽스처
│  └─ helpers/db.ts             freshDb() — temp-file 마이그레이션 DB
├─ drizzle/                     생성된 마이그레이션 SQL + meta/
├─ data/                        런타임 산출물(DB 파일, 업로드 원본). 커밋 대상 아님
├─ drizzle.config.ts           drizzle-kit 설정
├─ vitest.config.ts            vitest 설정(@ 별칭)
└─ tsconfig.json               TS 설정(@/* 별칭)
```

축 분리가 레이아웃에 그대로 드러납니다: **형식 차이는 `ingest/`(1단)에만, 문서유형 차이는 `extract/`(3단)에만**
존재합니다. 2단(`classify.ts`)과 4단(`aggregate.ts`)은 형식·유형과 무관하게 한 곳에서 동작합니다. 자세한
흐름은 [./pipeline.md](./pipeline.md).

---

## 5. 테스트 전략

런너는 **vitest**입니다. `vitest.config.ts`:

```ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
```

- `environment: 'node'` — 브라우저 DOM 없이 순수 Node에서 실행(파이프라인·DB·워커는 전부 서버측).
- `globals: false` — `describe/it/expect`를 각 테스트에서 `import { describe, expect, it } from 'vitest'`로
  명시적 임포트합니다.
- `@` 별칭을 vitest에서도 동일하게 풀어, 테스트가 소스와 같은 `@/...` 경로를 씁니다.

### 현재 51개 테스트 구성

```bash
npm test
```

| 파일 | 개수 | 검증 내용 |
|---|---:|---|
| `tests/names.test.ts` | 16 | `normalizeName`(자간 정규화·인장/서명 마커 제거), `detectScript`, `namesMatch`(보수적 merge만), `initialsForm`/`nameKey`/`nameCompleteness` |
| `tests/extract-stub.test.ts` | 7 | StubExtractor: 학위논문 advisor/committee/학과장, 위원블록 없으면 `[]`(무생성), 학술논문 공저자(References 무시), 본인 태깅, 논문제목 오캡처 가드, `부 지도교수`→`co_supervisor`, hindex 이미지=텍스트없음→`[]` |
| `tests/classify.test.ts` | 6 | `classifyDocType` 우선순위: `[tag]` > filename(hindex) > folder > content > default |
| `tests/filename.test.ts` | 6 | `parseFilename`(applicantId·`[tag]`·title·hints), `parseApplicantFolder` |
| `tests/ingest.test.ts` | 6 | `detectFormat` 확장자 매핑, ingest dispatch(image=vision page, text 추출, pdf 텍스트레이어/garbage 무throw, hwp placeholder) |
| `tests/aggregate.test.ts` | 4 | 동일인물 merge·역할/출처 union, 본인 자동제외, 비-printed/저신뢰 `needsHuman`, 동명이인 미과합병 |
| `tests/pipeline.test.ts` | 2 | `runPipeline` E2E(3문서 처리·provenance 집계), CSV/XLSX export 유효성 |
| `tests/worker.test.ts` | 2 | 큐 잡 E2E 처리·영속화, 손글씨 person → handwriting 검토 플래그 |
| `tests/unzip.test.ts` | 2 | 폴더=카테고리 구조 보존, zip-slip 경로 탈출 탐지 |
| **합계** | **51** | |

### 공유 픽스처 — `tests/fixtures.ts`

테스트는 이름을 지어내지 않도록 **고정된 텍스트 픽스처**를 공유합니다.

- `THESIS_KO` — 한국어 학위논문 표지/심사 페이지(지도교수·심사위원장·심사위원·학과장 라인 포함).
- `EMPTY_THESIS` — 심사위원 블록이 없는 논문(추출기가 `[]`를 반환해야 함을 확인).
- `ARTICLE_EN` — 영문 저널 논문(저자 블록 + References). 공저자는 저자 블록에서만, References에서는 절대 안 뽑힘.
- `MINI_PDF` — 텍스트 레이어가 있는 한 페이지 PDF 원문(pdfjs xref 복구 경로 검증용).

`pipeline.test.ts`는 이 픽스처를 temp 디렉터리에 실제 파일로 써서 `runPipeline`에 넣습니다.

```ts
// tests/pipeline.test.ts
const thesis  = join(dir, '0323-000001_[학위논문]_관리지역세분화.txt');
const article = join(dir, '0323-000001_[학술논문]_impact-of-urban.txt');
const hindex  = join(dir, '0323-000001_hindex.png');
writeFileSync(thesis, THESIS_KO);
writeFileSync(article, ARTICLE_EN);
writeFileSync(hindex, 'fake png bytes');
```

### DB 테스트 — temp **파일** DB(`freshDb`), `:memory:` 아님

DB가 필요한 테스트(worker 등)는 `tests/helpers/db.ts`의 `freshDb()`로 매번 새 DB를 만듭니다.

```ts
// tests/helpers/db.ts
export function freshDb(): Promise<DB> {
  const dir = mkdtempSync(join(tmpdir(), 'ms-db-'));
  return createMigratedDb(`file:${join(dir, 'test.db')}`);
}
```

**왜 `:memory:`가 아니라 temp 파일인가:** libsql의 in-memory DB는 트랜잭션 연결이 같은 메모리를 공유하지
않아, 트랜잭션을 쓰는 코드 경로가 깨집니다. 그래서 테스트는 운영과 동일한 **libsql 파일모드**를 흉내 내도록
유일한 temp 파일을 씁니다. 헬퍼 주석이 이를 명시합니다:

> Uses a unique temp FILE (not ':memory:') so it mirrors the production libsql file mode and
> supports transactions, which an in-memory libsql DB does not share across the transaction
> connection.

마이그레이션 코드는 운영과 테스트가 공유합니다. `migrate.ts`의 `createMigratedDb(url = ':memory:')`는
`createDb` 후 `runMigrations`(=`migrate(db, { migrationsFolder: './drizzle' })`)를 호출하며, `freshDb`는
여기에 temp 파일 URL을 넘깁니다. 즉 테스트도 **운영과 동일한 생성된 마이그레이션**으로 스키마를 만듭니다.

### 새 테스트 작성 규칙

- `tests/*.test.ts`로 두면 `include` 패턴에 자동 포함됩니다.
- `vitest`에서 `describe/it/expect`를 명시 임포트(`globals: false`).
- 텍스트 시나리오는 가능하면 `fixtures.ts`를 재사용. DB가 필요하면 `freshDb()`로 격리된 DB를 받으세요.
- 추출기 관련 테스트는 항상 `StubExtractor`(결정적)를 씁니다. `vlm`은 외부 모델 의존이라 테스트로 돌리지 않습니다.

---

## 6. 확장 가이드

### 6.1 새 형식 어댑터(1단)

형식 차이는 **1단에만** 존재합니다. 새 형식을 더하려면 어댑터 하나와 dispatch 두 줄이면 됩니다.

1. `src/lib/domain.ts`의 `SOURCE_FORMATS`에 값을 추가(현재 `['pdf', 'image', 'hwp', 'text']`).
2. `src/lib/pipeline/ingest/<fmt>.ts`를 만들고 `IngestResult`를 반환하는 ingest 함수를 작성. 반환 형태는
   `text.ts`가 가장 단순한 참고 예시입니다 — 페이지마다 `{ pageNumber, text, hasText, imagePath? }`.
3. `src/lib/pipeline/ingest/detect.ts`의 `detectFormat`에 확장자 매핑 추가.
4. `src/lib/pipeline/ingest/index.ts`의 `ingest()` switch에 case 추가.

```ts
// src/lib/pipeline/ingest/index.ts (발췌)
switch (fmt) {
  case 'pdf':   return ingestPdf(filepath);
  case 'image': return ingestImage(filepath);
  case 'hwp':   return ingestHwp(filepath);
  case 'text':  return ingestText(filepath);
  default: /* unknown → image(빈 텍스트)로 안전 처리 */
}
```

주의: `detect.ts`는 **어댑터를 import 하지 않습니다**(특히 pdfjs). 업로드 라우트처럼 형식 판별만 필요한
곳이 무거운 ESM-only pdf 어댑터를 번들로 끌어오지 않게 하기 위함입니다. 새 어댑터를 추가해도 `detect.ts`는
import-free로 유지하세요. `hwp.ts`는 `cfb`+`zlib`(.hwp)·`adm-zip`(.hwpx)로 텍스트를 추출하며, 파싱
실패 시 크래시 대신 `note`를 채워 파이프라인을 계속 돌립니다(도장 감지용 페이지 렌더는 향후 작업).

### 6.2 새 문서유형(3단)

문서유형 차이는 **3단에만** 존재합니다.

1. `src/lib/domain.ts`의 `DOC_TYPES`에 값을 추가(현재 `degree_thesis | representative_research |
   journal_article | hindex | unknown`). 같은 파일의 `DOC_TYPE_LABELS_KO`에 한국어 라벨도 추가하세요(이게
   reviewer가 보는 표기입니다).
2. `src/lib/pipeline/classify.ts`에서 새 유형을 잡을 신호를 추가. 분류 우선순위는 `[tag] > filename(hindex)
   > folder hint > 1p content > default`이며, tag 매핑은 `TAG_TO_DOCTYPE`에 있습니다:

   ```ts
   const TAG_TO_DOCTYPE: Record<string, DocType> = {
     학위논문: 'degree_thesis',
     대표연구실적: 'representative_research',
     학술논문: 'journal_article',
   };
   ```
3. 추출 규칙을 새 유형에 맞게 보강. stub은 유형별 휴리스틱, vlm은 프롬프트로 동작합니다
   (`extract/prompts.ts`의 `buildExtractionPrompt`). 기본 역할 fallback은
   `extract/roles.ts`의 `defaultRoleForDoc`:

   ```ts
   export function defaultRoleForDoc(docType: DocType): Role {
     return docType === 'degree_thesis' ? 'committee' : 'coauthor';
   }
   ```

분류·역할 매핑은 [./pipeline.md](./pipeline.md)와 [./extractors.md](./extractors.md)에 더 자세합니다.

### 6.3 새 추출기(Stage 3)

추출기는 **pluggable** 합니다. `Extractor` 인터페이스만 구현하면 됩니다.

```ts
// src/lib/pipeline/types.ts
export interface Extractor {
  readonly name: string;
  extract(input: ExtractInput): Promise<RawPerson[]>;
}
```

`ExtractInput`은 `{ docType, pages, filename, selfName?, imagePaths? }`, 반환은
`RawPerson[]`(`nameRaw, role, sourceKind, sourcePage, confidence, isSelf?, evidence?` 등)입니다. 등록은
`extract/index.ts`의 registry 한 곳에서 합니다.

```ts
// src/lib/pipeline/extract/index.ts
export function getExtractor(mode: string = process.env.EXTRACTOR_MODE ?? 'stub'): Extractor {
  return mode === 'vlm' ? new VlmExtractor() : new StubExtractor();
}
```

새 추출기를 추가하려면 ① `Extractor`를 구현한 클래스를 만들고 ② `getExtractor`의 분기에 모드를 더하면
됩니다. 계약은 반드시 지키세요: **문서에 있는 이름만 반환, 없으면 `[]`(절대 생성 금지), 손글씨/도장/판독난해
서명은 자동 추출을 약속하지 않고 검토 필요 플래그로 넘긴다.** vlm 구현 상세(OpenAI 호환 호출, zod 응답 스키마)는
[./extractors.md](./extractors.md) 참고.

---

## 7. 마이그레이션 워크플로우

스키마는 `src/db/schema.ts`(Drizzle)가 단일 진실원이고, SQL 마이그레이션은 `./drizzle`에 생성됩니다.
`drizzle.config.ts`:

```ts
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data/minesweeper.db' },
});
```

표준 절차:

```
1) src/db/schema.ts 수정        ← 컬럼/테이블/제약 변경
2) npm run db:generate          ← drizzle-kit이 ./drizzle/NNNN_*.sql + meta/ 갱신
3) (생성된 SQL 검토 후 커밋)
4) npm run db:migrate           ← 로컬 DB에 적용
```

```text
schema.ts ──(db:generate)──▶ drizzle/0000_*.sql, drizzle/meta/ ──(db:migrate)──▶ DB 파일
```

- 생성된 마이그레이션 파일(`drizzle/`)은 **커밋합니다**. 테스트의 `freshDb`/`createMigratedDb`도 이 파일을
  적용하므로, 새 마이그레이션을 만들면 테스트가 자동으로 새 스키마로 돕니다.
- enum류 도메인 값(`ROLES`, `DOC_TYPES`, `FLAG_TYPES` 등)을 추가했다면, schema가 그 값을 참조할 때만
  마이그레이션이 필요합니다. 도메인 vocabulary 자체는 `src/lib/domain.ts`에 있고(상세는
  [./data-model.md](./data-model.md)), 스키마/파이프라인/UI가 공유하는 계약입니다.
- DB 위치를 바꿔 마이그레이션을 적용하려면 `DATABASE_URL`을 앞에 붙이세요(§2).

---

## 8. 코딩 규칙

### 8.1 `@/*` 경로 별칭

`tsconfig.json`이 `@/*` → `./src/*` 를 정의하고, vitest도 같은 별칭을 풀어줍니다(`drizzle.config`는 별칭 미사용).

```jsonc
// tsconfig.json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

```ts
import { ROLES, type Role } from '@/lib/domain';
import type { Extractor } from '@/lib/pipeline/types';
```

소스·테스트 모두 상대경로 지옥 대신 `@/...`를 씁니다. 단, 테스트가 **같은 `tests/` 내부 파일**을 가져올 때는
상대경로(`./fixtures`, `./helpers/db`)를 씁니다.

### 8.2 서버 전용 모듈을 클라이언트에 넣지 않기

이 앱은 풀스택 Next.js(App Router)입니다. DB·파일시스템·파이프라인은 **서버 전용**입니다. 클라이언트
컴포넌트(`'use client'`)나 클라이언트 번들에 다음을 import 하지 마세요.

- `@/db/*`(libsql/Drizzle 연결), `@/worker/*`, `@/lib/pipeline/*`, `node:fs`/`node:path` 등 Node 내장.

연결은 lazy singleton이라, 모듈 import만으로 파일을 열지 않습니다. `next build`가 서버 모듈을 평가할 때
DB 파일을 여는 부작용이 없도록 하기 위한 설계입니다.

```ts
// src/db/client.ts — import 시점에 파일을 절대 열지 않는다
let _db: DB | null = null;
export function getDb(): DB {
  if (!_db) _db = createDb(defaultUrl);   // 최초 실제 사용 시점에만 연결
  return _db;
}
```

규칙 요약:

- 서버 데이터는 Server Component / Route Handler / 워커에서만 접근하고, 결과(직렬화 가능한 값)만
  클라이언트로 내립니다.
- 무거운/ESM-only 의존(pdfjs 등)은 꼭 필요한 어댑터에만 둡니다. 형식 판별만 필요한 경로는 import-free인
  `detectFormat`을 쓰세요(§6.1).
- 도메인 enum·라벨은 `@/lib/domain` 한 곳에서만 정의하고 import 합니다(중복 정의 금지). 표시용 한국어는
  `ROLE_LABELS_KO`/`DOC_TYPE_LABELS_KO`/`FLAG_TYPE_LABELS_KO`를 재사용하세요.

### 8.3 변경 전후 게이트

PR/커밋 전에 항상 통과시켜야 하는 3종:

```bash
npm run typecheck    # tsc --noEmit : 0 errors
npm test             # vitest run   : 51 passed
npm run build        # next build   : 성공
```

세 개가 모두 깨끗해야 "완료"입니다(현재 기준: 51 tests, tsc 0, next build 0).
