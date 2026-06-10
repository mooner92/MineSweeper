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

- **형식 확장** = 1단 어댑터 1개 추가 (현재: pdf / image / hwp·hwpx(텍스트 추출) / text)
- **문서유형 확장** = 3단 프롬프트 1개 추가 (현재: 학위논문 / 대표연구실적 / 학술논문 / 연구과제 / hindex)
- **동명이인/약어 판정** = 4단에서 같은 성씨 + **자모(字母) 1자 차이(오인식)** 또는 **통째 음절 접두(약어)** 만 후보로 묶어 사람이 확인(자동병합 금지). `이주영↔이조영`·`정민↔정민호`는 묶고, `박철수↔박철민`(자모 3자 차이)은 안 묶음.

## Stage 3 추출기 — 교체 가능(pluggable)

| 모드 | 구현 | 용도 |
|---|---|---|
| `stub` (기본) | `extract/stub.ts` | 결정적 휴리스틱. GPU 불필요, **모든 테스트가 사용** |
| `hybrid` | `extract/hybrid.ts` | **텍스트 문서=stub / 이미지·스캔 문서=VLM OCR** 라우팅 |
| `vlm` ✅운용 | `extract/vlm.ts` | **전수 단일 온프레 VLM**(OpenAI 호환: 로컬 vLLM/Ollama) |
| `ensemble` | `extract/ensemble.ts` | **로컬 vLLM 모델 3종을 투표**(합의=신뢰도, 불일치=사람에게). 정밀도/필터링↑ |

현재 운용값은 `vlm` — 실제 논문 저자블록(예: `Jiho Lee a,b, Nara Park a,*`)이나 한국어
학위논문 인준 페이지는 LLM이라야 제대로 읽는다. 결정적 `stub`은 이런 실문서에서 0건을 반환해(휴리스틱 한계)
운영에는 부적합 — 빠른 테스트/GPU 미사용 시에만 쓴다. `hybrid`는 텍스트=stub·이미지=VLM 절충.

**도장/서명 감지(`DETECT_MARKS=1`)**: 인준/저자 페이지를 이미지로 렌더해 VLM에 **도장·서명·손글씨의
위치(bbox)** 를 물어(글자는 안 읽음) **크롭 + 검토 큐**로 올립니다. "타이핑 없이 — 이름은 추출, 도장 있는
문서만 골라 크롭으로 확인". `extract/detect.ts`·`worker/detect-marks.ts`, 크롭 서빙 `/api/crop/[flagId]`.

**앙상블(`ensemble`)**: `VLM_ENSEMBLE` 의 여러 로컬 vLLM 엔드포인트로 투표(`votes/N`=신뢰도, 불일치→사람).
서버 기동 [`scripts/serve-ocr.sh`](./scripts/serve-ocr.sh), 자세히는 [docs/extractors.md](./docs/extractors.md)·[docs/deployment.md](./docs/deployment.md).

> ✅ **현재 라이브 상태** (실합격자 ZIP로 end-to-end 검증)
> - **모델**: GPU1에 `Qwen2.5-VL-7B-Instruct`(vLLM, `:8010`), 추출기 `vlm`. **systemd로 상시 가동·재부팅 유지** ([`deploy/vllm-ocr-8010.service`](./deploy/vllm-ocr-8010.service)).
> - **실검증**: 실제 합격자 ZIP(문서 13건, PDF+HWP+이미지)에서 **관계인 50여 명**(공저자·지도교수·심사위원·연구진) 추출 + **본인 자동제외** + 도장/서명 감지 동작.
> - **HWP/HWPX**: 순수 Node(`cfb`+`zlib`/`adm-zip`)로 텍스트 추출 — 연구보고서 연구진 명단까지 추출(외부변환·sudo 불필요).
> - **한글 ZIP 견고성**: CP949 파일명 깨짐·macOS 자모분리(NFD)·초장문 파일명·다양한 내부 폴더구조 모두 처리.
> - **지원자 중복 제거**: 같은 **지원번호**(`2401-000050`)의 zip을 다시 올리면 **덮어쓰기**(이전 추출 교체) — 항상 1지원자 = 1카드.
> - **검토 화면 분류**: 관계자 목록을 **관계 유형(지도교수·심사위원·공저자·연구진…)별 그룹 + 검토필요 필터 칩 + 문서별 인원 태그**로 정리.
> - **GPU 모니터링**: 어느 GPU에 어떤 모델이 떠 있는지 Prometheus 익스포터 + Grafana 대시보드로 가시화([`deploy/`](./deploy)).
> - **회복탄력성**: 한 문서 추출 실패(예: VLM 일시중단)가 전체 작업을 멈추지 않고 해당 문서만 검토 플래그로 강등.
>
> 동시 3모델 앙상블은 VRAM 부담이라 단일 경량 모델 운용. 정확도/임계값 검증 절차: [docs/validation-real-samples.md](./docs/validation-real-samples.md). 현황: [docs/progress.md](./docs/progress.md).

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
| `npm test` | vitest — 파이프라인·인증 전 구간 (**108 테스트**) |
| `npm run eval` | 추출 결과 검토량 baseline 측정 (`scripts/eval.ts`) |
| `npm run detect:smoke` | 도장/서명 감지 스모크 (`scripts/detect-smoke.ts`) |

> 개발은 `dev:all`(웹 `:3000` + 워커), 프로덕션은 아래 PM2로 운영합니다.

### 운영 유지보수 스크립트 (`scripts/`, `npx tsx`로 실행)

| 스크립트 | 설명 |
|---|---|
| `create-user.ts <아이디> <비밀번호>` | 로그인 계정 생성/비밀번호 변경 (+ 최초 실행 시 `AUTH_SECRET`을 `.env`에 생성) |
| `dedupe-applicants.ts` | 기존 데이터의 지원자 중복 1회 정리 — 지원번호 백필 + 표시명 정리 + 중복(최신 유지) 제거 |
| `reaggregate-applicant.ts <지원번호\|id\|all>` | 저장된 추출결과로 **4단 집계만** 재실행(VLM 재추출 없이). 집계 로직·지원자명 변경 후 명단·동명이인 플래그 갱신 |
| `serve-ocr.sh` · `download-ocr-models.sh` | 로컬 vLLM(OCR) 기동 / 모델 다운로드 |

## 프로덕션 배포 (PM2 + Cloudflare Tunnel)

빌드 후 **PM2**로 웹·워커를 함께 관리합니다. 프로세스 정의는 [`ecosystem.config.cjs`](./ecosystem.config.cjs)에 있습니다.

```bash
npm install
npm run db:migrate
npx tsx scripts/create-user.ts <아이디> <비밀번호>   # 로그인 계정 + AUTH_SECRET(.env) 생성 — build 전에!
npm run build
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

### GPU 모니터링 (Prometheus + Grafana)

공유 서버에서 **어느 GPU에 어떤 모델이 떠 있는지**(VRAM 사용/총량 포함)를 가시화합니다. `nvidia-smi` + `/proc`로
GPU→모델을 매핑하는 Python 익스포터와 Grafana 대시보드가 [`deploy/`](./deploy)에 있습니다.

```bash
# 익스포터 기동(:9836) — 표준 라이브러리만 사용, 의존성 없음
python3 deploy/gpu-model-exporter.py &
# Prometheus 스크레이프 등록 + 방화벽 허용(루트 1회 실행)
sudo bash deploy/wire-gpu-exporter.sh
# Grafana에서 deploy/grafana-gpu-models-dashboard.json import
```

`gpu_model_vram_bytes{gpu,model,framework,port,pid}` 등으로 모델별 점유를 노출합니다. 자세히는 [docs/deployment.md](./docs/deployment.md).

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

> 🔐 **로컬 로그인이 기본 적용**됩니다(아래 보안 절) — 모든 페이지·API가 로그인 없이는 차단됩니다. 다만 단일
> 공용 계정·무차별 대입 제한 없음 수준이므로, 터널을 공개할 땐 **Cloudflare Access(Zero Trust)** 정책을 추가로
> 거는 것을 권장합니다. 자세한 내용: [docs/deployment.md](./docs/deployment.md) · [docs/security.md](./docs/security.md)

## 검토 UI

1. **업로드** — zip 업로드 → 추출 시작, 진행률 폴링.
2. **지원자별 검토** — **관계 유형별 그룹 + 필터 칩(전체·검토필요·역할별) + 문서별 인원 태그**, 출처(문서·페이지) 링크,
   **인쇄·고신뢰 = 초록 "자동 통과"** / **비인쇄·저신뢰 = 노랑 "미확인"**, **동명이인/약어 후보 병기**, 확인/수정/제외,
   **본인 자동 제외**. 교정 내역은 `corrections` 에 적재.
3. **검토 필요 큐** — 도장·손글씨·비전판독 필요 항목을 크롭 갤러리로 모아보기.
4. **문서 슬라이드 뷰어** — 문서 카드 클릭 시 우측 패널로 원문 미리보기(PDF=내장 뷰어, 이미지=원본,
   HWP/텍스트=추출 텍스트 읽기 전용) + 다운로드·새 탭. ESC/오버레이로 닫기.
5. **명단 내보내기** — 지원자별 최종 명단을 **CSV / Excel** 로(심사위원 풀 대조용). 본인·제외 항목은 빠집니다.

## 데이터 모델 (요약)

`applicants` 1 : N `documents` 1 : M `extracted_persons` → `person_aggregates`(사람 단위 통합).
지원자는 **`external_id`(지원번호)** 로 중복을 식별해 재업로드 시 교체합니다. 배치 큐 `jobs`, 검토 큐
`review_flags`, 교정 로그 `corrections`. 자세한 컬럼은 `src/db/schema.ts` 참고.

## 디자인

[seed-design](https://github.com/daangn/seed-design) 원칙(시맨틱 토큰·캐럿 액센트·접근성)을 따른
토큰을 `src/app/globals.css` + `tailwind.config.ts` 에 정의했습니다.

## 보안 / 배포

- **로컬 로그인(외부 IdP 없음)**: 모든 페이지·API(파일·명단·상태 포함)는 미들웨어에서 세션 쿠키
  (HMAC 서명, httpOnly, 7일)를 검사합니다. 계정은 `users` 테이블에 scrypt 해시로 저장 —
  `npx tsx scripts/create-user.ts <아이디> <비밀번호>` 로 생성/변경. `AUTH_SECRET`은 `.env`에 자동
  생성되며 **git에 절대 커밋되지 않습니다**. 단, 단일 공용 계정·시도 횟수 제한 없음 수준이므로
  **내부망 배포 원칙은 유지**하고, 외부 공개 시 리버스 프록시 인증(Cloudflare Access 등)을 추가하세요.
- 업로드/압축해제는 **zip-slip 차단 + 크기·개수 상한**(`MAX_UPLOAD_BYTES`, `MAX_ZIP_ENTRIES`,
  `MAX_ZIP_TOTAL_BYTES`)으로 zip-bomb/경로탈출을 방어합니다. 파일 서빙은 DB에 기록된 경로만 사용합니다.
- 원본·크롭·DB(개인 인장 포함)는 `./data/` 로컬에만 저장하며 git에 커밋되지 않습니다(`.gitignore`).
- 추출은 **온프레 LLM 기본** — 외부 클라우드 API를 강제하지 않습니다.

## 범위

- **In**: 문서 기반 관계자 추출, 형식 통합 처리, 도장·손글씨 별도 검토 큐, 검토 UI, 명단 내보내기.
- **Out (Phase 2+)**: 추출 인물 소속 자동검색, 내부 직원 관계(부서장·실장·과제책임자), 인사혁신처 DB 수집,
  HWP 내부 도장·서명 **렌더 감지**(텍스트 추출은 지원), 도장 전용 엔진/파인튜닝, 합·불 판정(= 사람의 몫).
