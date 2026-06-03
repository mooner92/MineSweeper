# Minesweeper — 채용 이해충돌 관계자 추출 (Phase 1 MVP)

지원자 첨부서류(학위논문·연구실적·구글스칼라 캡처 등)에서 이해충돌 관계자("지뢰" — 지도교수·심사위원·공저자
등)를 **자동 추출**해 출처와 함께 보여주고, 담당자가 **육안으로 검토·수정·확정**하는 내부 웹서비스입니다.

> **원칙: 결과를 맹신하지 않는다.** 자동 추출은 _초안_ 이며, 최종 판단은 항상 사람이 합니다. 추출기는
> 문서에 실제로 있는 이름만 뽑고, 없으면 "없음"으로 둡니다(지어내지 않음).

## 📚 문서

상세 문서는 [`docs/`](./docs/README.md)에 있습니다.

| 영역 | 문서 |
|---|---|
| 아키텍처 / 파이프라인 | [architecture](./docs/architecture.md) · [pipeline](./docs/pipeline.md) |
| 추출기 / 이름 매칭 | [extractors](./docs/extractors.md) · [names-and-matching](./docs/names-and-matching.md) |
| 데이터 / 워커 | [data-model](./docs/data-model.md) · [worker](./docs/worker.md) |
| API / UI | [api](./docs/api.md) · [ui](./docs/ui.md) |
| 보안 / 개발 / 배포 | [security](./docs/security.md) · [development](./docs/development.md) · [deployment](./docs/deployment.md) |
| 모델 평가 / 로드맵 | [model-evaluation](./docs/model-evaluation.md) · [roadmap](./docs/roadmap.md) |

---

## 4단 파이프라인

모든 파일은 형식(PDF/이미지/HWP/텍스트)과 무관하게 동일한 4단을 통과합니다.
**형식이 달라지는 건 1단뿐, 문서유형이 달라지는 건 3단뿐**입니다.

```
[zip 업로드]
  └▶ (1) Ingest   형식 정규화 → 페이지 묶음(텍스트 + 페이지 이미지)   src/lib/pipeline/ingest/
     (2) Type     폴더 + [태그] 우선, 안 잡히면 1p 내용 폴백          src/lib/pipeline/classify.ts
     (3) Extract  유형별 추출(이름·역할·소속·출처·신뢰도)            src/lib/pipeline/extract/
     (4) Aggregate 사람 단위 dedup + 역할 합집합 + 본인 제외          src/lib/pipeline/aggregate.ts
          └▶ [관계자 명단]  +  [검토 필요 큐]  →  검토 UI
```

- **형식 확장** = 1단 어댑터 1개 추가 (현재: pdf / image / hwp(placeholder) / text)
- **문서유형 확장** = 3단 프롬프트 1개 추가 (현재: 학위논문 / 대표연구실적 / 학술논문 / hindex)

## Stage 3 추출기 — 교체 가능(pluggable)

| 모드 | 구현 | 용도 |
|---|---|---|
| `stub` (기본) | `extract/stub.ts` | 결정적 휴리스틱. GPU 불필요, **모든 테스트가 사용** |
| `vlm` | `extract/vlm.ts` | 온프레 VLM(OpenAI 호환: vLLM/Ollama). 운영 경로 |

`EXTRACTOR_MODE=vlm` 로 전환하면 `VLM_BASE_URL`(기본 `http://localhost:11434/v1`, 로컬 Ollama)의
모델을 호출합니다. 텍스트가 없는 스캔 PDF/이미지(hindex)는 페이지 이미지를 함께 전송합니다.

> 보안: 개인정보·논문 전문·인장을 다루므로 **외부 클라우드 API는 막힐 가능성이 큼** → 기본값은 온프레.
> 도장·손글씨·판독난해 서명은 자동 추출을 약속하지 않고 **검토 필요 큐**로 모아 사람이 확인합니다.

## 기술 스택

- **Next.js 14**(App Router) 풀스택 — UI + API Route Handlers
- **백그라운드 워커**(별도 node 프로세스, `jobs` 테이블 폴링) — 대용량 배치 안전 처리
- **임베디드 DB**: libsql 파일모드(`@libsql/client`) + **Drizzle ORM** → `git clone && npm i` 로 끝나는 이식성
- **로컬 디스크 저장**: `./data/uploads/{지원자ID}/…` (원본/zip은 DB에 넣지 않음)
- 네이티브 컴파일 없음(better-sqlite3·sharp·canvas 미사용) → 어디서나 동일하게 동작

## 빠른 시작

```bash
git clone <repo> && cd MineSweeper
npm install
cp .env.example .env          # 필요 시 VLM/DB 설정 수정
npm run db:migrate            # ./data/minesweeper.db 생성 + 스키마 적용
npm run dev:all               # 웹(:3000) + 워커 동시 기동
```

`http://localhost:3000` 에서 지원자 zip 업로드 → 추출 진행률 표시 → 지원자별 검토 화면.

### 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev:all` | 웹 + 워커 동시 기동 (`concurrently`) |
| `npm run dev` / `npm run worker` | 웹 / 워커 개별 기동 |
| `npm run db:generate` | 스키마 변경 → 마이그레이션 생성 |
| `npm run db:migrate` | 마이그레이션 적용 |
| `npm run build` / `npm start` | 프로덕션 빌드 / 기동 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest (파이프라인 전 구간) |

## 검토 UI

1. **업로드** — zip 업로드 → 추출 시작, 진행률 폴링.
2. **지원자별 검토** — 역할/문서별 그룹, 출처(문서·페이지) 표시, **인쇄·고신뢰 = 초록 "자동 통과"** /
   **비인쇄·저신뢰 = 노랑 "미확인"**, 확인/수정/제외, **본인 자동 제외**. 교정 내역은 `corrections` 에 적재.
3. **검토 필요 큐** — 도장·손글씨·비전판독 필요 항목을 크롭 갤러리로 모아보기.
4. **명단 내보내기** — 지원자별 최종 명단을 **CSV / Excel** 로(심사위원 풀 대조용). 본인·제외 항목은 빠집니다.

## 데이터 모델 (요약)

`applicants` 1 : N `documents` 1 : M `extracted_persons` → `person_aggregates`(사람 단위 통합).
배치 큐 `jobs`, 검토 큐 `review_flags`, 교정 로그 `corrections`. 자세한 컬럼은
`src/db/schema.ts` 참고.

## 디자인

[seed-design](https://github.com/daangn/seed-design) 원칙(시맨틱 토큰·캐럿 액센트·접근성)을 따른
토큰을 `src/app/globals.css` + `tailwind.config.ts` 에 정의했습니다.

## 보안 / 배포

- **인증은 Phase 1 범위 밖**입니다. 리소스는 id로 접근되므로(파일·명단·상태 API) **서버에 접근 가능한
  사람은 지원자 PII를 열람**할 수 있습니다 → **반드시 내부망에만 배포**하고, 필요 시 리버스 프록시에서 인증을
  강제하세요. 공개 인터넷에 노출 금지.
- 업로드/압축해제는 **zip-slip 차단 + 크기·개수 상한**(`MAX_UPLOAD_BYTES`, `MAX_ZIP_ENTRIES`,
  `MAX_ZIP_TOTAL_BYTES`)으로 zip-bomb/경로탈출을 방어합니다. 파일 서빙은 DB에 기록된 경로만 사용합니다.
- 원본·크롭·DB(개인 인장 포함)는 `./data/` 로컬에만 저장하며 git에 커밋되지 않습니다(`.gitignore`).
- 추출은 **온프레 LLM 기본** — 외부 클라우드 API를 강제하지 않습니다.

## 범위

- **In**: 문서 기반 관계자 추출, 형식 통합 처리, 도장·손글씨 별도 검토 큐, 검토 UI, 명단 내보내기.
- **Out (Phase 2+)**: 추출 인물 소속 자동검색, 내부 직원 관계(부서장·실장·과제책임자), 인사혁신처 DB 수집,
  HWP/HWPX 정식 어댑터, 도장 전용 엔진/파인튜닝, 합·불 판정(= 사람의 몫).
