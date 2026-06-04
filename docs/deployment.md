# 배포·운영

이 문서는 Minesweeper(채용 이해충돌 관계자 추출 시스템)를 **프로덕션에서 기동**하고 **운영**하는 절차를 다룬다. 시스템은 두 개의 장기 실행 프로세스로 구성된다.

| 프로세스 | 역할 | 기동 명령 |
| --- | --- | --- |
| **web** | Next.js 14 App Router 서버 (업로드 API + UI + 조회/검수 화면) | `next start` |
| **worker** | `tsx` 백그라운드 워커. 큐를 폴링하며 4단 파이프라인(Ingest→Type→Extract→Aggregate)을 실행 | `tsx src/worker/index.ts` |

두 프로세스는 같은 머신에서 **동일한 `DATABASE_URL`(embedded libsql 파일)과 `UPLOAD_DIR`을 공유**한다. 데이터베이스는 단일 파일(`./data/minesweeper.db`)이므로, 두 프로세스는 반드시 같은 파일시스템(같은 호스트)에 있어야 한다.

관련 문서: [추출기 셋업(extractors)](./extractors.md) · [보안(security)](./security.md) · [개발 환경(development)](./development.md) · [파이프라인(pipeline)](./pipeline.md)

---

## 1. 프로덕션 빌드 / 기동

### 1.1 빌드

`package.json`의 스크립트는 다음과 같다(발췌).

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "worker": "tsx src/worker/index.ts",
  "dev:all": "concurrently -n web,worker -c blue,green \"next dev\" \"tsx watch src/worker/index.ts\"",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/db/migrate.ts",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

프로덕션 절차:

```bash
npm ci                 # lockfile 기준 재현 가능한 설치
npm run db:migrate     # ./drizzle 의 마이그레이션을 DATABASE_URL 에 적용
npm run build          # next build (RSC/route 컴파일)
```

> **빌드 안전성 주의.** `src/db/client.ts`의 `getDb()`는 **lazy singleton**이다. 모듈을 import 하는 것만으로는 DB 파일을 열지 않으며, 첫 실제 사용 시점에 연결한다.
>
> ```ts
> // src/db/client.ts
> let _db: DB | null = null;
> export function getDb(): DB {
>   if (!_db) _db = createDb(defaultUrl);
>   return _db;
> }
> ```
>
> 이 설계 덕분에 `next build`가 서버 모듈을 평가할 때 파일 핸들을 잡지 않는다. 또한 `next.config.mjs`는 네이티브/서버 전용 패키지(`@libsql/client`, `libsql`, `pdfjs-dist`, `exceljs`, `adm-zip`)를 `serverComponentsExternalPackages`로 빼서 클라이언트/RSC 번들에 끌려들어가지 않게 한다. 같은 파일에서 `eslint: { ignoreDuringBuilds: true }`로 두어, lint 설정이 없는 신선한 클론에서도 `next build`가 막히지 않는다(타입 안전성은 `npm run typecheck`로 별도 강제).

### 1.2 기동 (web + worker)

두 프로세스를 **동시에** 띄워야 한다. web만 띄우면 업로드는 큐에 쌓이지만 영원히 처리되지 않는다.

**옵션 A — `concurrently` (단일 호스트, 단순 운영).**
이미 devDependency로 들어있는 `concurrently`를 프로덕션 기동에도 쓸 수 있다(`dev:all`은 dev 전용이므로 프로덕션은 아래처럼 별도 조합 사용).

```bash
npx concurrently -n web,worker -c blue,green \
  "next start" \
  "tsx src/worker/index.ts"
```

**옵션 B — `pm2` (권장: 자동 재시작·로그·상시 운영).**

저장소에 실제 [`ecosystem.config.cjs`](../ecosystem.config.cjs)가 포함돼 있다 — web(`:3100`) + worker, env·로그 경로(`data/logs/`)까지 정의돼 있다.

```bash
npm run build
pm2 start ecosystem.config.cjs   # minesweeper-web(:3100) + minesweeper-worker
pm2 save                         # 프로세스 목록 저장(재시작 복구)
pm2 startup                      # (선택) 부팅 자동기동 — 출력된 sudo 명령 실행 후 pm2 save
pm2 logs minesweeper-worker
```

| 명령 | 설명 |
|---|---|
| `pm2 status` | 프로세스 상태 |
| `pm2 restart minesweeper-web` | 재시작 |
| `MINESWEEPER_PORT=<포트> pm2 restart ecosystem.config.cjs --update-env` | 포트 변경 |

- 기본 포트 **3100** (`PORT` / `MINESWEEPER_PORT`). 로그 파일은 `data/logs/`.
- env(`DATABASE_URL`·`UPLOAD_DIR`·`EXTRACTOR_MODE`·`VLM_*`)는 `ecosystem.config.cjs`의 `env` 블록에 정의돼 두 앱이 동일하게 본다.
- 추출기 전환: `EXTRACTOR_MODE`를 `stub`/`hybrid`/`vlm`/`ensemble` 중 하나로 바꾼 뒤 `pm2 restart ecosystem.config.cjs --update-env`. (현재 운용값: `vlm` — 실문서 저자블록/인준 페이지는 LLM이라야 추출됨, stub은 0건)

### 1.3 워커의 동작 모델

워커(`src/worker/index.ts`)는 단일 큐를 무한 폴링한다. 한 틱에 **최대 한 건**의 작업을 처리한다.

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

기동 시 로그로 폴링 주기와 추출기 모드를 출력한다.

```
[worker] polling every 2000ms (extractor=stub)
```

```
큐 비었나? ──no──▶ claimNextJob ▶ processApplicant ▶ completeJob/failJob ▶ (즉시 다음 틱)
   │
  yes
   ▼
sleep(WORKER_POLL_INTERVAL_MS) ▶ 다시 폴링
```

작업이 있으면 곧바로 다음 틱으로 이어지고, 비었을 때만 `WORKER_POLL_INTERVAL_MS` 만큼 쉰다. 처리량을 높이려면 **워커 인스턴스를 수평 확장**하면 된다(같은 DB를 보는 여러 워커 프로세스). `claimNextJob`이 작업 클레임을 담당하므로 동일 작업의 중복 처리를 방지한다 — 자세한 큐 의미론은 [pipeline.md](./pipeline.md) 참조.

---

## 2. 환경변수 전체 레퍼런스

값과 기본값은 모두 `.env.example` 및 코드의 fallback에서 그대로 가져온 것이다.

| 변수 | 기본값 | 읽는 곳 | 의미 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `file:./data/minesweeper.db` | `src/db/client.ts`, `src/db/migrate.ts` | embedded libsql DB 위치. `file:` 접두 파일 경로 또는 `:memory:`(테스트). 마이그레이터는 `file:` 경로의 상위 디렉터리를 자동 생성한다. |
| `UPLOAD_DIR` | `./data/uploads` | 업로드/원본/크롭 저장 | 업로드 zip, 추출된 원본, 크롭 이미지가 저장되는 로컬 디렉터리. |
| `EXTRACTOR_MODE` | `stub` | `src/worker/index.ts` 등 | Stage 3 추출기 선택. `stub`=결정적 휴리스틱(기본·GPU 불필요·테스트용), `hybrid`=텍스트는 stub·이미지는 VLM OCR, `vlm`=전수 온프레 비전/LLM(운용값), `ensemble`=다중 모델 투표. [extractors.md](./extractors.md) 참조. |
| `VLM_BASE_URL` | `http://localhost:11434/v1` | VLM 추출기 | OpenAI 호환 엔드포인트 base URL. 기본값은 로컬 Ollama를 가리킨다. |
| `VLM_API_KEY` | `ollama` | VLM 추출기 | OpenAI 호환 API 키. Ollama는 임의 문자열 허용(`ollama`). vLLM 등에서는 실제 토큰 사용. |
| `VLM_MODEL` | `qwen3.5:9B` | VLM 추출기 | 사용할 모델 이름(엔드포인트에 미리 받아둔 모델과 일치해야 함). |
| `VLM_TIMEOUT_MS` | `120000` | VLM 추출기 | VLM 호출 타임아웃(ms). 기본 120초. |
| `WORKER_POLL_INTERVAL_MS` | `2000` | `src/worker/index.ts` | 큐가 비었을 때 폴링 간격(ms). `Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000)`. |
| `MAX_UPLOAD_BYTES` | `209715200` (200 MB) | 업로드 가드 | zip 업로드 최대 크기. zip-bomb/DoS 방지. |
| `MAX_ZIP_ENTRIES` | `5000` | 업로드 가드 | zip 내 최대 파일 수. |
| `MAX_ZIP_TOTAL_BYTES` | `524288000` (500 MB) | 업로드 가드 | zip 압축 해제 후 누적 최대 크기. |

> `EXTRACTOR_MODE=stub`이면 `VLM_*` 변수는 무시된다(stub은 GPU·네트워크가 필요 없음). 업로드/unzip 가드 3종의 보안적 배경은 [security.md](./security.md)를 참조.

기본 `.env` 시작점:

```bash
cp .env.example .env
# 필요한 값만 수정 (예: 프로덕션 절대경로, EXTRACTOR_MODE=vlm 등)
```

---

## 3. 온프레 VLM 셋업 (OpenAI 호환)

`EXTRACTOR_MODE=vlm`은 **OpenAI 호환** 추론 서버를 호출한다. 외부 클라우드로 PII를 보내지 않도록, 온프레/사내망에 서버를 둔다. 둘 중 하나를 고른다.

### 3.1 Ollama (기본값과 가장 잘 맞음)

```bash
# 1) 설치 후 서비스 기동 (기본 포트 11434, /v1 가 OpenAI 호환)
ollama serve

# 2) 모델 받기 (VLM_MODEL 과 동일한 태그)
ollama pull qwen3.5:9B
```

`.env`:

```bash
EXTRACTOR_MODE=vlm
VLM_BASE_URL=http://localhost:11434/v1
VLM_API_KEY=ollama          # Ollama 는 키 검증 안 함 (임의 문자열)
VLM_MODEL=qwen3.5:9B
VLM_TIMEOUT_MS=120000
```

### 3.2 vLLM (다중 동시요청·고성능)

```bash
# OpenAI 호환 서버로 모델 서빙 (예시)
python -m vllm.entrypoints.openai.api_server \
  --model <hf-org>/<vlm-model> \
  --port 8000
```

`.env`:

```bash
EXTRACTOR_MODE=vlm
VLM_BASE_URL=http://localhost:8000/v1
VLM_API_KEY=<your-token>
VLM_MODEL=<served-model-name>   # vLLM 에 등록된 모델 이름과 정확히 일치
VLM_TIMEOUT_MS=120000
```

### 3.3 연결 확인

```bash
curl -s "$VLM_BASE_URL/models" -H "Authorization: Bearer $VLM_API_KEY"
```

`VLM_MODEL`이 응답 목록에 보이면 정상이다. 추출기 인터페이스·프롬프트·플래그(`seal|handwriting|signature|low_confidence|ambiguous|needs_vision`) 처리 방식은 [extractors.md](./extractors.md)에서 다룬다.

> **원칙 재확인.** 자동추출은 **초안**이며 최종 판단은 사람이 한다. VLM은 이름을 **지어내지 않는다** — 불확실하면 플래그를 남기고 사람 검수로 넘긴다.

### 3.4 로컬 vLLM 앙상블 (EXTRACTOR_MODE=ensemble)

여러 OCR-VLM을 **로컬 vLLM**으로 띄워 투표(앙상블)합니다. 외부 API 없음.

```bash
# 1) 모델 캐시(디스크만, GPU 불필요)
bash scripts/download-ocr-models.sh           # MODEL1/2/3 env 로 교체 가능

# 2) 3개 vLLM OpenAI 서버 기동 (포트 8010/8011/8012) — 자유 VRAM 필요
bash scripts/serve-ocr.sh                      # VRAM 부족/공유 점유 시 자동 abort

# 3) 앙상블로 전환
#   ecosystem.config.cjs(or .env): EXTRACTOR_MODE=ensemble,
#   VLM_ENSEMBLE="http://localhost:8010/v1|MODEL1,http://localhost:8011/v1|MODEL2,http://localhost:8012/v1|MODEL3"
pm2 restart minesweeper-worker --update-env
```

- 합의=신뢰도, 불일치=사람 검토(필터링). `VLM_ENSEMBLE_MIN_VOTES`로 저득표 드롭 가능(기본 1).
- 권장 기본 모델: `Qwen/Qwen2.5-VL-7B-Instruct`, `OpenGVLab/InternVL3-8B`, `zai-org/GLM-4.1V-9B-Thinking`
  — **vLLM 지원·한국어/도장 정확도는 실제 샘플로 검증 후 확정**(model-evaluation.md).
- VRAM: 7–9B VLM ×3 ≈ **48–60GB** → A40 2장(92GB) 여유 시 충분. 한 장에 다 못 올리면 `GPU1/2/3`,
  `VLM_GPU_UTIL`로 카드별 배치.

### 3.5 단일 경량 VLM + 도장/서명 감지 (현재 운용) — `DETECT_MARKS`

동시 3모델 앙상블은 VRAM 부담이 커서, 현재는 **단일 경량 VLM**으로 운용한다.

```bash
# GPU1(여유 카드)에 Qwen2.5-VL-7B 띄우기 (로컬, --api-key 임의값)
CUDA_VISIBLE_DEVICES=1 /data/vllm/env/bin/vllm serve Qwen/Qwen2.5-VL-7B-Instruct \
  --served-model-name Qwen2.5-VL-7B-Instruct --port 8010 --api-key local \
  --gpu-memory-utilization 0.5 --max-model-len 16384 --limit-mm-per-prompt '{"image":4}'

# 앱 환경(ecosystem): EXTRACTOR_MODE=hybrid(텍스트=stub/이미지=VLM OCR) + 감지 on
#   DETECT_MARKS=1  VLM_BASE_URL=http://localhost:8010/v1  VLM_API_KEY=local  VLM_MODEL=Qwen2.5-VL-7B-Instruct
pm2 restart ecosystem.config.cjs --update-env
# 라이브 스모크: npm run detect:smoke   (이름 추출 + 도장 bbox 감지)
```

- **추출 모드**: `EXTRACTOR_MODE=vlm`(현재) — 모든 문서를 로컬 VLM이 추출. 실제 논문 저자블록·한국어
  인준 페이지는 LLM이라야 읽힌다(결정적 stub은 실문서에서 0건). `hybrid`=텍스트는 stub·이미지는 VLM,
  `stub`=GPU 미사용/테스트. VLM 미가동 시 추출은 문서별로 실패 강등(검토 플래그)되며 job은 완료된다. (§extractors.md 3)
- **감지(`DETECT_MARKS=1`)**: 관련 페이지 렌더 → VLM에 도장/서명 위치 질의 → 크롭 + 검토 큐(§extractors.md 3c).
- GPU1 카드 1장이 비면(아래 systemd util 조정 참고) 7B VLM은 util 0.5(~23GB)로 넉넉히 올라간다.

#### 재부팅 유지 — systemd 등록 (권장)

위 vllm 프로세스는 nohup/수동이면 재부팅 시 사라진다. 코더 서비스와 동일 패턴의 유닛 파일을
`deploy/vllm-ocr-8010.service`로 제공한다. 설치(최초 1회, sudo 필요):

```bash
sudo cp deploy/vllm-ocr-8010.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vllm-ocr-8010.service          # 부팅 시 자동 시작
# 현재 수동 실행 중이면 systemd 관리로 전환:
pkill -f 'vllm serve Qwen/Qwen2.5-VL-7B' ; sleep 3
sudo systemctl start vllm-ocr-8010.service
systemctl status vllm-ocr-8010.service --no-pager
curl -s localhost:8010/v1/models -H 'authorization: Bearer local'
```

유닛은 GPU1(`CUDA_VISIBLE_DEVICES=1`)·`HF_HOME=/home/mooner92/.cache/huggingface`(모델 캐시 위치)를
쓴다. 등록 전 `nvidia-smi`로 GPU1이 이 모델용으로 맞는지 확인할 것.

> ℹ️ **GPU 메모리 확보 팁**: 공유 코더 vLLM이 `--gpu-memory-utilization 0.85`로 카드를 선점하면 여유가
> 거의 없다. 소유자가 해당 systemd 유닛의 util을 낮추거나(예: 0.55) TP=1로 한 카드에 몰면 다른 카드가
> 통째로 빈다. **타 사용자 서비스는 종료/변경하지 말 것** — 본인 소유 서비스만 조정.

---

## 4. GPU 고려사항

기본 추출기(`stub`)는 **GPU가 전혀 필요 없다**. CI/테스트(51 tests)와 로컬 개발은 GPU 없이 전부 돈다. GPU는 `EXTRACTOR_MODE=vlm`일 때만 의미가 있다.

- **OCR-VLM은 소형(0.9B급)으로 충분.** 이 시스템의 Stage 3은 학위논문·대표연구·저널·h-index 등 문서에서 이름/역할 후보를 뽑는 OCR+구조화 작업이라, 대형 범용 LLM이 아니라 작은 OCR 특화 VLM으로 충분히 처리할 수 있다. `.env.example`의 기본 태그(`qwen3.5:9B`)는 시작점일 뿐, 운영 부하에 맞춰 더 작은/적합한 OCR-VLM으로 교체하는 것을 권장한다.
- **VRAM 가이드(대략).** 0.9B급 양자화 모델은 보통 **수 GB VRAM**으로 단일 GPU에서 충분히 서빙된다. 9B급을 그대로 쓰면 양자화 여부에 따라 **8~20 GB**가 필요할 수 있다.
- **동시성.** 워커는 한 틱에 1건을 처리하므로, 동시 추론 요청은 곧 동시에 기동한 워커 인스턴스 수와 같다. 여러 워커를 띄울 계획이면 vLLM처럼 배치/동시요청에 강한 서버가 유리하다.
- **타임아웃.** GPU가 약하면 `VLM_TIMEOUT_MS`(기본 120000)를 늘려야 큰 페이지에서 실패하지 않는다.
- **CPU 폴백.** Ollama는 GPU가 없으면 CPU로도 동작하지만 느리다 — 검수 대기열이 길어질 수 있으니 처리량 기대치를 낮춰 잡아라.

---

## 5. 데이터 디렉터리 백업

모든 영속 상태는 **`./data` 한 곳**에 모인다.

```
data/
├── minesweeper.db      # libsql 임베디드 DB (applicants/jobs/extractions/people ...)
└── uploads/            # 업로드 zip, 추출된 원본, 크롭 이미지 (UPLOAD_DIR)
```

DB와 업로드 파일은 서로를 참조하므로(추출 레코드가 `uploads/`의 크롭 경로를 가리킴) **항상 함께 일관된 시점으로** 백업해야 한다.

**권장 백업 절차(정합성 우선):**

```bash
# 1) 짧은 정지로 정합성 보장 (web + worker 모두 멈춤)
pm2 stop minesweeper-web minesweeper-worker

# 2) data 디렉터리 통째 스냅샷
tar czf "backup-$(date +%F-%H%M).tar.gz" ./data

# 3) 재기동
pm2 start minesweeper-web minesweeper-worker
```

무정지 백업이 필요하면 libsql/SQLite 온라인 백업(예: `VACUUM INTO`로 DB 스냅샷 생성) 후 `uploads/`를 별도 복사한다. 단, 이 경우 DB 스냅샷 시점과 파일 복사 시점 사이의 신규 업로드가 한쪽에만 존재할 수 있으므로, 정지 백업이 가장 단순·안전하다.

복원은 역순이다: 프로세스 정지 → `data/` 교체 → 재기동. DB 스키마가 바뀌었다면 복원 후 `npm run db:migrate`를 한 번 더 돌린다(마이그레이션은 멱등).

---

## 6. 이식성 (clone → npm i → migrate → 실행)

새 호스트에 옮기는 데 필요한 것은 코드와 `./data`뿐이다. 외부 관리형 DB가 없고(임베디드 libsql 파일), 추출기도 온프레라 **클론 후 네 단계**면 끝난다.

```bash
git clone <repo> minesweeper && cd minesweeper
npm ci                 # (또는 npm i) 의존성 설치
cp .env.example .env   # 환경변수 설정
npm run db:migrate     # 스키마 적용 (data/ 디렉터리 자동 생성)
```

`src/db/migrate.ts`는 `DATABASE_URL`이 `file:`이면 상위 디렉터리를 자동 생성한다.

```ts
// src/db/migrate.ts (main)
const url = process.env.DATABASE_URL ?? 'file:./data/minesweeper.db';
if (url.startsWith('file:')) {
  const filePath = url.slice('file:'.length);
  if (filePath && filePath !== ':memory:') {
    mkdirSync(dirname(filePath) || '.', { recursive: true });
  }
}
```

그 다음 빌드·기동:

```bash
npm run build
npx concurrently -n web,worker -c blue,green "next start" "tsx src/worker/index.ts"
# 또는 pm2 (§1.2 옵션 B)
```

새 호스트로 **데이터까지 그대로** 이전하려면, 위 절차에서 `npm run db:migrate` 대신 기존 `./data` 디렉터리를 복사해 넣으면 된다(필요 시 그 후 마이그레이션 1회).

검증(이식 직후 권장):

```bash
npm run typecheck      # tsc --noEmit  → 0 errors
npm test               # vitest run    → 51 tests
npm run build          # next build    → 0 errors
```

## 7. Cloudflare Tunnel (외부 도메인 연결)

PM2로 띄운 로컬 서비스(`http://localhost:3100`)를 `cloudflared`로 도메인에 연결한다.

**명명 터널 (도메인 + 상시):**

```bash
cloudflared tunnel login                              # CF 계정 인증(브라우저)
cloudflared tunnel create minesweeper                 # 터널 + 자격증명 파일 생성
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

```bash
cloudflared tunnel run minesweeper        # 실행
sudo cloudflared service install           # (선택) systemd 상시 등록
```

**빠른 테스트 (도메인·로그인 불필요, 임시 *.trycloudflare.com URL):**

```bash
cloudflared tunnel --url http://localhost:3100
```

> ⚠️ **인증 경계 필수.** 이 앱은 Phase 1이라 자체 인증이 없다(§[security.md](./security.md)). 터널 hostname을 그대로
> 공개하면 지원자 PII가 노출되므로, 반드시 **Cloudflare Access(Zero Trust)** 정책을 그 hostname에 적용해
> 이메일/조직 단위로 접근을 제한하라. 포트(3100)는 외부에 직접 개방하지 말고 터널 경유로만 노출한다.

> **보안 경고(재게시).** Phase 1에는 **내장 인증이 없다.** 리소스는 id로 주소화되므로 서버에 도달할 수 있는 누구나 지원자 PII를 읽을 수 있다. 반드시 **사내망 또는 인증을 강제하는 리버스 프록시 뒤**에 두고, **공개 인터넷에 노출하지 마라.** 자세한 위협 모델과 완화책은 [security.md](./security.md) 참조. 개발 워크플로(테스트·시드·로컬 실행)는 [development.md](./development.md)에 있다.
