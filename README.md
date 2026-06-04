# Minesweeper — 채용 이해충돌 관계자 추출 (Phase 1 MVP)

지원자 첨부서류(학위논문·연구실적·구글스칼라 캡처 등)에서 이해충돌 관계자("지뢰" — 지도교수·심사위원·공저자
등)를 **자동 추출**해 출처와 함께 보여주고, 담당자가 **육안으로 검토·수정·확정**하는 내부 웹서비스입니다.

> **원칙: 결과를 맹신하지 않는다.** 자동 추출은 _초안_ 이며, 최종 판단은 항상 사람이 합니다. 추출기는
> 문서에 실제로 있는 이름만 뽑고, 없으면 "없음"으로 둡니다(지어내지 않음).

## 📊 진행 상황 / 계획

- **[진척도(구현 현황)](./docs/progress.md)** — 2026-05-22 세종 미팅 요구사항 대비 무엇이 되고 안 되는지 한눈에
- **[OCR 개선계획](./docs/improvement-plan-ocr.md)** — 도장·손글씨 OCR·신뢰도·오추출 교차검증(계획)
- **[미팅 정리](./docs/meeting-2026-05-22-sejong.md)** · **[로드맵](./docs/roadmap.md)**

## 📚 문서

상세 문서는 [`docs/`](./docs/README.md)에 있습니다.

| 영역 | 문서 |
|---|---|
| 진행 / 계획 | [progress(진척도)](./docs/progress.md) · [improvement-plan-ocr](./docs/improvement-plan-ocr.md) · [실샘플 검증 절차](./docs/validation-real-samples.md) · [meeting-2026-05-22-sejong](./docs/meeting-2026-05-22-sejong.md) |
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
| `hybrid` | `extract/hybrid.ts` | **텍스트 문서=stub / 이미지·스캔 문서=VLM OCR** 라우팅 |
| `vlm` ✅운용 | `extract/vlm.ts` | **전수 단일 온프레 VLM**(OpenAI 호환: 로컬 vLLM/Ollama) |
| `ensemble` | `extract/ensemble.ts` | **로컬 vLLM 모델 3종을 투표**(합의=신뢰도, 불일치=사람에게). 정밀도/필터링↑ |

현재 운용값은 `vlm` — 실제 논문 저자블록(예: `Hyung-Min Lee a,b, Rokjin J. Park a,*`)이나 한국어
학위논문 인준 페이지는 LLM이라야 제대로 읽는다. 결정적 `stub`은 이런 실문서에서 0건을 반환해(휴리스틱 한계)
운영에는 부적합 — 빠른 테스트/GPU 미사용 시에만 쓴다. `hybrid`는 텍스트=stub·이미지=VLM 절충.

**도장/서명 감지(`DETECT_MARKS=1`)**: 인준/저자 페이지를 이미지로 렌더해 VLM에 **도장·서명·손글씨의
위치(bbox)** 를 물어(글자는 안 읽음) **크롭 + 검토 큐**로 올립니다. "타이핑 없이 — 이름은 추출, 도장 있는
문서만 골라 크롭으로 확인". `extract/detect.ts`·`worker/detect-marks.ts`, 크롭 서빙 `/api/crop/[flagId]`.

**앙상블(`ensemble`)**: `VLM_ENSEMBLE` 의 여러 로컬 vLLM 엔드포인트로 투표(`votes/N`=신뢰도, 불일치→사람).
서버 기동 [`scripts/serve-ocr.sh`](./scripts/serve-ocr.sh), 자세히는 [docs/extractors.md](./docs/extractors.md)·[docs/deployment.md](./docs/deployment.md).

> ✅ **현재 라이브**: GPU1에 `Qwen2.5-VL-7B-Instruct` 를 vLLM(:8010)로 운용 중, 추출기는 `vlm`. 실제
> 합격자 ZIP(논문 13건)에서 관계인 23명(공저자·지도교수 등) 추출 + 도장/서명 감지 **end-to-end 확인**. (동시 3모델 앙상블은 VRAM
> 부담이라 지금은 단일 경량 모델 운용.) 재부팅 유지용 systemd 유닛: [`deploy/vllm-ocr-8010.service`](./deploy/vllm-ocr-8010.service).
> 실제 정확도/임계값 검증 절차: [docs/validation-real-samples.md](./docs/validation-real-samples.md). 현황: [docs/progress.md](./docs/progress.md).

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

> 개발은 `dev:all`(웹 `:3000` + 워커), 프로덕션은 아래 PM2로 운영합니다.

## 프로덕션 배포 (PM2 + Cloudflare Tunnel)

빌드 후 **PM2**로 웹·워커를 함께 관리합니다. 프로세스 정의는 [`ecosystem.config.cjs`](./ecosystem.config.cjs)에 있습니다.

```bash
npm install
npm run build
npm run db:migrate
pm2 start ecosystem.config.cjs   # minesweeper-web(:3100) + minesweeper-worker
pm2 save                         # 프로세스 목록 저장(재시작 복구)
# (선택) 부팅 자동시작: pm2 startup → 출력되는 sudo 명령 실행 후 pm2 save
```

| 명령 | 설명 |
|---|---|
| `pm2 status` | 프로세스 상태 |
| `pm2 logs minesweeper-web` / `pm2 logs minesweeper-worker` | 로그 (파일은 `data/logs/`) |
| `pm2 restart minesweeper-web` | 재시작 |
| `MINESWEEPER_PORT=<포트> pm2 restart ecosystem.config.cjs --update-env` | 포트 변경 |

- 기본 포트 **3100** (`PORT` / `MINESWEEPER_PORT`). 로컬 확인: `http://localhost:3100`
- 추출기 전환: `ecosystem.config.cjs`의 `EXTRACTOR_MODE`(`stub`/`hybrid`/`vlm`/`ensemble`, 현재 `vlm`) 변경 후 `pm2 restart ecosystem.config.cjs --update-env`

### Cloudflare Tunnel

로컬 서비스 `http://localhost:3100`을 도메인에 연결:

```bash
cloudflared tunnel login
cloudflared tunnel create minesweeper
cloudflared tunnel route dns minesweeper <도메인>      # 예: minesweeper.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: minesweeper
credentials-file: /home/<user>/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: <도메인>
    service: http://localhost:3100
  - service: http_status:404
```

실행: `cloudflared tunnel run minesweeper` (상시화는 `sudo cloudflared service install`). 도메인 없이 빠른 테스트는 `cloudflared tunnel --url http://localhost:3100`.

> ⚠️ **자체 인증이 없습니다(Phase 1).** 터널을 그대로 공개하면 지원자 PII가 노출됩니다. 반드시 해당 hostname에
> **Cloudflare Access(Zero Trust)** 정책을 걸어 접근을 제한하세요. 자세한 내용: [docs/deployment.md](./docs/deployment.md) · [docs/security.md](./docs/security.md)

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
