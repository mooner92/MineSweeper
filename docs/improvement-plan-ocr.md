# 개선 계획 — 도장/손글씨 OCR · 실신뢰도 · 판독불가(abstain) · 오추출 교차검증

> **상태: 계획 (pending approval)** — 구현 전. Planner→Architect→Critic 합의(ralplan, DELIBERATE)로 수립.
> 관련: [model-evaluation.md](./model-evaluation.md) · [roadmap.md](./roadmap.md) · [extractors.md](./extractors.md)
>
> 대전제(코드·README 그대로): **자동 추출은 초안, 최종 판단은 사람, 절대 이름 미생성.**
> 목표는 "사람을 없애는 것"이 아니라 **사람이 봐야 할 양을 줄이고, 사람이 보는 것의 신뢰도를 높이고,
> 자동 통과되는 것이 틀릴 확률을 낮추는 것**이다.

---

## 0. 현재 상태 (코드 확인 완료)

| 사실 | 근거 |
|---|---|
| 도장/손글씨/서명은 `sourceKind` 태깅 + 검토 큐로만 보냄. **OCR 안 함.** | `worker/process.ts flagForKind()` → seal/handwriting/signature ReviewFlag |
| stub은 이미지(hindex)에 `[]` 반환(미생성) | `extract/stub.ts case 'hindex': return []` |
| vlm은 페이지 이미지를 범용 VLM에 보내 읽지만 **전용 OCR/도장 처리 없음** | `extract/vlm.ts imagePaths → image_url` |
| confidence: stub 고정값 / vlm **자기보고값** — **실 OCR 신뢰도 아님** | `vlm.ts:111,114` |
| **텍스트 PDF 페이지는 imagePath 없음** (인준 페이지 도장 크롭 불가) | `ingest/pdf.ts:79` |
| `ocrConfidence`/`verificationStatus`/`regionBbox`/`cropPath` 컬럼 존재하나 **미채움** | `db/schema.ts:64-70`, `process.ts:84` |
| `needsHuman = sourceKind!=='printed' \|\| confidence<0.7` (두 곳에서 계산) | `process.ts:71`, `aggregate.ts:74` |

핵심: **인장/서명 영역을 잘라(crop) 모델에 주는 경로 자체가 없다.** 게다가 인쇄 이름과 도장이 같은
페이지에 있는 유일한 문서(텍스트 PDF 학위논문 인준 페이지)에는 페이지 이미지조차 없다. 따라서 도장
OCR·교차검증은 (a) 페이지 래스터화, (b) 영역 검출/크롭, (c) 크롭→OCR이 새로 필요하며 이는 본질적으로
**1.5b**의 일이다.

---

## 1. 사용자 질문 3가지에 대한 답

1. **"도장·수기 사인은 지금 처리 안 하고 감지해서 거르기만 하나?"** → **맞다.** 감지→사람 검토 큐로만
   보낸다(OCR 없음). 그리고 이 "검출→사람 종착"은 도장처럼 사람도 못 읽는 입력에 대해 **올바른 최종
   설계**일 수 있어, 아래 **Option D**로 정량 분기를 살려 둔다.
2. **"OCR 신뢰도 점수를 알 수 있나? 도장이라 판단불가한 경우 구분되나?"** → **가능(엔진별).** 전용
   OCR(PaddleOCR/TrOCR)은 글자별 인식 score를 네이티브로 준다; VLM은 vLLM **logprobs**로 토큰 확률을
   계산. 단 **현재 기본 Ollama는 logprobs 제약** → 산출 신뢰도를 쓰려면 **vLLM 전환이 선결조건**이고,
   그 전까지 VLM 자기보고 confidence는 **표시용(advisory)으로만** 쓰고 자동통과 판정에는 안 쓴다.
   판독불가(abstain)는 **다중신호**(낮은 score + 이름형태 부적합 + VLM 빈결과 + 검출 score)로 판정,
   `verificationStatus='unverifiable'` + 자동통과 금지. abstain 품질은 **abstain-precision ≥0.9 /
   abstain-recall ≥0.95** 로 관리. (logprob은 "글씨를 못 읽음" 신호로는 좋지만 "그럴듯한 틀린 이름"
   탐지로는 약하다 → 오추출은 ↓ 별도 방어.)
3. **"사인 '이주영'을 '이조영'으로 오추출하면?"** → **4중 방어**(문서유형별 적용): ① 글자별 신뢰도
   하이라이트, ② **n-best 후보 드롭다운**(미팅의 "한글 이름 여러 개 병기" 요구와 직결), ③ 교차검증
   (학위논문 인준 페이지 한정: 인쇄 이름=앵커 ↔ 도장/서명 대조 → confirmed/mismatch/unverifiable),
   ④ gazetteer 퍼지매칭(같은 지원자 텍스트소스 이름과 편집거리 ≤1, 조↔주=1 → 교정 제안). 불변식:
   **OCR/손글씨/도장 출처는 어떤 점수라도 절대 자동확정 금지.**

### 오추출 방어 커버리지 (문서유형별)

| 문서유형 | substrate | 인쇄 앵커 | 도장 | 1차 오추출 방어 | 교차검증 |
|---|---|---|---|---|---|
| 학위논문(인준) | 텍스트 PDF(1.5a 이미지 없음) | 있음 | 있음 | gazetteer + n-best + (1.5b)크롭/글자별 | **가능(유일)** — 래스터/크롭 후 |
| hindex(스칼라) | 이미지 전용 | **없음** | 없음 | **UI n-best + 글자별 하이라이트 + cross-source gazetteer** | n/a(앵커 없음) |
| 학술/대표실적 | 인쇄(텍스트) | 있음 | **없음** | gazetteer + n-best | n/a(도장 없음) |

---

## 2. 원칙 · 동인

**Principles** — ① 사람이 최종 권위(OCR/손글씨/도장 출처는 절대 자동확정 금지, printed만 자동통과
후보). ② 미생성 불변식(비거나 불확실하면 빈 결과/abstain). ③ 온프레·외부 클라우드 금지(크롭=PII).
④ 신뢰도 출처 정직 표기(산출 logprob vs 자기보고 — 자기보고는 advisory only). ⑤ 점진적·교체가능
(`getExtractor`는 추출 전 아는 키 `docType`/`format`로만 라우팅; `sourceKind`는 추출 OUTPUT이라 라우팅 키 금지).

**Decision Drivers** — ① 오추출 자동통과 비용 최대(precision·abstain 우선). ② 누락도 지뢰(애매하면
버리지 말고 크롭+후보로 사람에게). ③ 운영/보안 단순성(무거운 엔진·이미지 의존성은 단계로 통제).

---

## 3. 추천 설계 — Option C (하이브리드 라우팅), 단계적

문서유형/포맷으로 카테고리별 최적 엔진에 라우팅: 인쇄·hindex=문서 OCR-VLM, 손글씨=ko-trocr, 도장=검출+
TrOCR 또는 abstain. 영역별(seal vs printed) 라우팅은 추출기 내부(검출 후). 대안 비교:

- **A. 전용 OCR 마이크로서비스(PaddleOCR+TrOCR)** — 네이티브 글자별 score(가장 정직)이나 새 Python
  서비스 2모델 운영 부담 → C의 1.5b 구성요소로 흡수.
- **B. 문서 OCR-VLM(PaddleOCR-VL/GLM-OCR via vLLM)** — 코드영향 작고 인쇄 SOTA이나 logprob이 vLLM
  런타임 요구, 도장 약함 → logprob 단계의 선결조건으로 명시.
- **C. 하이브리드(추천)** — 카테고리별 최적 + 도장 abstain 구조화. 가장 복잡 → 단계로 분할.
- **D. (Steelman) "검출→사람 종착", OCR 엔진 보류/폐기** — 운영 표면 최소·사람권위 정합. **정량 게이트로
  살아있는 종착 후보**(아래 §5 go/no-go).

### HuggingFace 후보 모델 (2026-06 리서치)

| 카테고리 | 후보 | 비고 |
|---|---|---|
| 손글씨 한글 | [`ddobokki/ko-trocr`](https://huggingface.co/ddobokki/ko-trocr) | TrOCR·초성 토크나이저, 토큰확률→신뢰도 |
| 인쇄/문서 | PaddleOCR-VL 1.5 / GLM-OCR / DeepSeek-OCR-2 | OmniDocBench 94.5 / SOTA 94.6 / 91.09, 한국어·seal 모드 |
| 도장 | 턴키 한국어 모델 없음 | YOLO 검출 + TrOCR, 전서체는 abstain |

---

## 4. 단계적 로드맵 (테스트가능 acceptance 요약)

### Phase 1.5a — 텍스트 기반 (모델·의존성·런타임 추가 0)
`scripts/eval.ts` 스켈레톤 + **검토량 baseline**, 공유 폼체크 헬퍼(charset/길이/stopword), gazetteer
퍼지(`editDistance`/`fuzzyMatchWithin`), `nameCandidates`(n-best) 컬럼+UI 드롭다운, 자기보고
confidence=advisory 표기, **confirmed-is-advisory 불변식**(`sourceKind!=='printed'` ⇒ `needsHuman=true`,
두 사이트 공유 헬퍼로 핀).
- Accept: `EXTRACTOR_MODE=stub npm test` 전부 통과(`namesMatch` 불변), `editDistance('이주영','이조영')===1`,
  `crossCheck`가 hindex/journal에 NO-OP, 비-printed는 verificationStatus='confirmed'여도 needsHuman=true,
  **반-공허 가드**: 실제 케이스 ≥1건에서 `nameCandidates.length>1`. (1.5a의 nameCandidates는 **엔진
  n-best가 아니라 gazetteer 퍼지 대체후보**.)

### Phase 1.5b — 전용 OCR 사이드카 + 래스터/크롭 + 교차검증
`OcrExtractor`(PaddleOCR/ko-trocr, `OCR_BASE_URL`), PDF→PNG 래스터(ingest)+`sharp` 크롭 →
`cropPath`/`regionBbox` 실생성, 네이티브 글자별 score(`charConfidences`/`ocrConfidence`),
**degree_thesis printed↔seal `crossCheck()`** → `verificationStatus`.
- Accept: 사이드카 다운 시 graceful degrade(미생성 불변), 외부 호출 0건(네트워크 차단 테스트),
  크롭 PNG git 미추적, crossCheck 4상태, **confirmed여도 seal/signature는 needsHuman 유지**.

### Phase 1.5c — 도장 트랙 + 평가 플라이휠
도장 검출+TrOCR/abstain, `eval.ts` 카테고리별 P/R/F1/CER/abstain-precision·recall, 임계값 캘리브레이션,
교정→라벨 축적→파인튜닝.

### go/no-go 게이트 (1.5b 진입 전)
1.5a 이후 측정한 검토량 baseline 대비, 1.5b가 **손글씨/이미지 카테고리 검토량 ≥30% 감소를
`abstain-recall ≥0.95` 유지와 함께** 달성할 것으로 라벨셋이 시사하지 못하면(둘 중 하나라도 미달) →
**Option D 채택(OCR 엔진 보류/폐기, 검출→사람 종착).** Driver-2(recall)를 Driver-1(volume)과 맞바꾸지 않는다.

---

## 5. 데이터모델 · 파이프라인 · UI 변경

- **데이터모델**: `extractedPersons`에 `charConfidences`(json)·`nameCandidates`(json) 컬럼 신설,
  기존 `ocrConfidence`/`regionBbox`/`cropPath`/`verificationStatus` 실채움. drizzle 마이그레이션
  (후방호환 + down 롤백 테스트).
- **파이프라인**: 래스터/크롭=ingest(Stage 1, imagePath 소유), OCR=`OcrExtractor`(Stage 3, imagePaths
  소비). `crossCheck()`를 `run.ts` aggregate 직전 삽입(1.5b, degree_thesis만 실효).
- **UI**(shadcn/ui 등 컴포넌트 리소스 활용 가능): 후보 선택 드롭다운(`nameCandidates`, 1.5a),
  크롭+bbox 오버레이(이미지 포맷 1.5a / 텍스트 PDF는 1.5b), 글자별 하이라이트(1.5b), 대조 배지
  (`verificationStatus`, 1.5b). `PersonActions`의 `window.prompt` 편집을 후보 선택 UI로 대체.

## 6. 보안 / 인프라
온프레 GPU·마이크로서비스(`OCR_BASE_URL`/`VLM_BASE_URL` 내부망), **외부 API 금지**. 크롭 이미지=PII →
`./data/` 로컬·git 미커밋·접근통제·보존/파기 정책, 로그에 이미지/base64 미출력.

## 7. 선결 의사결정 (열린 질문)
1. 이미지 의존성(PDF 래스터+`sharp`) 도입 승인? (1.5b 전제)
2. Ollama 유지 vs vLLM 전환 (logprob 실신뢰도 선결조건)
3. 라벨셋(합격자 3명분 PII) 확보 시점
4. 도장 검출기 투자 vs "도장=무조건 사람"
5. 크롭 PII 보존/파기 정책
6. `nameCandidates`/`charConfidences` json 컬럼 vs 정규화 테이블

## 8. ADR 요약
- **Decision**: Option C 단계적 채택. 1.5a=텍스트만(모델/의존성/런타임 0, logprob·교차검증 미포함),
  1.5b=전용 OCR+래스터/크롭+교차검증, 1.5c=도장+평가.
- **Why**: 카테고리별 최적 엔진 + 도장 구조적 abstain이 오추출·누락을 동시에 줄이고, 물리 제약(텍스트
  PDF imagePath 부재·hindex 앵커 부재)을 단계 경계와 정렬하며, 비용을 정량 게이트로 통제.
- **Alternatives**: A/B는 C의 단계 구성요소로 흡수, **D는 정량 go/no-go의 독립 종착 분기로 보존**.
- **Consequences**: (+) 사람 검토 품질↑·자동통과 오류↓. (−) 신규 컬럼/마이그레이션, 1.5b부터 GPU
  사이드카·이미지 의존성·(logprob 시)vLLM·PII 크롭 저장 부담.
