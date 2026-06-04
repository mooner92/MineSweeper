# 실샘플 정확도 검증 & 임계값 튜닝 절차

실제 합격자 첨부파일이 도착했을 때 **이름 추출 정확도**와 **도장/서명 감지 정확도**를 측정하고,
필요하면 검토 임계값(`REVIEW_THRESHOLDS`)을 보정하는 단계별 절차다.

> 핵심 원칙: 자동 추출은 **초안**이다. 목표는 "검토량을 줄이되, 놓치는 관계인(미검출)을 0에 가깝게"다.
> 임계값은 **재현율(recall)을 깎지 않는 선에서만** 올린다. (자세한 게이트: `improvement-plan-ocr.md §4`)

---

## 0. 준비 — 모드 선택

`ecosystem.config.cjs`의 `EXTRACTOR_MODE`:

| 모드 | 텍스트 PDF | 이미지/스캔(hindex) | GPU | 용도 |
|---|---|---|---|---|
| `stub` | 결정적 추출 | (이미지엔 이름 없음) | 불필요 | 빠른 baseline |
| `hybrid` ✅현재 | 결정적 추출 | **VLM OCR** | 이미지 문서만 | 권장 운영값 |
| `vlm` | VLM | VLM | 항상 | 전수 VLM 비교용 |

모드 변경 후: `pm2 restart ecosystem.config.cjs --update-env`

도장/서명 감지는 추출 모드와 독립(`DETECT_MARKS=1`).

---

## 1. 검토량 baseline 측정 (추출 전/후)

```bash
npm run eval
```

(docType × sourceKind)별 `needsHuman` 비율을 출력한다. 샘플 투입 **전(현재)** 과
**후** 를 비교해 "VLM/임계값 변경이 검토량을 얼마나 바꿨는지" 본다.

## 2. 샘플 투입

1. 웹 UI(`/`)에서 합격자 ZIP/폴더 업로드 → 워커가 자동 처리(Ingest→Type→Extract→Aggregate).
2. `pm2 logs minesweeper-worker` 로 처리 로그 확인.
3. 처리 후 `npm run eval` 재실행 → 검토량 비교.

## 3. 이름 추출 정확도 채점 (라벨 대비)

자동 채점은 **정답 라벨**이 있어야 한다. 라벨이 없으면 검토 UI에서 사람이 확인하는 것이 곧 검증이다.

- **정성 확인(라벨 無)**: `/applicants/[id]` 에서 추출된 관계인 목록을 원문과 대조.
  특히 `nameCandidates`(근접중복 후보)와 `needsHuman` 플래그가 올바른지 본다.
- **정량 채점(라벨 有)**: 신청자별 정답 명단(CSV)을 만들고, 추출 결과와 대조해
  - **재현율(recall)** = 맞게 잡은 관계인 / 실제 관계인  ← **가장 중요(미검출 최소화)**
  - **정밀도(precision)** = 맞게 잡은 관계인 / 추출한 관계인
  - 오추출 유형: 이름 아님(직함/기관)·동명이인 과병합·오독('이주영'→'이조영')

> ⚠️ **한국어 OCR 주의**: 라이브 점검에서 Qwen2.5-VL-7B는 **로마자 이름**(예: "Jucheol Jung")은 잘 읽지만
> 합성 렌더의 **한글 전용** 글자는 종종 놓쳤다. 실제 인준서는 한글+로마자 병기가 많아 더 나을 수 있으나,
> 이미지 문서의 **한글 이름 재현율**을 샘플로 꼭 따로 확인할 것. 재현율이 낮으면 (a) 더 큰 VLM(`vlm` 모드로
> 32B급) 또는 (b) 전용 한국어 OCR 사이드카(`improvement-plan-ocr.md` 1.5b)를 검토한다.

## 4. 도장/서명 감지 정확도 (육안 스팟체크)

1. `/review-queue` → `도장`·`서명` 필터칩 선택.
2. 각 항목의 **크롭 썸네일**을 본다:
   - ✅ 실제 도장/서명을 잡았나(true positive)
   - ❌ 인쇄 텍스트/표를 잘못 잡았나(false positive) → 프롬프트/필터 조정 신호
   - ❌ 명백한 도장을 놓쳤나(false negative) → `pagesToScan` 범위/모델 신호
3. 표본 20~30건이면 대략의 정확도 감을 잡기 충분.

## 5. 임계값 튜닝

조정 위치: **`src/lib/review-policy.ts` → `REVIEW_THRESHOLDS`**

```ts
export const REVIEW_THRESHOLDS = {
  printed: 0.85,        // 인쇄 텍스트: confidence가 이 값 미만이면 사람 검토
  handwritten: 1.01,    // 손글씨: 항상 사람 검토(1.01 = 절대 자동확정 안 함)
  seal: 1.01,           // 도장: 항상 사람 검토
  signature: 1.01,      // 서명: 항상 사람 검토
};
```

- **불변식(절대 깨지 않음)**: 비인쇄(손글씨/도장/서명)는 **항상 `needsHuman`**. → 이 값들(1.01)은 내리지 않는다.
- **튜닝 대상은 `printed` 하나뿐**:
  - 검토량이 너무 많고 + recall이 1.0이면 → `printed`를 **소폭 낮춰**(예: 0.80) 자동확정 늘림.
  - 미검출(놓친 관계인)이 보이면 → `printed`를 **올려**(예: 0.90) 검토로 더 보냄.
- 변경 후 반드시 `npm test`(정책 테스트) + `npm run eval`(검토량) 재확인.

## 6. go/no-go — 전용 OCR 사이드카(1.5b) 진입 판단

`improvement-plan-ocr.md §4`의 게이트: **손글씨/이미지 카테고리 검토량이 ≥30% 줄고 AND
abstain-recall ≥0.95** 일 때만 전용 OCR 모델 도입을 진행한다. 그 전엔 현재 VLM+감지로 충분.

---

## 체크리스트
- [ ] `npm run eval` baseline(투입 전) 기록
- [ ] 샘플 업로드 → 워커 처리 완료
- [ ] `npm run eval` 재측정(투입 후) — 검토량 비교
- [ ] 이름 추출 정성/정량 확인(재현율 우선)
- [ ] `/review-queue` 도장·서명 크롭 육안 스팟체크(20~30건)
- [ ] 필요 시 `REVIEW_THRESHOLDS.printed`만 보정 → test + eval 재확인
