# 아키텍처

Minesweeper의 전체 구조를 한 곳에서 조망하는 문서입니다. 4단 파이프라인의 세부는
[./pipeline.md](./pipeline.md), 테이블·컬럼은 [./data-model.md](./data-model.md), 배치 워커는
[./worker.md](./worker.md), 교체 가능한 Stage 3 추출기는 [./extractors.md](./extractors.md)를 참고하세요.

---

## 1. 시스템 개요·목표

지원자 첨부서류(학위논문·연구실적·구글스칼라 캡처 등)에서 **이해충돌 관계자**("지뢰" — 지도교수·심사위원·공저자
등)를 자동 추출해 출처와 함께 보여주고, 담당자가 **육안으로 검토·수정·확정**하는 내부 웹서비스입니다.

핵심 목표는 한 문장으로 **"타이핑을 눈+클릭으로 바꾸는 것"** 입니다. 기존에는 담당자가 수십 개 PDF/스캔을
직접 열어 이름을 손으로 옮겨 적었다면, 이 시스템은 그 초안을 기계가 만들고 사람은 보고(눈) 확정/수정(클릭)만
합니다. 자동 추출이 일을 _대체_ 하는 게 아니라 _가속_ 합니다.

그래서 설계 전체를 관통하는 단 하나의 원칙이 있습니다.

> **자동 추출은 초안, 최종 판단은 사람.** 추출기는 문서에 실제로 있는 이름만 뽑고, 없으면 "없음"으로
> 둡니다(`src/lib/pipeline/extract/`). **절대 이름을 지어내지 않습니다.** 도장·손글씨·판독난해 서명처럼
> 기계가 자신할 수 없는 것은 추출을 약속하지 않고 **검토 필요 큐**로 모아 사람에게 넘깁니다.

이 원칙은 코드에도 그대로 박혀 있습니다. `src/worker/process.ts`의 임계값
`HUMAN_REVIEW_CONFIDENCE = 0.7`, 그리고 다음 판정식이 "사람이 봐야 하는가"를 결정합니다.

```ts
// src/worker/process.ts
const needsHuman = p.sourceKind !== 'printed' || p.confidence < HUMAN_REVIEW_CONFIDENCE;
```

즉 **인쇄(`printed`)가 아니거나** 신뢰도가 0.7 미만이면 무조건 사람 검토 대상으로 표시합니다.

---

## 2. 4단 파이프라인

모든 파일은 형식(PDF/이미지/HWP/텍스트)·문서유형과 무관하게 **동일한 4단**을 통과합니다. 단의 진입·이탈
타입은 `src/lib/pipeline/types.ts`에 정의돼 있고, 오케스트레이션은 `src/lib/pipeline/run.ts`의
`runPipeline()`이 담당합니다.

```
                       한 지원자의 파일들 (files: PipelineFile[])
                                     │
   ┌─────────────────────────────────┼─────── per-file loop (run.ts) ───────────────────────┐
   │                                  ▼                                                       │
   │   (1) Ingest      형식 정규화 → 페이지 묶음(text + hasText + imagePath?)                 │
   │       ingest/        ingest(filepath, detectFormat(filename))  →  IngestResult          │
   │                                  │                                                       │
   │                                  ▼                                                       │
   │   (2) Type        폴더/[태그] 우선, 안 잡히면 1p 내용 폴백 → DocType                     │
   │       classify.ts    classifyDocType({ filename, folderCategory, firstPageText })       │
   │                                  │                                                       │
   │                                  ▼                                                       │
   │   (3) Extract     유형별 추출(이름·역할·소속·출처·신뢰도) → RawPerson[]                  │
   │       extract/       extractor.extract({ docType, pages, filename, selfName, ... })     │
   │                                  │                                                       │
   └──────────────────────────────────┼──────────────────────────────────────────────────────┘
                                       ▼  (allPersons 누적)
       (4) Aggregate    사람 단위 dedup + 역할 합집합 + 본인 제외 → AggregatedPerson[]
           aggregate.ts    aggregate(allPersons, { selfName })
                                       │
                                       ▼
                    [관계자 명단]  +  [검토 필요 큐]   →   검토 UI
```

| 단 | 위치 | 입력 → 출력 | 한줄 요약 |
|---|---|---|---|
| (1) Ingest | `ingest/` | `filepath` → `IngestResult` | 형식을 흡수해 **형식무관 페이지 묶음**으로 정규화 |
| (2) Type | `classify.ts` | `{filename, folderCategory, firstPageText}` → `DocType` | 폴더·태그 우선, 폴백은 1p 내용으로 **문서유형 판별** |
| (3) Extract | `extract/` | `ExtractInput` → `RawPerson[]` | 유형별 규칙/프롬프트로 **이름·역할·출처·신뢰도 추출**(교체 가능) |
| (4) Aggregate | `aggregate.ts` | `PersonWithSource[]` → `AggregatedPerson[]` | 같은 사람 합치고 역할 합집합, **본인 제외** |

각 단의 상세 알고리즘·예시·엣지케이스는 [./pipeline.md](./pipeline.md)에 있습니다.

---

## 3. 두 축 분리 원칙 (컨테이너 형식 vs 문서유형)

이 시스템 설계의 중심은 **두 개의 직교 축을 한 단계에 하나씩만 가두는 것**입니다.

- **컨테이너 형식(어떻게 읽는가)** — PDF / image / HWP / text. → **오직 Stage 1**에서만 갈라집니다.
- **문서유형(무엇을 뽑는가)** — 학위논문 / 대표연구실적 / 학술논문 / hindex. → **오직 Stage 3**에서만 갈라집니다.

`src/lib/domain.ts`가 두 축을 별도 string union으로 못박아, 이 분리가 "관례"가 아니라 **타입 계약**이 되게 합니다.

```ts
// src/lib/domain.ts  — 형식(읽는 법)과 유형(뽑는 것)은 의도적으로 분리된 축
export const SOURCE_FORMATS = ['pdf', 'image', 'hwp', 'text'] as const;
export const DOC_TYPES = [
  'degree_thesis', 'representative_research', 'journal_article', 'hindex', 'unknown',
] as const;
```

### 어떻게 분리가 강제되나

Stage 1 디스패치(`src/lib/pipeline/ingest/index.ts`)는 **형식만** 보고 어댑터를 고릅니다. 출력은 모든 형식에
대해 동일한 `IngestResult`이므로, **2단 이후는 입력이 어느 형식이었는지 알 필요가 없습니다.**

```ts
// src/lib/pipeline/ingest/index.ts
switch (fmt) {
  case 'pdf':   return ingestPdf(filepath);
  case 'image': return ingestImage(filepath);
  case 'hwp':   return ingestHwp(filepath);
  case 'text':  return ingestText(filepath);
  default:      // unknown은 imagePath만 채운 image 1페이지로 폴백
}
```

반대로 Stage 3 추출기는 형식이 아니라 `docType`만 분기 키로 받습니다(`ExtractInput.docType`). 추출기는
페이지 묶음(`pages`)과 필요 시 페이지 이미지(`imagePaths`)를 받아, **그 형식이 무엇이었든** 동일하게 동작합니다.

### 분리의 효과 — "확장 = 하나만 추가"

| 새 요구 | 손대는 곳 | 추가 단위 |
|---|---|---|
| 새 **파일 형식** 지원 (예: HWPX 정식 지원) | Stage 1 | **어댑터 1개** (`ingest/*.ts` + `detect.ts` 확장자 매핑) |
| 새 **문서유형** 지원 (예: 특허) | Stage 3 | **프롬프트/규칙 1개** (`extract/prompts.ts`) |

두 축이 섞여 있었다면 "PDF × 학위논문", "이미지 × 학위논문", "PDF × hindex" … 처럼 형식 N × 유형 M 의 조합
폭발이 일어났을 것입니다. 분리해 두면 형식은 **N개**, 유형은 **M개**만 관리하면 됩니다. 확장 단위에 대한 자세한
가이드는 [./pipeline.md](./pipeline.md)와 [./extractors.md](./extractors.md)를 참고하세요.

---

## 4. 데이터 흐름 — zip 업로드 → 워커 → 검토 UI

업로드 API(`src/app/api/upload/route.ts`)는 **빠르게 받아 큐에 넣고 즉시 응답**하고, 무거운 추출은
백그라운드 워커가 `jobs` 테이블을 폴링하며 처리합니다. 웹·워커는 같은 libsql 파일 DB와 `./data/` 디스크를
공유하는 별도 프로세스입니다.

```
 브라우저            Next API (upload/route.ts)        libsql DB (파일)        워커(별도 프로세스)        검토 UI
   │                        │                              │                        │                     │
   │  POST /api/upload      │                              │                        │                     │
   │  (multipart zip)       │                              │                        │                     │
   │───────────────────────▶│                              │                        │                     │
   │                        │ size > MAX_UPLOAD_BYTES? 413  │                        │                     │
   │                        │ unzipApplicant(zip)          │                        │                     │
   │                        │  (zip-slip/bomb 방어)        │                        │                     │
   │                        │ ./data/uploads/{id}/files/.. │  ← 디스크 저장          │                     │
   │                        │ insert applicants            │                        │                     │
   │                        │ insert documents (detectFmt) │───────────────────────▶│                     │
   │                        │ enqueueApplicant → jobs      │                        │                     │
   │  { applicantId,        │                              │  jobs(queued)          │                     │
   │    jobId,              │◀─────────────────────────────│                        │                     │
   │    documentCount }     │                              │                        │ claimNextJob()      │
   │◀───────────────────────│                              │◀───────────────────────│ (queued→running)    │
   │                        │                              │                        │ processApplicant()  │
   │                        │                              │                        │  └ runPipeline()    │
   │                        │                              │                        │     1·2·3·4단       │
   │  GET /api/status/{id}  │                              │  extracted_persons     │ tx: 결과 원자적 교체 │
   │  (진행률 폴링) ◀────────┼──────────────────────────────│  person_aggregates     │◀────────────────────│
   │                        │                              │  review_flags          │ completeJob/failJob │
   │                        │                              │  jobs(done/error)      │                     │
   │  지원자별 검토 화면 ────┼─────────────────────────────▶│  (read aggregates,     │   확정/수정/제외    │
   │  확정·수정·제외        │                              │   flags, corrections)  │────────────────────▶│
   │                        │                              │                        │                     │
```

흐름의 핵심 포인트:

1. **업로드는 동기, 추출은 비동기.** `POST /api/upload`는 압축 해제·문서 등록·잡 큐잉까지만 하고
   `{ applicantId, jobId, documentCount }`를 즉시 반환합니다. 진행률은 `GET /api/status/[applicantId]`
   폴링으로 따라갑니다.
2. **원본/zip은 DB에 넣지 않습니다.** 파일은 `./data/uploads/{applicantId}/files/…`에 저장하고, DB에는
   경로(`documents.filepath`)만 기록합니다. 파일 서빙(`/api/file/[documentId]`)도 DB에 기록된 경로만 사용합니다.
3. **결과 영속화는 원자적 교체.** `processApplicant()`는 한 트랜잭션 안에서 해당 지원자의 기존
   `extracted_persons`/`person_aggregates`/`review_flags`를 지우고 새로 채웁니다. 중간 실패가 명단을
   반쯤 망가뜨리지 않으며, 잡 재실행이 안전(idempotent)합니다.
4. **검토 큐 분기.** 추출 결과 1건마다 `flagForKind(sourceKind, confidence)`가 `seal/handwriting/
   signature/low_confidence` 플래그를 만들고, 텍스트가 전혀 없는 스캔/이미지/HWP 문서에서 사람이 0명이면
   `needs_vision` 플래그를 답니다. 워커 동작 상세는 [./worker.md](./worker.md)를 참고하세요.

---

## 5. 컴포넌트 맵

```
                         ┌──────────────────────────────────────────────┐
                         │                  ./data/  (gitignored)        │
                         │   uploads/{applicantId}/upload.zip            │
                         │   uploads/{applicantId}/files/...             │
                         │   minesweeper.db   (libsql 파일모드)          │
                         └───────────────▲───────────────▲──────────────┘
                                         │               │
                         읽기/쓰기(경로) │               │ 읽기/쓰기(Drizzle)
                                         │               │
        ┌────────────────────────┐      │               │      ┌───────────────────────────┐
        │  Web (Next.js 14)       │      │               │      │  Worker (tsx node 프로세스) │
        │  App Router             │      │               │      │  src/worker/index.ts        │
        │  - UI pages (app/)      │──────┘               └──────│  - queue.ts (jobs 폴링)     │
        │  - API routes (api/)    │                             │  - process.ts               │
        │    upload/status/file/  │   같은 DB·디스크 공유        │    → runPipeline()          │
        │    persons/export/...   │◀───────(jobs 테이블)────────▶│                             │
        └────────────┬────────────┘                             └──────────────┬──────────────┘
                     │                                                          │
                     │           공유 라이브러리 src/lib/pipeline/              │
                     └────────────────────────┬─────────────────────────────────┘
                                               ▼
                  ┌──────────────────────────────────────────────────────────────┐
                  │  Pipeline (run.ts)                                             │
                  │   1 ingest/  2 classify.ts  3 extract/  4 aggregate.ts        │
                  │                              │                                 │
                  │                              ▼  Extractor (pluggable)          │
                  │              ┌──────────────────────┬──────────────────────┐   │
                  │              │  stub (extract/stub) │  vlm (extract/vlm)    │   │
                  │              │  결정적·GPU 불필요    │  온프레 VLM(OpenAI호환)│  │
                  │              │  기본·모든 테스트     │  EXTRACTOR_MODE=vlm   │   │
                  │              └──────────────────────┴──────────────────────┘   │
                  └──────────────────────────────────────────────────────────────┘
```

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| **Web** | `src/app/` | 업로드 폼·검토 UI(Server/Client Components) + API Route Handlers |
| **Worker** | `src/worker/` | `jobs` 테이블 폴링 → `processApplicant()` → 파이프라인 실행·영속화 |
| **DB** | `src/db/` | libsql 파일모드 클라이언트(`client.ts`) + Drizzle 스키마(`schema.ts`) + 마이그레이션(`migrate.ts`) |
| **Pipeline** | `src/lib/pipeline/` | 4단 오케스트레이션(`run.ts`)과 각 단 구현 — 웹·워커가 공유 |
| **Extractor** | `src/lib/pipeline/extract/` | Stage 3 교체 가능 추출기: `stub`(기본) / `vlm`(온프레) |
| **File storage** | `./data/` | 원본·압축·페이지 크롭·DB가 모두 로컬 디스크에만 |

추출기 선택은 `EXTRACTOR_MODE` 환경변수(기본 `stub`)로 합니다(`src/worker/index.ts`,
`run.ts`의 `getExtractor()`). 자세한 추출기 계약은 [./extractors.md](./extractors.md)를 참고하세요.

---

## 6. 기술 스택 선택 이유

`package.json` 기준 의존성과 그 선택 근거입니다.

| 선택 | 패키지 | 왜 |
|---|---|---|
| **임베디드 DB(파일모드)** | `@libsql/client ^0.14.0` + `drizzle-orm ^0.36.4` | `./data/minesweeper.db` 한 파일. `git clone && npm i && npm run db:migrate`로 끝나는 이식성. 별도 DB 서버·컨테이너 불필요 |
| **네이티브 컴파일 없음** | (better-sqlite3·sharp·canvas **미사용**) | `@libsql/client`는 순수 JS 경로로 동작 → 노드 버전·OS·CPU에 따른 빌드 실패가 없음. "어디서나 동일하게 동작" |
| **풀스택 단일 프레임워크** | `next ^14.2.18` (App Router) | UI와 API Route Handler를 한 프로젝트에서. 별도 백엔드 서버 불필요 |
| **워커 분리** | `tsx ^4.19.2`, `concurrently ^9.1.0` | 대용량 zip 추출이 웹 요청 타임아웃·이벤트루프를 막지 않도록 **별도 node 프로세스**로 분리. `dev:all`이 웹+워커 동시 기동 |
| **온프레 LLM** | (외부 SDK 없음; `vlm.ts`가 OpenAI 호환 HTTP 호출) | 개인정보·논문 전문·인장을 다루므로 외부 클라우드 API는 막힐 가능성이 큼 → 기본 온프레(`VLM_BASE_URL`, 기본 로컬 Ollama). 기본 추출기는 GPU조차 필요 없는 `stub` |
| **PDF/엑셀/zip** | `pdfjs-dist ^4.8.69`, `exceljs ^4.4.0`, `adm-zip ^0.5.16` | PDF 텍스트 추출, 명단 Excel 내보내기, zip 해제. 모두 순수 JS |
| **검증** | `zod ^3.23.8`, `vitest ^2.1.5`, `typescript ^5.6.3` | 입력 스키마 검증 + 파이프라인 전 구간 테스트 + 타입 안전 |

### Next 번들 경계 (`next.config.mjs`)

서버 전용/무거운 패키지가 클라이언트·RSC 그래프로 끌려가지 않도록 `serverComponentsExternalPackages`로
명시 외부화합니다. 또한 ESLint 설정 부재가 신규 클론에서 `next build`를 막지 않도록 빌드 중 lint를 끄고,
타입 안전은 `npm run typecheck`로 따로 강제합니다.

```js
// next.config.mjs
experimental: {
  serverComponentsExternalPackages: [
    '@libsql/client', 'libsql', 'pdfjs-dist', 'exceljs', 'adm-zip',
  ],
},
eslint: { ignoreDuringBuilds: true },
```

`detect.ts`가 어댑터(특히 무거운 ESM-only `pdfjs`) import 없이 확장자만 보도록 분리된 것도 같은 맥락입니다 —
업로드 라우트가 형식 판별만 필요할 때 PDF 어댑터를 번들로 끌어오지 않게 합니다.

---

## 7. 디렉터리 구조

```
MineSweeper/
├─ next.config.mjs           # 번들 외부화 + 빌드 시 lint off
├─ package.json              # scripts: dev / worker / dev:all / db:* / test ...
├─ docs/
│  ├─ architecture.md        # (이 문서)
│  ├─ pipeline.md            # 4단 파이프라인 상세
│  ├─ data-model.md          # 테이블·컬럼·관계
│  ├─ worker.md              # 배치 워커·큐
│  └─ extractors.md          # Stage 3 추출기 계약(stub/vlm)
├─ data/                     # (gitignored) 원본·zip·크롭·minesweeper.db
│  └─ uploads/{applicantId}/{upload.zip, files/...}
├─ tests/                    # vitest (파이프라인 전 구간)
│  ├─ ingest.test.ts  classify.test.ts  extract-stub.test.ts
│  ├─ aggregate.test.ts  pipeline.test.ts  worker.test.ts
│  └─ unzip.test.ts  filename.test.ts  names.test.ts
└─ src/
   ├─ app/                   # Next App Router (UI + API)
   │  ├─ layout.tsx  page.tsx  globals.css
   │  ├─ applicants/         # 지원자별 검토 화면
   │  ├─ review-queue/       # 검토 필요 큐(크롭 갤러리)
   │  └─ api/
   │     ├─ upload/route.ts            # zip 수신 → 해제 → 등록 → 큐
   │     ├─ status/[applicantId]/      # 진행률 폴링
   │     ├─ file/[documentId]/         # 경로 기반 파일 서빙
   │     ├─ persons/[id]/              # 검토 확정/수정/제외
   │     ├─ export/[applicantId]/      # 명단 CSV/Excel
   │     └─ review-queue/export/       # 큐 내보내기
   ├─ components/            # badges.tsx  PersonActions.tsx  UploadForm.tsx
   ├─ db/
   │  ├─ client.ts           # libsql 파일모드 클라이언트
   │  ├─ schema.ts           # Drizzle 스키마(테이블 정의)
   │  └─ migrate.ts          # 마이그레이션 적용
   ├─ worker/
   │  ├─ index.ts            # 폴링 루프 + runWorkerTick()
   │  ├─ queue.ts            # claimNextJob / completeJob / failJob / enqueueApplicant
   │  └─ process.ts          # processApplicant() → runPipeline() → 영속화(tx)
   └─ lib/
      ├─ domain.ts           # SOURCE_FORMATS/DOC_TYPES/ROLES/SOURCE_KINDS/FLAG_TYPES ...
      ├─ names.ts            # normalizeName / initialsForm
      ├─ filename.ts         # parseApplicantFolder
      ├─ unzip.ts            # unzipApplicant (zip-slip/bomb 방어)
      ├─ csv.ts  export.ts   # 명단 내보내기(CSV/Excel)
      ├─ data.ts             # 조회 헬퍼
      └─ pipeline/
         ├─ run.ts           # runPipeline() — 4단 오케스트레이션
         ├─ types.ts         # PageBundle / IngestResult / RawPerson / ExtractInput / Extractor ...
         ├─ classify.ts      # (2) Type
         ├─ aggregate.ts     # (4) Aggregate
         ├─ ingest/          # (1) Ingest: index.ts detect.ts pdf.ts image.ts hwp.ts text.ts
         └─ extract/         # (3) Extract: index.ts stub.ts vlm.ts prompts.ts roles.ts util.ts
```

---

## 관련 문서

- [./pipeline.md](./pipeline.md) — 4단 파이프라인 각 단의 알고리즘·입출력·엣지케이스
- [./data-model.md](./data-model.md) — `applicants`·`documents`·`extracted_persons`·`person_aggregates`·`jobs`·`review_flags`·`corrections` 스키마
- [./worker.md](./worker.md) — 잡 큐·폴링·원자적 영속화·재실행 안전성
- [./extractors.md](./extractors.md) — Stage 3 `Extractor` 계약과 `stub`/`vlm` 구현
