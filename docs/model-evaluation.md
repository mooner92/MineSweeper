# 모델 선정·평가 (Phase 1.5)

> 이 문서는 **운영/도입 가이드**다. 코드 명세가 아니라, Stage 3 추출기를 `stub` 에서
> 온프레 VLM 으로 전환할 때 **"어떤 모델을 어떤 근거로 고르고, 어떻게 검증하고, 어떻게
> 계속 좋아지게 만드느냐"** 를 결정하기 위한 절차서다. 코드에 이미 존재하는 라우팅 지점
> (`getExtractor` · `VlmExtractor` · `buildExtractionPrompt`)을 기준선으로 삼되, 모델 선정
> 자체는 Phase 1 범위 밖(README §범위 "Out (Phase 2+): 도장 전용 엔진/파인튜닝")이며 이
> 문서가 그 도입 절차를 정의한다.
>
> **대전제(README 그대로):** _자동 추출은 초안이며, 최종 판단은 항상 사람이 한다._ 모델을
> 아무리 잘 골라도 도장·손글씨·판독난해 서명은 **자동 추출을 약속하지 않고 검토 필요 큐로
> 모아 사람이 확인**한다. 모델 평가의 목표는 "사람을 없애는 것"이 아니라 **"사람이 봐야 할
> 양을 줄이고, 사람이 보는 것의 신뢰도를 높이는 것"** 이다.

관련 문서: [추출기 구조 (extractors)](./extractors.md) · [로드맵 (roadmap)](./roadmap.md) ·
[파이프라인 (pipeline)](./pipeline.md)

---

## 0. 코드측 기준선 (무엇이 이미 있고, 무엇을 결정해야 하나)

평가의 대상은 Stage 3 의 **교체 가능한 추출기**다. 현재 코드는 두 구현을 제공한다
(`src/lib/pipeline/extract/index.ts`).

```ts
// src/lib/pipeline/extract/index.ts
export function getExtractor(mode: string = process.env.EXTRACTOR_MODE ?? 'stub'): Extractor {
  return mode === 'vlm' ? new VlmExtractor() : new StubExtractor();
}
```

운영 경로(`vlm`)의 모델·엔드포인트는 환경변수로만 정해지고, 코드에는 모델 식별자가 박혀
있지 않다 (`src/lib/pipeline/extract/vlm.ts`).

```ts
// src/lib/pipeline/extract/vlm.ts
export function vlmConfigFromEnv(): VlmConfig {
  return {
    baseUrl: process.env.VLM_BASE_URL ?? 'http://localhost:11434/v1',
    apiKey: process.env.VLM_API_KEY ?? 'ollama',
    model: process.env.VLM_MODEL ?? 'qwen3.5:9B',
    timeoutMs: Number(process.env.VLM_TIMEOUT_MS ?? 120000),
  };
}
```

즉 **모델 선정 = `VLM_MODEL` / `VLM_BASE_URL` 에 무엇을 넣을지를 데이터로 결정하는 일**이다.
코드는 OpenAI 호환 `/chat/completions` 만 알면 되므로(`vlm.ts` 의 `fetch(${baseUrl}/chat/completions)`),
모델을 바꾸는 일은 **재배포 없이 엔드포인트/모델명 교체**로 끝난다. 이 문서는 그 교체의 근거를
만드는 절차다.

문서유형별 지시(task)는 `buildExtractionPrompt` 가 `docType` 으로 분기한다
(`src/lib/pipeline/extract/prompts.ts`). 즉 **모델 평가는 문서유형 축(degree_thesis /
representative_research / journal_article / hindex)별로 따로 봐야** 한다 — 같은 모델이라도
인준페이지(인쇄+도장+손글씨)와 hindex 캡처(이미지 OCR)에서 성능이 다르기 때문이다.

| 코드 상수 | 값 | 출처 | 평가에서의 의미 |
|---|---|---|---|
| `EXTRACTOR_MODE` 기본 | `stub` | `index.ts` / `.env.example` | 평가 베이스라인(결정적·GPU 불필요) |
| `VLM_BASE_URL` 기본 | `http://localhost:11434/v1` | `vlm.ts` / `.env.example` | 온프레 Ollama(외부 클라우드 금지) |
| `VLM_MODEL` 기본 | `qwen3.5:9B` | `vlm.ts` / `.env.example` | **후보 중 하나, 확정 아님** |
| `VLM_TIMEOUT_MS` 기본 | `120000` | `vlm.ts` | 지연 상한(평가 지표 = 지연) |
| `HUMAN_REVIEW_CONFIDENCE` | `0.7` | `src/worker/process.ts` | 자동통과/검토큐 분기 임계값 |

---

## 1. 왜 리더보드로 안 고르나

공개 OCR/VLM 리더보드(텍스트 인식 정확도, 일반 문서 VQA 등)는 **우리 문제와 분포가
다르다.** 우리 과업의 핵심 난점은 공개 벤치마크에 **사실상 부재**한다.

- **한국 학위논문 인준 페이지의 도장(seal):** 한자/한글 전각(篆刻) 인장은 일반 OCR 데이터셋에
  없다. 인장은 "텍스트 인식"이 아니라 사실상 **이미지 분류/판독** 문제이며, 공개 리더보드의
  텍스트 정확도와 상관이 약하다.
- **한자 손글씨 서명:** 심사위원 서명란의 한자 흘림체는 인쇄체 OCR 벤치와 완전히 다른 분포다.
- **손글씨 한글:** 자필 이름은 인쇄 한글 OCR 점수와 무관하게 망가질 수 있다.
- **참고문헌 오추출(precision 함정):** 리더보드는 "읽었나"를 보지만, 우리는 "References 의
  인용 저자를 **빼고** 진짜 관계자만 뽑았나"를 본다. 코드도 이를 강제한다 —
  `prompts.ts` 의 `COMMON_RULES` 는 _"참고문헌 / References / Bibliography / 참고자료에 인용된
  저자는 절대 추출하지 않는다"_, 그리고 _"문서에 실제로 나타난 이름만 추출한다 … 절대 이름을
  지어내지 마라"_ 를 명시한다. 리더보드 1위 모델이 이 규칙을 더 잘 지킨다는 보장이 없다.
- **보안 제약:** README §보안 / .env.example 주석대로 개인정보·논문 전문·인장을 다루므로
  **외부 클라우드 API 는 막힐 가능성이 크다.** 클라우드 전용 모델은 리더보드 점수가 높아도
  애초에 후보가 못 된다. 평가는 **온프레로 띄울 수 있는 모델**로 한정한다.

결론: **리더보드 점수가 아니라, 우리 합격자 문서로 만든 자체 정답라벨셋에서의
카테고리별 정확도**로 고른다. (개발계획 §9 평가방법, §14 후보모델.)

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ 공개 OCR/VLM 리더보드   │   ✗    │ 우리 과업의 실제 난점        │
│ - 인쇄체 텍스트 정확도  │ ◀────▶ │ - 한국 학위논문 도장(篆刻)   │
│ - 일반 문서 VQA         │ 분포   │ - 한자 손글씨 서명           │
│ - 영어 중심             │ 불일치 │ - 손글씨 한글 자필 이름      │
└─────────────────────────┘        │ - References 제외(precision) │
                                    │ - 온프레 가능 여부(보안)     │
                                    └──────────────────────────────┘
```

---

## 2. 평가 방법

### 2.1 정답라벨셋 (golden set)

**최소 합격자 3명분**의 실제 첨부서류를 정답라벨셋으로 만든다. 합격자를 쓰는 이유는 (a)
이미 처리가 끝난 케이스라 PII 노출 위험 통제가 쉽고, (b) 도장·손글씨·hindex 등 **실제 분포가
그대로** 들어 있기 때문이다.

라벨 단위는 코드의 `RawPerson` 과 동일하게 잡는다(추출기가 내보내는 형태와 맞춰야 채점이
자동화된다 — `src/lib/pipeline/types.ts`).

| 라벨 필드 | 대응 코드 | 비고 |
|---|---|---|
| `nameRaw` | `RawPerson.nameRaw` | 정답 이름 표기(지어내지 않음) |
| `role` | `Role` (`supervisor`…`coauthor`) | `roles.ts` 의 매핑과 동일 어휘 |
| `sourceKind` | `SourceKind` = `printed|handwritten|seal|signature` | **카테고리 채점의 축** |
| `sourcePage` | `RawPerson.sourcePage` | 출처 페이지 |
| `isSelf` | 본인 여부 | 본인은 명단에서 제외(Stage 4) |
| (음성라벨) | References 저자 = **추출되면 오답** | precision 측정용 |

> 라벨셋·합격자 원본은 README/`.gitignore` 원칙대로 **`./data/` 로컬에만** 두고 git 에 절대
> 커밋하지 않는다(개인 인장 포함). 평가는 내부망 머신에서만 수행한다.

### 2.2 카테고리별 정확도 (개발계획 §9)

전체 평균 한 숫자는 의미가 없다. **`sourceKind` 카테고리별로 쪼개서** 본다. 도장이 망가져도
인쇄 정확도가 가려버리기 때문이다.

| 카테고리 | 설명 | 1차 기대치 | 미달 시 처리 |
|---|---|---|---|
| **인쇄(printed)** | 인준페이지/저자블록 인쇄 텍스트 | **높음 — 자동통과 목표** | 모델 탈락 사유 |
| **손글씨 한글** | 자필 한글 이름 | 중간 | 검토 큐(handwriting) |
| **손글씨 한자** | 한자 흘림 서명 | 낮음 | 검토 큐(handwriting/signature) |
| **도장(seal)** | 篆刻 인장 | **자동추출 비약속** | 항상 검토 큐(seal) |

채점 지표(카테고리마다):

- **Precision / Recall / F1** — 단, **precision 을 우선**한다. 자동 통과되는 인쇄 항목은
  사람이 다시 안 보므로 거짓양성(없는 사람·References 저자)이 가장 비싸다. 코드의 stub 도
  같은 철학이다(`stub.ts` 주석: _"Precision over recall: a lone single-author line … is
  skipped"_).
- **References 오추출률** — 음성라벨이 추출되면 카운트. 0 에 가까워야 한다.
- **본인 처리** — `isSelf` 정탐(본인을 명단에 남기면 오답).

### 2.3 운영 지표 (지연·VRAM·라이선스)

정확도가 같으면 **운영 비용**으로 가른다.

| 지표 | 측정 | 합격 기준의 기준점 |
|---|---|---|
| **지연(latency)** | 문서 1건 `extract()` 왕복 시간 | `VLM_TIMEOUT_MS=120000`(120s) 안에 안정적으로 들어오는가. 배치 워커이므로 초고속이 필수는 아니나, 타임아웃 빈발은 탈락. |
| **VRAM** | 온프레 GPU 점유 | 보유 GPU 1장에 **상주 가능**한가. hindex 캡처는 이미지 동봉이라 메모리 더 먹음(아래 2.4). |
| **라이선스** | 모델 가중치 라이선스 | **온프레 상업 사용 가능**해야 함. 비상업/연구용-only 는 탈락. 클라우드 호출 강제 모델도 탈락. |

> 왜 VLM 경로가 텍스트가 없을 때 이미지를 같이 보내는가: `vlm.ts` 의 `extract()` 는
> `input.imagePaths` 의 각 이미지를 base64 로 인코딩해 `image_url` 콘텐츠로 첨부한다. 즉
> 스캔 PDF/이미지(hindex)에서는 **비전 입력이 들어가므로 VRAM·지연이 더 든다.** 평가는
> 텍스트-only 케이스와 이미지-동봉 케이스를 **따로** 재야 한다.

### 2.4 어떻게 돌리나 (재현 절차)

```bash
# 베이스라인: 결정적 stub (정답라벨셋의 인쇄 케이스 회귀 기준)
EXTRACTOR_MODE=stub  npm test

# 후보 모델 평가: 온프레 엔드포인트/모델만 바꿔 같은 라벨셋으로 채점
EXTRACTOR_MODE=vlm \
VLM_BASE_URL=http://<onprem-host>/v1 \
VLM_MODEL=<candidate-model-tag> \
  node scripts/eval.ts   # 라벨셋 vs extract() 출력 비교 (Phase 1.5 도입 예정)
```

`extract()` 의 출력 형태(`RawPerson[]`)는 모델과 무관하게 고정이므로, **모델만 바꿔가며 동일
채점기로 비교**할 수 있다. 이것이 "교체 가능 추출기" 설계의 핵심 이점이다.

---

## 3. 후보 모델과 라우팅

### 3.1 후보 (개발계획 §14)

| 후보 | 성격 | 1차 적합 영역 | 비고 |
|---|---|---|---|
| **PaddleOCR-VL 1.6** | OCR 특화 VL | 인쇄/표·레이아웃 강함 | 인준페이지 인쇄 텍스트 1순위 후보 |
| **GLM-OCR** | OCR 특화 | 인쇄/문서 OCR | 인쇄·구조화 텍스트 비교군 |
| **DeepSeek-OCR** | OCR 특화 | 인쇄/문서 OCR | 인쇄·구조화 텍스트 비교군 |
| **범용 VLM** | 일반 비전+언어 | 인쇄+손글씨 혼합, 역할 추론 | 코드 기본값 `qwen3.5:9B` 이 여기 해당 |
| **(도장 전용)** | seal 분류기 | 篆刻 인장 검출 | 별도 트랙 — 텍스트 OCR 과 분리 |

> 코드 기본값 `VLM_MODEL=qwen3.5:9B` 는 **"범용 VLM" 슬롯의 초기값일 뿐 확정이 아니다.**
> Phase 1.5 평가가 PaddleOCR-VL 등으로 손쉽게 교체하기 위한 자리표시자다(환경변수 한 줄).

### 3.2 라우팅 — 무엇을 어디로 보내나

핵심은 **"하나의 만능 모델"이 아니라 입력 성격에 따라 다른 엔진으로 보내는 것**이다.

```
                 Stage 3 입력 (docType + sourceKind)
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                        ▼
  인쇄 + 손글씨            도장(seal)                hindex 캡처
  (인준/저자블록)          (篆刻 인장)               (이미지 OCR)
        │                       │                        │
        ▼                       ▼                        ▼
   범용 VLM 경로           seal 전용 트랙           범용 VLM(이미지 동봉)
   (VlmExtractor)         (검토 큐로 직행)          (imagePaths → image_url)
        │                       │                        │
        └──── 결과 RawPerson ───┴──── ReviewFlag(seal) ──┘
```

| 입력 | 라우팅 | 코드 근거 |
|---|---|---|
| 인쇄 + 손글씨 혼합 | **범용 VLM** (PaddleOCR-VL/qwen 류) | `getExtractor('vlm') → VlmExtractor` |
| 도장 | **seal 전용** — 자동추출 비약속, 검토 큐 | `flagForKind(sourceKind)` → `'seal'` |
| 텍스트 없는 스캔/hindex | 범용 VLM 에 **이미지 동봉** | `vlm.ts` 의 `imagePaths` → `image_url` |

라우팅의 "도장→검토 큐" 분기는 이미 워커에 구현돼 있다(`src/worker/process.ts`):

```ts
// src/worker/process.ts
function flagForKind(sourceKind: SourceKind, confidence: number): FlagType | null {
  if (sourceKind === 'seal') return 'seal';
  if (sourceKind === 'handwritten') return 'handwriting';
  if (sourceKind === 'signature') return 'signature';
  if (confidence < HUMAN_REVIEW_CONFIDENCE) return 'low_confidence';   // 0.7
  return null;
}
```

그리고 텍스트가 전혀 없는 문서(스캔 PDF/이미지/hwp)는 문서 단위로 `needs_vision` 플래그가
달려 검토 큐로 간다:

```ts
// src/worker/process.ts
const needsVision =
  doc.ingest.format === 'image' ||
  doc.ingest.format === 'hwp' ||
  (doc.ingest.format === 'pdf' && !doc.ingest.hasTextLayer);
if (needsVision && doc.persons.length === 0) {
  await tx.insert(reviewFlags).values({ /* flagType: 'needs_vision' … */ });
}
```

> 즉 **모델 평가가 라우팅을 바꾸지 않는다.** 라우팅(도장→seal, 손글씨→handwriting,
> 저신뢰→low_confidence, 무텍스트→needs_vision)은 고정이고, 모델은 "범용 VLM 슬롯"과 "seal
> 전용 슬롯"의 **내용물**일 뿐이다. 이 분리 덕분에 모델을 바꿔도 검토 UI·DB·플래그는 그대로다.

---

## 4. 계층 처리 (Tiered A / B / C / D) — 개발계획 §5

도장·손글씨·판독난해 서명을 "한 모델로 해결"하려 하지 않는다. **단계적으로 떨어뜨린다**:
인쇄로 충분하면 인쇄로, 아니면 보조 OCR, 그래도 애매하면 대조, 끝까지 애매하면 사람.
**Tier 가 내려갈수록 비용이 늘지만 정확도/신뢰가 올라가고, 마지막은 항상 사람**이다.

```
A  인쇄 1순위        ──▶ 인쇄 텍스트로 이름 확정 (printed, 자동통과 후보)
        │ 인쇄로 안 잡힘
        ▼
B  보조 OCR          ──▶ 손글씨/저해상 영역에 OCR/VLM 추가 시도
        │ 결과 불확실
        ▼
C  대조(cross-check) ──▶ 인쇄 이름 ↔ 도장/서명 일치 검증 (verificationStatus)
        │ 여전히 애매
        ▼
D  사람(human)       ──▶ 검토 필요 큐 → 담당자 육안 확정 (최종 권위)
```

| Tier | 무엇 | 대상 sourceKind | 산출/플래그 | 코드 접점 |
|---|---|---|---|---|
| **A 인쇄 1순위** | 인쇄 텍스트에서 먼저 뽑는다 | `printed` | confidence 높음 → 자동통과 | stub: `confidence: 0.9/0.85`; VLM 동일 |
| **B 보조 OCR** | 인쇄로 안 잡힌 손글씨 영역 보강 | `handwritten` | 잡히면 검토 큐(handwriting) | `flagForKind` → `'handwriting'` |
| **C 대조** | 인쇄 이름과 도장/서명 일치 확인 | `seal`/`signature` | `verificationStatus` (`confirmed`/`mismatch`/`unverifiable`) | `domain.ts` `VERIFICATION_STATUSES`; `extracted_persons.verification_status` |
| **D 사람** | 끝까지 애매한 것은 사람이 확정 | 모두 | `ReviewFlag` 후 사람 확정 | `process.ts` 플래그 적재 → 검토 UI |

이 계층의 임계값이 **`HUMAN_REVIEW_CONFIDENCE = 0.7`** 이다. Tier A 에서 나온 항목이라도
신뢰가 0.7 미만이면 자동통과되지 못하고 `low_confidence` 로 D 단계(사람)로 내려간다
(`process.ts`: `needsHuman = p.sourceKind !== 'printed' || p.confidence < HUMAN_REVIEW_CONFIDENCE`).

> **모델 평가가 정하는 것은 "A/B 가 어디까지 커버하느냐"** 다. 좋은 모델이면 A/B 에서 더 많이
> 확정돼 D(사람)로 내려가는 양이 줄어든다. **하지만 도장(seal)은 어떤 모델이어도 A/B 로
> 자동확정하지 않는다 — 항상 C 대조 후 D 사람**이 원칙이다(README: "도장 … 자동 추출을
> 약속하지 않고 검토 필요 큐로").

검토 큐의 플래그 유형(`FLAG_TYPES`, `domain.ts`)과 한글 라벨:

| `FlagType` | 한글 라벨(`FLAG_TYPE_LABELS_KO`) | Tier |
|---|---|---|
| `seal` | 도장 | C→D |
| `handwriting` | 손글씨 | B→D |
| `signature` | 서명 | C→D |
| `low_confidence` | 저신뢰 | D |
| `ambiguous` | 동명이인/약어 | D |
| `needs_vision` | 비전 판독 필요 | D |

---

## 5. 교정 플라이휠 (correction flywheel)

검토 UI 에서 사람이 내리는 모든 교정은 버려지지 않고 **`corrections` 테이블에 적재**된다.
이 누적이 곧 다음 라운드의 정답라벨셋이자 파인튜닝 데이터가 된다 — **쓸수록 좋아지는 고리**.

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  ① 추출(초안)   범용VLM/stub → RawPerson → person_aggregates       │
 │        │                                                           │
 │        ▼                                                           │
 │  ② 사람 검토    confirm / edit / reject / exclude  (검토 UI)        │
 │        │  POST /api/persons/[id]                                    │
 │        ▼                                                           │
 │  ③ 교정 적재    insert into corrections (field/old/new/action)      │
 │        │                                                           │
 │        ▼                                                           │
 │  ④ 라벨셋 축적  교정 누적 = 도장/손글씨/한자 실분포 라벨            │
 │        │                                                           │
 │        ▼                                                           │
 │  ⑤ 파인튜닝     축적 라벨로 범용 VLM/도장 전용 미세조정             │
 │        │                                                           │
 │        └──────────────▶ ① 더 나은 초안 (반복)                      │
 └──────────────────────────────────────────────────────────────────┘
```

교정 적재는 이미 동작한다(`src/app/api/persons/[id]/route.ts`). 검토 액션이 들어오면
`person_aggregates` 의 `finalStatus`/`canonicalName` 을 갱신하고, **같은 트랜잭션 흐름에서
`corrections` 에 변경 이력을 남긴다**:

```ts
// src/app/api/persons/[id]/route.ts
await db.insert(corrections).values({
  applicantId: agg.applicantId,
  personId: agg.id,
  field: isEdit ? 'canonicalName' : 'finalStatus',
  oldValue: isEdit ? agg.canonicalName : agg.finalStatus,
  newValue: isEdit ? canonicalName : finalStatus,
  action: body.action === 'reject' ? 'reject' : body.action,   // confirm|edit|reject|exclude
});
```

`corrections` 스키마(`src/db/schema.ts`)는 이미 **"미래 학습 데이터 + 정확도 추적"** 용도로
주석돼 있다(_"Audit log of human corrections — future training data + accuracy tracking"_).
보유 컬럼: `applicantId`, `personId`, `field`, `oldValue`, `newValue`,
`action`(`confirm|edit|reject|exclude`), `createdAt`.

이 플라이휠로 만드는 두 가지:

1. **정확도 추적** — `action='confirm'` 대 `edit/reject/exclude` 비율 = 자동 초안의 실측
   정밀도. 카테고리별(2.2)로 쪼개면 "도장에서 사람 교정이 많다 → 도장 트랙 보강 필요" 같은
   신호가 바로 나온다.
2. **라벨 축적 → 파인튜닝** — `edit`(이름 정정)·`reject/exclude`(오추출)은 곧 정답/오답
   라벨이다. 이를 도장·손글씨한자 등 약한 카테고리에 모아 범용 VLM 또는 도장 전용 모델을
   미세조정한다(개발계획 §5/§14의 "도장 전용 엔진/파인튜닝" 트랙; README §범위 Phase 2+).

> 플라이휠의 전제도 동일하다: 사람이 만든 교정이 **신뢰 가능한 라벨**이라는 것. 그래서 검토
> UI 는 출처(문서·페이지·evidence 스니펫)를 함께 보여줘 사람이 근거를 보고 확정하게 한다
> (`SourceRef.evidence`, README §검토 UI). 모델을 바꾸든 파인튜닝하든, **최종 권위는 계속
> 사람**이다.

---

## 6. 의사결정 체크리스트 (도입 시)

후보 모델을 `VLM_MODEL` 로 승격하기 전 확인:

- [ ] 합격자 3명분 정답라벨셋이 `./data/` 로컬에 준비됨(git 미커밋, 내부망).
- [ ] 카테고리별(인쇄/손글씨한글/손글씨한자/도장) Precision/Recall/F1 측정 — **인쇄
      precision 우선**.
- [ ] References 오추출률 ≈ 0, 본인(`isSelf`) 처리 정탐.
- [ ] 지연이 `VLM_TIMEOUT_MS`(120s) 안에 안정적, VRAM 이 보유 GPU 1장에 상주 가능.
- [ ] 라이선스가 온프레 상업 사용 가능(클라우드 강제·비상업 라이선스 탈락).
- [ ] 도장은 자동확정하지 않고 검토 큐로 가는 라우팅 유지(`flagForKind`).
- [ ] 전환은 환경변수만(`EXTRACTOR_MODE=vlm` + `VLM_MODEL`/`VLM_BASE_URL`), 코드 변경 없음.

확정 후 `.env` 갱신 → 워커 재기동이면 적용 끝. 모델 교체가 **검토 UI·DB·플래그·라우팅을
건드리지 않는다**는 점이 이 설계의 핵심이며, 그래서 평가는 모델 슬롯만 갈아끼우며 반복할 수
있다.

---

관련 문서: [추출기 구조 (extractors)](./extractors.md) · [로드맵 (roadmap)](./roadmap.md) ·
[파이프라인 (pipeline)](./pipeline.md)
