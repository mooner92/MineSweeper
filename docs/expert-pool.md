# 전문가 풀 — 제척 대조 + 면접위원 초빙

> 인사팀 시나리오: **① ZIP 업로드·분석 → ② 제척 대상 확인(+원문 크로스체크) → ③ 초빙 가능 인원
> 선별·담기 → ④ 초빙 명단 Excel 산출(변질 없는 DB 영속)**. KEI 심사위원 후보 전문가 풀(약 2,882명)을
> 기준으로, 지원자의 이해충돌 관계자를 자동 대조하고 비충돌 전문가를 골라 면접위원으로 초빙한다.

관련 코드: `src/lib/experts.ts`(제척 매칭) · `src/lib/invite.ts`(지원자별 초빙) · `src/lib/rounds.ts`(회차 단위 제척·섭외)
· `scripts/import-experts.ts`(적재) · `src/components/{InvitePanel,RoundInvitePanel}.tsx`(UI)
· `src/app/api/{invite,rounds}/*`(API) · `src/app/rounds/*`(회차 페이지) · `src/db/schema.ts`(`experts`·`invitations`).

## 1. 풀 적재 — `scripts/import-experts.ts`

```
npx tsx scripts/import-experts.ts <전문가명단.xlsx>
```

- 한 전문가가 **세부분야마다 여러 행**으로 나오므로 `ID` 기준으로 합치고, 분류체계 경로
  (대분류 > 중분류 > 소분류 > 세부분야)를 `fields` 배열로 모은다.
- 헤더는 **이름 기반 매핑**(중복된 `성명` 컬럼은 첫 번째만 채택). 매칭 키 `nameKey`는 관계자 대조와
  동일한 정체성 키(`korean:홍길동`, `latin:h yang`)를 쓴다.
- **전체 교체**(재실행 시 갱신본으로 통째 교체). 따라서 풀은 **교체 가능한 외부 명단**이다 — 추후
  **원장 추천 면접위원 명단**이 같은 xlsx 포맷으로 들어오면 같은 명령으로 적재해 풀을 대체하면, 제척 대조와
  섭외가 그 명단 기준으로 동작한다(코드 변경 없음). 명단은 **PII**(이름·이메일·전화)이므로 DB(`*.db`)는
  `.gitignore` 대상 — 절대 커밋하지 않는다.

`experts` 컬럼: `id`(외부 KEI ID) · `name` · `nameKey` · `affiliation` · `position` · `email` · `phone`
· `fields`(JSON, `ExpertField[]`) · `registeredAt`.

## 2. 제척 대조 — `src/lib/experts.ts`

지원자의 관계자(지도교수·심사위원·공저자·연구진; 본인·제외 항목 제외)와 풀을 **이름 키로 대조**해,
일치하는 전문가를 **제척 대상**(해당 지원자 심사 배제 검토)으로 표시한다.

- 정책(확정): **재현율 우선** — 이름이 같으면 모두 후보로 띄우고, **동명이인 수**와 소속·분야를 함께
  보여 사람이 확정한다. **자동 차단하지 않는다**(초안 → 사람 확정 원칙).
- 표시: 지원자 페이지의 `제척 대상` 통계 + `전문가 풀 대조` 섹션(소속·직위·분야·일치 관계자·동명이인 N
  ·이메일) + 관계자 표의 `제척` 배지.
- 순수 함수 `assembleConflicts(persons, candidates)`로 분리해 단위 테스트(`tests/experts.test.ts`).

## 3. 면접위원 초빙 — `src/lib/invite.ts` + `InvitePanel`

전문가 풀에서 면접위원 후보를 골라 담아 **초빙 명단**을 만든다.

- **후보 필터**: 제척·기담음을 제외하고, **분야(대/중분류) + 이름·소속·분야명 검색**으로 좁힌다
  (상위 60명 표시). 지원자 분야 정보가 없으므로 인사팀이 고른 분야를 `applicants.fieldDae/fieldMid`에
  저장해 **재방문 시 기본 필터로 복원**한다. 순수 필터 `filterExperts()` → `tests/invite.test.ts`.
- **담기/빼기**: `invitations` 테이블에 영속. 빼기는 **soft-delete**(`removedAt`)로 변경 이력 보존,
  활성 명단 = `removedAt IS NULL`.
- **변질 방지(핵심)**: 담는 순간 전문가 정보(이름·소속·직위·이메일·전화·분야)를 **스냅샷**으로 박는다.
  풀을 재적재하거나 전문가 레코드가 바뀌어도 **확정한 초빙 명단은 불변**이다(`expertId`는 참조용일 뿐 FK 아님).
- **산출**: `GET /api/invite/export?applicantId=` → 초빙 명단 Excel(스냅샷 그대로).

API: `GET /api/invite/candidates`(후보) · `POST|DELETE /api/invite`(담기/빼기) · `PUT /api/invite/field`
(분야 저장) · `GET /api/invite/export`(엑셀). 모두 미들웨어 세션 인증 뒤에 있다.

## 4. 회차 단위 제척·섭외 — `src/lib/rounds.ts` + `RoundInvitePanel`

지원자 1명 단위가 아니라 **회차(또는 그 안에서 고른 서류 합격자)** 단위로 면접위원을 섭외하는 실사용 흐름.
인사팀은 *개별 지원자별 충돌*이 아니라 *이 회차에서 누구를 면접위원으로 부를 수 있나*를 알고 싶어 한다.

- **합집합 제척**: 선택한 지원자들의 제척 대상을 **전문가별로 합집합**으로 묶는다(`getRoundConflicts`).
  한 전문가가 여러 지원자와 충돌하면 한 행으로 모으고 **지원자별 사유(일치 관계자·유형·근거 문서·페이지)**
  를 누적한다. 병합은 순수 함수 `mergeRoundConflicts()` → `tests/rounds.test.ts`.
- **섭외 가능 = 풀 − 제척 합집합**: 아무에게도 제척되지 않은 전문가가 면접위원 후보다
  (`getRoundCandidates`, 분야·검색 필터는 `filterExperts` 재사용). **불변식: 제척 + 섭외가능 = 풀**
  — 동일 풀에서 id 집합으로 분할하므로 충돌 인원이 후보로 새지 않음이 *구조적으로* 보장된다.
- **매칭 동일성**: 회차 뷰는 지원자 페이지와 **같은 `assembleConflicts`·같은 키 로드**를 쓴다 — 재구현이
  아니라 재사용이라 per-applicant ↔ round 결과가 일치한다.
- **화면**: `/rounds`(회차 목록) → `/rounds/[round]`. 대조할 지원자 다중선택 → 제척 종합(전문가별 토글로
  지원자별 사유) + 섭외 가능 전문가(분야·검색·더보기). 선택·분야·검색 변경 시 `POST /api/rounds/candidates`
  로 재계산(stale 방지 시퀀스 가드).
- **산출**: `GET /api/rounds/export` → **엑셀 2시트(섭외 가능 전문가 / 제척 대상+사유)** 또는 CSV.
  빈 선택은 '제척 0·풀 전체'라는 위험한 산출물이라 거부(400).

## 5. 다음 단계

- **회차 단위 초빙 명단 영속**: 현재 회차 뷰는 *읽기·내보내기* 중심(섭외 가능 명단 산출). 회차 단위로 고른
  면접위원을 담아 두는 영속(round invitations)은 후속 과제.
- **풀 증분 갱신**: 현재 적재는 전체 교체뿐. 면접 중 추가 추천 인원을 증분 반영(upsert) + 재대조가 후속 과제.
- **섭외가능 분야 자동 추정**: 현재는 인사팀이 분야를 직접 고른다. 지원자 문서에서 연구 분야를 추정해
  기본 분야를 제안하면 후보 좁히기가 더 빨라진다.
- **초빙 명단 확정 잠금**: 현재는 언제든 수정 가능(이력 보존). 필요 시 '확정' 상태를 추가해 잠근다.
