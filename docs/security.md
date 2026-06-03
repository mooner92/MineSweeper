# 보안·개인정보

이 문서는 Minesweeper가 다루는 데이터의 민감도, Phase 1에서 실제 코드로 구현된 방어 수단, 그리고
운영자가 반드시 지켜야 할 배포·접근통제 권고를 정리합니다. 모든 내용은 저장소의 실제 소스
(`src/lib/unzip.ts`, `src/app/api/upload/route.ts`, `src/app/api/file/[documentId]/route.ts`,
`.env.example`, `.gitignore`, `src/db/schema.ts`)에 근거하며, 코드에 없는 보안 기능은 기술하지 않습니다.

> **한 줄 요약.** Minesweeper는 지원자 PII·논문 전문·개인 인장을 다루므로 _기본값이 온프레이고 외부
> 클라우드를 강제하지 않으며_, 업로드·압축해제 단계에 zip-slip/zip-bomb 가드를 두고, 파일 서빙은 DB에
> 기록된 경로만 사용합니다. **그러나 Phase 1에는 인증이 없습니다.** 반드시 내부망 전용으로 배포하고
> 리버스 프록시에서 인증을 강제하세요. 공개 인터넷 노출은 금지입니다.

상호 링크: [배포 가이드](./deployment.md) · [API 레퍼런스](./api.md) · [파이프라인](./pipeline.md)

---

## 1. 위협 모델

### 1.1 무엇을 보호하는가 (보호 대상 자산)

채용 이해충돌 관계자 추출이라는 도메인 특성상, 이 서비스가 다루는 데이터는 거의 전부가 고민감 자산입니다.

| 자산 | 어디에 있나 | 민감도 | 노출 시 영향 |
|---|---|---|---|
| **지원자 PII** (이름·소속·연구이력) | `applicants` 테이블, 추출 결과 전반 | 높음 | 채용 후보 신원·경력 유출 |
| **논문 전문 / 첨부서류 원본** | `./data/uploads/{applicantId}/files/…` | 높음 | 미공개 연구·개인 저작물 유출 |
| **개인 인장·서명 이미지** | 원본 + 크롭(`SOURCE_KINDS=seal\|signature`) | 매우 높음 | 도장/서명 위·변조 악용 가능 |
| **추출 관계자 명단** (지뢰 = 지도교수·심사위원·공저자) | `extracted_persons` → `person_aggregates` | 높음 | 심사 공정성·이해충돌 정보 유출 |
| **사람의 교정 이력** | `corrections` 감사 로그 | 중간 | 검토자 판단·내부 의사결정 노출 |

특히 **개인 인장(`seal`)과 서명(`signature`)** 은 단순 PII를 넘어 위·변조에 악용될 수 있는
신원증표이므로, `FLAG_TYPES`(`seal | handwriting | signature | low_confidence | ambiguous |
needs_vision`)로 분리해 자동 추출을 약속하지 않고 사람이 직접 검토하는 큐로 보냅니다.

### 1.2 위협 행위자와 공격 표면

```
  외부 인터넷 ──(노출 금지)──▶  ┌─────────────────────────────┐
                                │  Next.js (App Router)        │
  내부망 사용자 / 검토자  ─────▶ │  - POST /api/upload (zip)    │ ◀── ① 악성 zip 업로드
                                │  - GET  /api/file/[docId]    │ ◀── ② id 추측(IDOR)
                                │  - 기타 status/list API      │
                                └──────────────┬──────────────┘
                                               │ DB filepath
                                               ▼
                                ./data/uploads/{applicantId}/…   ◀── ③ 경로탈출/경로주입
                                ./data/minesweeper.db (PII)
```

| # | 위협 | 벡터 | 현재 방어 |
|---|---|---|---|
| ① | 악성 압축파일 (zip-slip / zip-bomb) | `POST /api/upload` 의 zip 본문 | `isUnsafeEntryPath` + `MAX_*` 상한 (§3) |
| ② | 권한 없는 PII 열람 (IDOR) | `GET /api/file/[documentId]` 등 id 기반 접근 | **Phase 1 미해결** → 네트워크 경계로 차단 (§5) |
| ③ | 경로주입으로 임의 파일 읽기 | 파일 서빙 경로 조작 | DB `filepath` 만 사용, 사용자 입력 미사용 (§4) |
| ④ | 외부로 PII 유출 (제3자 API) | LLM 추출 시 외부 클라우드 호출 | 기본 온프레, `EXTRACTOR_MODE` (§2) |
| ⑤ | PII가 git/배포 산출물에 혼입 | `./data` 커밋, 산출물 포함 | `.gitignore` 로 `/data` 비커밋 (§6) |

---

## 2. 온프레 우선 — 외부 클라우드 API를 강제하지 않음

개인정보·논문 전문·인장을 다루는 시스템은 데이터가 조직 경계를 벗어나는 순간 통제력을 잃습니다.
Minesweeper는 이 위험을 설계 기본값으로 차단합니다. README의 표현 그대로:

> 보안: 개인정보·논문 전문·인장을 다루므로 **외부 클라우드 API는 막힐 가능성이 큼** → 기본값은 온프레.

### 2.1 `EXTRACTOR_MODE` — 추출기는 교체 가능

Stage 3(Extract)의 추출기는 pluggable이며 `.env`의 `EXTRACTOR_MODE`로 선택합니다.

| 모드 | 동작 | 외부 통신 |
|---|---|---|
| `stub` (**기본값**) | 결정적 휴리스틱 추출기. GPU 불필요, 모든 테스트가 사용 | **없음** (완전 로컬) |
| `vlm` | OpenAI 호환 엔드포인트로 온프레 VLM 호출 (vLLM / Ollama) | 설정한 엔드포인트로만 |

`.env.example`의 기본값은 다음과 같습니다.

```bash
EXTRACTOR_MODE=stub

# On-prem VLM (OpenAI-compatible). Defaults below point at a local Ollama instance.
VLM_BASE_URL=http://localhost:11434/v1
VLM_API_KEY=ollama
VLM_MODEL=qwen3.5:9B
VLM_TIMEOUT_MS=120000
```

핵심은 `vlm` 모드조차 **기본 엔드포인트가 `http://localhost:11434/v1`(로컬 Ollama)** 이라는 점입니다.
즉, 운영 경로로 전환해도 데이터는 기본적으로 같은 호스트(또는 사내 vLLM/Ollama)에 머뭅니다. 어떤
설정값도 퍼블릭 클라우드 LLM API를 강제하지 않습니다. 외부로 보내고 싶다면 운영자가 의도적으로
`VLM_BASE_URL`을 외부 주소로 바꿔야 하며, 그 결정과 책임은 전적으로 운영자에게 있습니다.

> **권고.** `VLM_BASE_URL`을 외부로 돌리는 경우, 해당 엔드포인트가 조직의 데이터 처리 정책을 만족하는지
> (논문 전문·인장 이미지가 제3자 학습에 쓰이지 않는지) 반드시 확인하세요. 자세한 추출기 동작은
> [파이프라인 문서](./pipeline.md) 참고.

---

## 3. 업로드 / 압축해제 방어 (zip-slip · zip-bomb · DoS)

업로드 경로는 신뢰할 수 없는 입력(임의 zip)이 들어오는 가장 큰 공격 표면입니다. 방어는 두 곳에
나뉘어 있습니다: 업로드 라우트(`src/app/api/upload/route.ts`)의 크기 상한과, 압축해제
유틸(`src/lib/unzip.ts`)의 검증.

### 3.1 업로드 크기 상한 (`MAX_UPLOAD_BYTES`)

`POST /api/upload`는 압축해제 **전에** 업로드 자체의 바이트 수를 막습니다.

```ts
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);

if (file.size > MAX_UPLOAD_BYTES) {
  return NextResponse.json(
    { error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` },
    { status: 413 },
  );
}
```

- 필드 이름은 반드시 `file`이어야 하고, `File` 인스턴스가 아니면 `400`을 돌려줍니다.
- 한도 초과 시 HTTP **413**(Payload Too Large). 기본 200MB.

### 3.2 zip-slip 가드 — `isUnsafeEntryPath`

압축 파일은 `../../etc/...` 같은 경로를 품어 추출 시 대상 디렉터리 밖으로 파일을 쓰려는
zip-slip 공격을 시도할 수 있습니다. `unzip.ts`는 추출 **전에** 모든 엔트리 경로를 검증합니다.

```ts
/** True if a zip entry path would extract OUTSIDE destDir (zip-slip). */
export function isUnsafeEntryPath(destDir: string, entryName: string): boolean {
  const root = resolve(destDir);
  const rootPrefix = root + sep;
  const target = resolve(destDir, ...entryName.split('/'));
  return target !== root && !target.startsWith(rootPrefix);
}
```

`resolve`로 절대경로를 계산한 뒤, 결과가 정확히 `destDir`거나 `destDir + 경로구분자`로 시작하지
않으면 위험으로 판정합니다. 이는 adm-zip의 동작에 더한 **방어심층화(defense-in-depth)** 입니다.
위반 엔트리가 하나라도 있으면 추출 자체를 거부합니다.

```ts
if (isUnsafeEntryPath(destDir, e.entryName)) {
  throw new Error(`unsafe zip entry path (zip-slip): ${e.entryName}`);
}
```

### 3.3 zip-bomb / DoS 가드 — 엔트리 수·총 해제크기 상한

작은 압축파일이 풀리면 디스크·메모리를 폭발시키는 zip-bomb을 막기 위해, 추출 전에 두 상한을 검사합니다.

```ts
const MAX_ENTRIES = Number(process.env.MAX_ZIP_ENTRIES ?? 5000);
const MAX_TOTAL_BYTES = Number(process.env.MAX_ZIP_TOTAL_BYTES ?? 500 * 1024 * 1024);

if (allEntries.length > MAX_ENTRIES) {
  throw new Error(`zip has too many entries (${allEntries.length} > ${MAX_ENTRIES})`);
}
let totalBytes = 0;
for (const e of allEntries) {
  totalBytes += e.header.size;
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`zip uncompressed size exceeds limit (> ${MAX_TOTAL_BYTES} bytes)`);
  }
  // ... isUnsafeEntryPath 검사 ...
}
```

여기서 `e.header.size`는 압축이 아닌 **해제 후(uncompressed)** 크기이므로, 고압축비 zip-bomb이
디스크에 풀리기 전에 차단됩니다. 모든 검증이 통과한 뒤에야 `zip.extractAllTo(destDir, true)`가
실행됩니다.

### 3.4 방어 한도 한눈에 보기 (`.env.example`)

| 환경변수 | 기본값 | 단위 | 막는 위협 | 적용 위치 |
|---|---|---|---|---|
| `MAX_UPLOAD_BYTES` | `209715200` (200MB) | 업로드 zip 바이트 | 과대 업로드 / DoS | `upload/route.ts` |
| `MAX_ZIP_ENTRIES` | `5000` | zip 내 파일 개수 | 엔트리 폭발 zip-bomb | `unzip.ts` |
| `MAX_ZIP_TOTAL_BYTES` | `524288000` (500MB) | 총 해제 후 바이트 | 고압축비 zip-bomb | `unzip.ts` |

세 값 모두 환경변수로 재정의 가능하므로, 운영 환경의 디스크·메모리 여유에 맞춰 조정하세요.

### 3.5 검증 순서 (요약)

```
업로드 본문 수신
  └▶ file 필드/타입 검사 ............ 실패 → 400
  └▶ file.size > MAX_UPLOAD_BYTES ... 실패 → 413
디스크에 upload.zip 저장
unzipApplicant() 진입
  └▶ allEntries.length > MAX_ENTRIES ........ 실패 → throw
  └▶ Σ header.size > MAX_TOTAL_BYTES ........ 실패 → throw
  └▶ isUnsafeEntryPath(...) (모든 엔트리) ... 실패 → throw
  └▶ extractAllTo()  ← 모두 통과 후에만 실행
```

---

## 4. 파일 서빙은 DB `filepath`만 사용 (경로주입 차단)

원본 파일을 돌려주는 `GET /api/file/[documentId]`는 **디스크 경로를 사용자 입력에서 절대 받지
않습니다.** 입력은 `documentId` 하나뿐이고, 실제 경로는 DB의 `documents.filepath` 컬럼에서 옵니다.

```ts
export async function GET(_req: Request, { params }: { params: { documentId: string } }) {
  const db = getDb();
  const doc = (
    await db.select().from(documents).where(eq(documents.id, params.documentId)).limit(1)
  )[0];
  if (!doc) return new NextResponse('not found', { status: 404 });

  // Path comes from the DB (set during a controlled unzip), never from user input.
  const buf = await readFile(doc.filepath).catch(() => null);
  if (!buf) return new NextResponse('file missing', { status: 404 });
  // ...
}
```

`doc.filepath`는 업로드 시 `unzipApplicant`가 통제된 추출 과정에서 `join(destDir, ...parts)`로
생성한 경로입니다(`unzip.ts`). 즉 서빙 경로는 **이미 zip-slip 검증을 통과한 엔트리에서만** 유래하며,
사용자가 임의 경로 문자열을 주입할 표면이 없습니다. 따라서 `../../../etc/passwd` 같은 path traversal은
이 엔드포인트로는 성립하지 않습니다.

응답 헤더는 확장자 기반 MIME 매핑(`.pdf`, `.png`, `.jpg`, `.txt` 등; 미매핑 시
`application/octet-stream`)과 `cache-control: private, max-age=60`을 사용합니다. `private`은
공유 캐시(프록시)에 PII가 남지 않도록 하는 최소한의 조치입니다. 엔드포인트 상세는
[API 레퍼런스](./api.md) 참고.

---

## 5. 인증 경계 — Phase 1에는 인증이 없다 (IDOR)

**이것이 이 시스템에서 가장 중요한 보안 사실입니다.** Phase 1에는 빌트인 인증·인가가 없습니다.
`.env.example`에 명시적으로 경고하고 있습니다.

```
# SECURITY: Phase 1 has NO built-in authentication. Resources are addressed by id, so anyone
# who can reach the server can read applicant PII. Deploy on an internal network only and/or
# behind a reverse proxy that enforces auth. Do NOT expose this service to the public internet.
```

### 5.1 왜 IDOR인가

`GET /api/file/[documentId]`를 비롯한 리소스가 **id로만 주소화**되고 호출자 신원을 검사하지 않으므로,
서버에 도달할 수 있는 사람은 누구나 id를 알거나 추측해 지원자 PII를 읽을 수 있습니다
(Insecure Direct Object Reference). `documentId`는 `uuid`라 무작위 추측은 어렵지만, **추측 난이도는
인증이 아닙니다.** id가 로그·링크·이력에 한 번이라도 노출되면 그대로 열람으로 이어집니다.

```
요청자 ──(인증 없음)──▶ GET /api/file/{anyKnownId} ──▶ 200 + 파일 본문(PII)
        신원 검사 없음, 소유권 검사 없음
```

### 5.2 그래서 반드시 (배포 필수 조건)

| 해야 할 것 | 이유 |
|---|---|
| **내부망 전용 배포** | 공개 인터넷에서 도달 자체를 불가능하게 만든다 |
| **리버스 프록시에서 인증 강제** (예: SSO/Basic/mTLS) | 애플리케이션 인증 부재를 네트워크 계층에서 보완 |
| **공개 인터넷 노출 금지** | id 기반 접근이므로 노출 = PII 유출과 동치 |

이 조건들은 "권장"이 아니라 **배포 전제조건**입니다. 구체적 프록시·네트워크 설정은
[배포 가이드](./deployment.md)를 따르세요. 인증·인가의 애플리케이션 내장은 Phase 2 이후 과제입니다.

---

## 6. 데이터 저장 위치와 감사 로그

### 6.1 모든 민감 데이터는 `./data` 로컬에만

원본 zip, 추출된 원본 파일, 크롭 이미지, 임베디드 DB(개인 인장 포함)는 전부 로컬 `./data` 아래에만
저장되고 **git에 커밋되지 않습니다.**

```bash
# .env.example
DATABASE_URL=file:./data/minesweeper.db   # libsql 파일모드 (임베디드)
UPLOAD_DIR=./data/uploads                 # 업로드/추출 원본/크롭
```

업로드 라우트는 지원자별로 격리된 디렉터리를 만들고, 원본 zip과 추출물을 그 아래에만 둡니다.

```ts
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/uploads';
const applicantId = crypto.randomUUID();
const baseDir = join(UPLOAD_DIR, applicantId);   // ./data/uploads/{uuid}/
// upload.zip 저장 → ./data/uploads/{uuid}/files/ 로 추출
```

`.gitignore`가 이 전체 트리를 커밋 대상에서 제외합니다(주석까지 그대로):

```gitignore
# runtime data (uploads, crops, embedded db) — never commit applicant PII
/data
*.db
*.db-shm
*.db-wal
*.sqlite

# env
.env
.env.local
.env.*.local
```

즉 (a) 모든 런타임 PII가 담긴 `/data`, (b) SQLite WAL/SHM 보조 파일, (c) 비밀이 담긴 `.env` 계열이
모두 비커밋입니다. 원본·zip은 DB에 넣지 않고 디스크에만 두며, DB에는 경로(`filepath`)만 기록합니다.

### 6.2 `corrections` — 사람 교정 감사 로그

자동 추출은 초안이고 최종 판단은 사람이라는 원칙에 따라, 검토자가 가한 모든 교정은 `corrections`
테이블에 감사 로그로 적재됩니다(`src/db/schema.ts`).

```ts
/** Audit log of human corrections — future training data + accuracy tracking. */
export const corrections = sqliteTable('corrections', {
  id: text('id').primaryKey().$defaultFn(uuid),
  applicantId: text('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  personId: text('person_id'),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  action: text('action').$type<'confirm' | 'edit' | 'reject' | 'exclude'>().notNull(),
  createdAt: createdAt(),
});
```

- `action`은 `confirm | edit | reject | exclude` 중 하나로, 검토자가 무엇을 했는지 추적합니다.
- `oldValue` / `newValue`로 변경 전후를 보존하므로 누가-무엇을-바꿨는지 사후 추적과 정확도 측정이
  가능합니다.
- 보안 관점에서 `corrections` 자체도 검토자의 판단을 담은 민감 데이터입니다. `applicantId` 외래키는
  `onDelete: 'cascade'`라 지원자 삭제 시 함께 정리됩니다. 다만 이 로그는 PII(`oldValue`/`newValue`에
  이름 등)를 포함할 수 있으므로 동일하게 내부망·접근통제 대상으로 취급해야 합니다.

---

## 7. 운영 권고

코드가 막아주는 것과 운영자가 책임져야 하는 것을 구분하는 표입니다.

| 영역 | 코드가 보장 | 운영자가 책임 |
|---|---|---|
| 인증/인가 | 없음 (Phase 1) | **내부망 전용 + 리버스 프록시 인증** (§5) — 필수 |
| 네트워크 노출 | 없음 | 공개 인터넷 차단, 방화벽/VPN |
| 외부 데이터 전송 | 기본 온프레, 강제 안 함 | `VLM_BASE_URL` 외부 전환 시 정책 검토 (§2) |
| 업로드 안전 | zip-slip/zip-bomb/크기 상한 | 디스크 여유에 맞춰 `MAX_*` 조정 |
| 저장 데이터 | `/data` 로컬·비커밋 | 디스크 암호화, 백업 접근통제 |
| 비밀값 | `.env` 비커밋 | `.env`/`VLM_API_KEY` 파일 권한 관리 |

추가 권고:

- **접근 통제.** 서버 호스트와 `./data` 디렉터리(특히 `minesweeper.db`)에 대한 OS 수준 접근을
  검토 담당자·운영자로 한정하세요. 인증이 애플리케이션에 없으므로, 호스트·네트워크 접근통제가
  사실상 유일한 인가 계층입니다.
- **인장/서명 이미지의 민감 취급.** `seal`·`signature`(그리고 `handwriting`) 크롭은 위·변조 악용
  소지가 있는 신원증표입니다. 별도 다운로드/공유를 최소화하고, 검토 큐(`needs_vision` 등 `FLAG_TYPES`)
  바깥으로 유출되지 않게 관리하세요. 자동 추출은 이들을 _판독하지 않고_ 사람 검토로 넘긴다는 원칙을
  운영 정책으로도 유지하세요.
- **로그 위생.** `documentId`·`applicantId`(uuid)가 프록시/애플리케이션 로그에 남으면 §5.1의 IDOR
  표면이 넓어집니다. 접근 로그 보존·열람을 통제하세요.
- **보존·파기.** 채용 절차 종료 후 `./data` 원본·크롭과 DB 레코드의 보존기간을 조직 개인정보 정책에
  맞춰 정하고 파기하세요. `applicants` 삭제 시 외래키 `cascade`로 연관 레코드가 정리됩니다.

---

## 관련 문서

- [배포 가이드](./deployment.md) — 내부망 배포, 리버스 프록시 인증 구성
- [API 레퍼런스](./api.md) — `upload` / `file/[documentId]` 등 엔드포인트 계약
- [파이프라인](./pipeline.md) — 4단 처리와 추출기(`stub`/`vlm`) 동작
