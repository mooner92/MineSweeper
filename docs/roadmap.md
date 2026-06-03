# 로드맵·범위·리스크·열린질문

> 이 문서는 Minesweeper(채용 이해충돌 관계자 추출 시스템)의 **현재 구현 상태**, **단계별 로드맵
> (Phase 0/1/1.5/2)**, **In/Out of scope**, **리스크와 대응**, 그리고 **착수 전 선결해야 할 7가지
> 의사결정**을 정리한다. 근거는 개발계획서 §11(로드맵)·§1.3(범위)·§12(리스크)·§13(선결 의사결정)이며,
> 현재 상태는 저장소의 실제 코드(`src/`)·테스트(`tests/`)·`prd.json`·`progress.txt`에서 직접 확인한 사실만
> 기재한다. 추측·미구현 기능의 단정은 배제한다.
>
> **대원칙(전 단계 공통): 자동추출은 _초안_, 최종판단은 _사람_. 문서에 없는 이름은 절대 지어내지 않는다.**
>
> 관련 문서: [architecture.md](./architecture.md) · [pipeline.md](./pipeline.md) ·
> [model-evaluation.md](./model-evaluation.md)

---

## 1. 현재 상태 요약 (완료 / 부분 / 미구현)

Phase 1 MVP는 완료·검증되었다. 검증 게이트 결과는 다음과 같다(출처: `progress.txt`, `prd.json`).

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npm run typecheck` (`tsc --noEmit`) | 0 errors |
| 단위·통합 테스트 | `npm test` (vitest) | **51 tests green** |
| 프로덕션 빌드 | `npm run build` (`next build`) | exit 0, 10 routes, no warnings |
| PRD 스토리 | US-001 ~ US-011 | 11/11 `passes: true` |

### 1.1 4단 파이프라인 — 단계별 상태

형식차이는 **1단(Ingest)** 에만, 문서유형차이는 **3단(Extract)** 에만 나타난다. 2·4단과 데이터모델·UI는
형식/유형 무관하다(`progress.txt` ARCHITECTURE DECISIONS). 자세한 데이터 흐름은
[pipeline.md](./pipeline.md) 참고.

| 단계 | 코드 | 상태 | 비고 |
|---|---|---|---|
| (1) Ingest — 형식 정규화 | `src/lib/pipeline/ingest/` | 완료(부분) | `pdf`·`image`·`text` 실동작, **`hwp`는 placeholder**(미지원 플래그만 세움, `ingest/hwp.ts`) |
| (2) Type — 유형 분류 | `src/lib/pipeline/classify.ts` | 완료 | 우선순위 `[tag] > filename(hindex) > folder > 1p content > default` |
| (3) Extract — 유형별 추출 | `src/lib/pipeline/extract/` | 완료(stub) + 와이어드(vlm) | 기본 `stub`(결정적), `vlm`은 구현·typecheck OK이나 **테스트 미수행** |
| (4) Aggregate — 사람단위 통합 | `src/lib/pipeline/aggregate.ts` | 완료 | dedup + 역할 합집합 + 본인 제외, 병합은 보수적 |

### 1.2 시스템 컴포넌트 — 상태 매트릭스

| 영역 | 구현 | 상태 | 근거(파일) |
|---|---|---|---|
| 데이터모델(7 테이블) | Drizzle + libsql file mode | 완료 | `src/db/schema.ts` (`applicants` / `documents` / `extracted_persons` / `person_aggregates` / `jobs` / `review_flags` / `corrections`) |
| 마이그레이션 | drizzle-kit `0000` 생성·적용 | 완료 | `src/db/migrate.ts`, `drizzle/` |
| 백그라운드 워커 | `jobs` 테이블 폴링 | 완료 | `src/worker/index.ts`, `process.ts`, `queue.ts` |
| 큐(enqueue/claim/complete/fail) | 잡 수명주기 | 완료 | `src/worker/queue.ts` (`JOB_STATUSES = queued\|running\|done\|error`) |
| 추출기 — stub | 결정적 휴리스틱 | 완료 | `extract/stub.ts` (모든 테스트가 사용) |
| 추출기 — vlm | OpenAI 호환 HTTP, 기본 Ollama `qwen3.5:9B` | 와이어드(미실행) | `extract/vlm.ts`, `getExtractor(EXTRACTOR_MODE)` in `extract/index.ts` |
| 이름 정규화/매칭 | 자간정규화·이니셜·보수적 매칭 | 완료 | `src/lib/names.ts` |
| 업로드/압축해제 | zip-slip 차단 + 크기·개수 상한 | 완료 | `src/lib/unzip.ts`, `src/app/api/upload/route.ts` |
| 검토 UI | 지원자별 검토 + 검토필요 큐 | 완료 | `src/app/applicants/[id]/page.tsx`, `src/app/review-queue/page.tsx` |
| API Route Handlers | upload/status/persons/file/export(2) | 완료 | `src/app/api/{upload,status/[applicantId],persons/[id],file/[documentId],export/[applicantId],review-queue/export}/route.ts` |
| 내보내기 | CSV / Excel | 완료 | `src/lib/csv.ts`, `src/lib/export.ts` (exceljs) |
| 교정 로그 | 사람 교정 적재(향후 학습데이터) | 완료 | `corrections` 테이블, `action: confirm\|edit\|reject\|exclude` |
| 인증/인가 | — | **미구현(의도적 범위 밖)** | README 보안 절: Phase 1은 인증 없음, 내부망 전제 |
| HWP/HWPX 정식 변환 | — | 미구현 | `ingest/hwp.ts` placeholder, Phase 2 |
| 인물 소속 자동검색 | — | 미구현 | README 범위 Out, Phase 2 |
| 내부직원 관계(부서장·실장·과제책임자) | enum만 모델링 | **부분(데이터모델만)** | `ROLES`에 `division_head\|office_head\|project_manager` 존재, 추출 로직 없음 |
| 인사혁신처 DB 수집 | — | 미구현 | README 범위 Out, Phase 2 |
| 도장 전용 엔진/파인튜닝 | — | 미구현 | README 범위 Out, Phase 2 |

> **부분 구현 주의:** 내부직원 역할 3종(`division_head`·`office_head`·`project_manager`)은 `domain.ts`의
> `ROLES`와 `ROLE_LABELS_KO`에 **미래 대비로 미리 모델링**되어 있을 뿐, 이를 산출하는 추출 경로는 아직 없다
> (`extract/roles.ts`의 `LABEL_TO_ROLE`에 라벨 매핑은 있으나 stub/vlm이 능동적으로 채우지 않음). 데이터모델이
> 준비됐다는 의미이지 기능이 동작한다는 의미가 아니다.

---

## 2. Phase 0 / 1 / 1.5 / 2 — 항목·의존성·상대규모

개발계획 §11 기준 4단계. "상대규모"는 구현·검증 노력의 대략적 크기(S/M/L/XL)이며 절대 공수가 아니다.

```
Phase 0 (기반/결정)
   └─▶ Phase 1 (MVP)  ← 현재 여기까지 완료
          ├─▶ Phase 1.5 (운영 강화: VLM 실측·HWP·인증)
          └─▶ Phase 2 (확장: 소속검색·내부관계·외부DB·도장엔진)
```

### Phase 0 — 기반·의사결정 (완료)

| 항목 | 상대규모 | 의존성 | 상태 |
|---|---|---|---|
| 도메인 어휘 확정(formats/doc-types/roles/source-kinds/flags) | S | — | 완료(`src/lib/domain.ts`) |
| 4단 파이프라인 경계 설계(형식=1단, 유형=3단) | M | 도메인 어휘 | 완료 |
| 스택 선정(네이티브 컴파일 회피: libsql·no sharp/canvas) | M | — | 완료 |
| 추출기 추상화(`Extractor` 인터페이스, pluggable) | S | 파이프라인 경계 | 완료(`pipeline/types.ts`) |

### Phase 1 — MVP (완료)

| 항목(PRD 스토리) | 상대규모 | 의존성 | 상태 |
|---|---|---|---|
| US-001 스캐폴드·툴링 | S | — | 완료 |
| US-002 데이터모델·DB·마이그레이션 | M | US-001 | 완료 |
| US-003 Stage1 Ingest 어댑터 | M | US-002 | 완료(hwp placeholder) |
| US-004 Stage2 분류기 | M | US-003 | 완료 |
| US-005 이름 정규화·보수적 매칭 | M | US-002 | 완료 |
| US-006 Stage3 추출(stub+vlm+prompts) | L | US-004, US-005 | 완료(vlm 미실측) |
| US-007 Stage4 집계(dedup+역할합집합+본인제외) | M | US-005, US-006 | 완료 |
| US-008 파이프라인 오케스트레이션+unzip+export | L | US-003~007 | 완료 |
| US-009 백그라운드 워커+큐 | M | US-008 | 완료 |
| US-010 검토 UI+API+내보내기 엔드포인트 | XL | US-009 | 완료 |
| US-011 README·스크립트·이식성 | S | 전체 | 완료 |

### Phase 1.5 — 운영 강화 (미착수)

Phase 1에서 "와이어드만 됨"인 것을 실제로 운영 가능하게 만드는 단계. 외부 의존(GPU·온프레 모델 운영)이
들어온다.

| 항목 | 상대규모 | 의존성 | 비고 |
|---|---|---|---|
| VLM 추출 실측·정확도 측정 | L | Phase 1, 온프레 GPU/Ollama | `vlm.ts`는 typecheck만 통과. 모델/프롬프트 튜닝은 [model-evaluation.md](./model-evaluation.md) 참고 |
| HWP/HWPX 정식 어댑터(→pdf/text 변환) | L | Phase 1 Ingest | 현재 `ingest/hwp.ts` placeholder, `needs_vision` 플래그로 대체 |
| 인증/인가(리버스 프록시 또는 앱 내장) | M | Phase 1 | Phase 1은 IDOR 노출(내부망 전제). 외부망 노출 시 선결 |
| 잡 재시도·관측(현 `attempts`/`error` 활용) | S | 워커 | `jobs.attempts`·`jobs.error` 컬럼 이미 존재 |
| 교정 로그 기반 정확도 추적 | M | `corrections` 적재 | 사람 교정 → 정확도/리콜 리포트 |

### Phase 2 — 확장 (미착수)

개발계획 §1.3의 "Out (Phase 2+)" 항목들. 도메인 enum에 일부 미리 자리만 잡혀 있다.

| 항목 | 상대규모 | 의존성 | 현 상태 단서 |
|---|---|---|---|
| 추출 인물 소속 자동검색 | L | Phase 1.5 VLM 실측 | `extracted_persons.affiliation`·`person_aggregates.affiliation` 컬럼 존재 |
| 내부 직원 관계(부서장·실장·과제책임자) | L | 외부 인사 DB | `ROLES`에 `division_head`·`office_head`·`project_manager` 모델링됨(추출 로직 없음) |
| 인사혁신처 DB 수집/연동 | XL | 외부 API 정책 결정(§13) | 미구현 |
| 도장 전용 OCR 엔진/파인튜닝 | XL | VLM 실측, 학습데이터(`corrections`) | 현재 도장은 `seal` 플래그로 사람에게 위임 |
| 합·불 판정 자동화 | — | **범위 밖(사람의 몫)** | 절대 자동화하지 않음(대원칙) |

---

## 3. In / Out of Scope (§1.3)

근거: README "범위" 절 + 개발계획 §1.3. **In = Phase 1에서 동작**, **Out = Phase 2+ 또는 영구 제외**.

| 구분 | 항목 | 비고 |
|---|---|---|
| **In** | 문서 기반 관계자 추출 | 4단 파이프라인 |
| **In** | 형식 통합 처리(pdf/image/text) | `hwp`는 placeholder |
| **In** | 도장·손글씨 별도 검토 큐 | `review_flags`, `FLAG_TYPES` |
| **In** | 검토 UI(확인/수정/제외, 본인 자동제외) | `corrections` 적재 |
| **In** | 명단 내보내기(CSV/Excel) | 본인·제외 항목 제외 |
| **Out (Phase 2+)** | 추출 인물 소속 자동검색 | 컬럼만 존재 |
| **Out (Phase 2+)** | 내부 직원 관계(부서장·실장·과제책임자) | enum만 모델링 |
| **Out (Phase 2+)** | 인사혁신처 DB 수집 | — |
| **Out (Phase 2+)** | HWP/HWPX 정식 어댑터 | placeholder만 |
| **Out (Phase 2+)** | 도장 전용 엔진/파인튜닝 | `seal` 플래그로 위임 |
| **Out (영구)** | 합·불 판정 | 사람의 몫 — 자동화 금지 |
| **Out (Phase 1)** | 인증/인가 | 내부망 전제, Phase 1.5 후보 |

```
        IN (Phase 1, 동작)                 OUT (Phase 2+ / 영구)
   ┌──────────────────────────┐    ┌──────────────────────────────┐
   │ 문서기반 추출            │    │ 소속 자동검색                 │
   │ 형식통합(pdf/img/text)   │    │ 내부직원 관계                 │
   │ 도장·손글씨 검토 큐      │    │ 인사혁신처 DB 수집            │
   │ 검토 UI(+본인 자동제외)  │    │ HWP/HWPX 정식 어댑터          │
   │ CSV/Excel 내보내기       │    │ 도장 전용 엔진/파인튜닝       │
   └──────────────────────────┘    │ ─────────────────────────── │
                                    │ 합·불 판정 (영구 제외)        │
                                    └──────────────────────────────┘
```

---

## 4. 리스크 표와 대응 (§12)

확률(P)·영향(I)은 H/M/L. "현 상태"는 코드에서 확인되는 완화 수단을 기재한다.

| # | 리스크 | P | I | 대응 | 현 상태 |
|---|---|---|---|---|---|
| R1 | **외부 클라우드 API 금지** — PII·논문전문·인장 취급으로 외부 API 차단 가능성 큼 | H | H | **온프레 VLM 기본**(OpenAI 호환, vLLM/Ollama). 외부 API 강제 안 함 | 완화됨 — `EXTRACTOR_MODE=stub` 기본, `vlm`은 `VLM_BASE_URL` 로컬 기본 |
| R2 | **자동추출 오류·과병합(동명이인)** | H | H | 보수적 매칭(이니셜/교차스크립트/단독이니셜 미병합), 모호건 분리 | 완화됨 — `names.namesMatch`, `aggregate`(병합 보수적) |
| R3 | **이름 지어내기(fabrication)** | M | H | 문서에 있는 이름만 추출, 없으면 `[]` | 완화됨 — stub: 참고문헌 차단·제목줄 배제·저자신호 요구; hindex→`[]` |
| R4 | **도장·손글씨·서명 판독 실패** | H | M | 자동추출 비약속 → **검토필요 큐**로 사람 위임 | 완화됨 — `FLAG_TYPES = seal\|handwriting\|signature\|...`, `needs_vision` |
| R5 | **스캔 PDF/이미지 텍스트 부재** | M | M | 페이지 이미지 동봉 전송(vlm), 텍스트 없으면 `needs_vision` 플래그 | 완화됨 — `run.ts` imagePaths, `process.ts` needs_vision 분기 |
| R6 | **인증 부재로 PII 노출(IDOR)** | M | H | 내부망 전용 배포, 리버스 프록시 인증, 공개망 금지 | 부분 — 문서화됨(README/.env.example), 앱 내장 인증은 미구현 |
| R7 | **업로드 DoS(zip-bomb/경로탈출)** | M | H | 크기·개수 상한 + zip-slip 차단 | 완화됨 — `MAX_UPLOAD_BYTES`/`MAX_ZIP_ENTRIES`/`MAX_ZIP_TOTAL_BYTES`, `isUnsafeEntryPath()` |
| R8 | **HWP/HWPX 미지원으로 누락** | M | M | placeholder가 크래시 대신 플래그, 사람이 별도 확인 | 부분 — `ingest/hwp.ts` placeholder + `needs_vision` |
| R9 | **VLM 정확도 미검증**(운영 전환 시) | H | H | 실측·프롬프트/모델 튜닝, 교정 로그로 추적 | 미완화 — `vlm.ts` 테스트 미수행(Phase 1.5) |
| R10 | **잡 실패·부분 적재** | L | M | 트랜잭션으로 clear+rebuild 원자화, `attempts`/`error` 기록 | 완화됨 — `process.ts` `db.transaction(...)` |
| R11 | **이식성·네이티브 빌드 실패** | L | M | libsql file mode, sharp/canvas 미사용, 클라이언트 bbox 오버레이 | 완화됨 — `clone && npm i`로 동작 |

---

## 5. 선결 의사결정 7가지 (§13)

운영 전환·Phase 1.5/2 착수 전에 조직이 **반드시 답해야 하는** 결정. 각 항목에 현재 코드의 기본값/영향을
명시한다.

| # | 결정 사항 | 선택지 | 현재 기본값 / 영향 |
|---|---|---|---|
| D1 | **외부 클라우드 API 사용 가부** | 온프레 전용 / 외부 허용 / 하이브리드 | 기본 온프레(`EXTRACTOR_MODE=stub`→`vlm` 로컬). 외부 허용 시 `VLM_BASE_URL`/`VLM_API_KEY`만 교체 가능하나 PII 정책 충돌 위험(R1) |
| D2 | **온프레 모델·서빙 스택** | Ollama / vLLM / 기타 | 기본 `qwen3.5:9B` @ `http://localhost:11434/v1`. GPU·메모리·동시성 사이징 필요([model-evaluation.md](./model-evaluation.md)) |
| D3 | **인증/인가 방식** | 리버스 프록시 / 앱 내장 / SSO | 미구현(IDOR). 외부망 노출 전 필수(R6). Phase 1.5 후보 |
| D4 | **HWP/HWPX 지원 범위·변환 경로** | 미지원 유지 / hwp→pdf 변환 / hwp→text | 현재 placeholder. 변환 도구·라이선스·정확도 결정 필요 |
| D5 | **인사혁신처/외부 인사 DB 연동** | 미연동 / 수집 / API연동 | 미구현. D1과 연동된 데이터 거버넌스 결정 |
| D6 | **PII 보존 정책·데이터 수명주기** | 로컬 보존 / 만료삭제 / 감사로그 | 원본·크롭·DB는 `./data/` 로컬·미커밋. 보존기간·파기 정책 결정 필요 |
| D7 | **정확도 목표·합격 기준(검수 SLA)** | 리콜/정밀도 임계, 검토 큐 처리시간 | 현 임계 `confidence < 0.7 → needs_human`(`process.ts`/`aggregate.ts`). 목표치·교정 로그 활용 방침 결정 |

> **모든 결정의 상위 제약:** 어떤 선택을 하든 **자동추출은 초안이고 최종판단은 사람**이라는 원칙은 불변이며,
> **합·불 판정 자동화는 영구 범위 밖**이다.

---

## 부록 — 검증된 도메인 상수 (인용)

아래는 `src/lib/domain.ts`에서 직접 인용한 정본 값이다. 로드맵의 Phase/리스크/결정이 참조한다.

| 상수 | 값 |
|---|---|
| `SOURCE_FORMATS` | `pdf` · `image` · `hwp` · `text` |
| `DOC_TYPES` | `degree_thesis` · `representative_research` · `journal_article` · `hindex` · `unknown` |
| `ROLES` | `supervisor` · `co_supervisor` · `committee` · `department_head` · `principal_investigator` · `research_staff` · `coauthor` · `division_head` · `office_head` · `project_manager` |
| `SOURCE_KINDS` | `printed` · `handwritten` · `seal` · `signature` |
| `FLAG_TYPES` | `seal` · `handwriting` · `signature` · `low_confidence` · `ambiguous` · `needs_vision` |
| `JOB_STATUSES` | `queued` · `running` · `done` · `error` |
| 추출기 모드 | `stub`(기본·테스트) / `vlm`(온프레, 기본 Ollama `qwen3.5:9B`) — `getExtractor(EXTRACTOR_MODE)` |

추출기 선택 시그니처(인용, `src/lib/pipeline/extract/index.ts`):

```ts
export function getExtractor(mode: string = process.env.EXTRACTOR_MODE ?? 'stub'): Extractor {
  return mode === 'vlm' ? new VlmExtractor() : new StubExtractor();
}
```

관련 문서: [architecture.md](./architecture.md)(컴포넌트·배포) ·
[pipeline.md](./pipeline.md)(4단 데이터 흐름) ·
[model-evaluation.md](./model-evaluation.md)(VLM 실측·정확도).
