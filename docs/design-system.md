# 디자인 시스템 — KEI Minesweeper

> 한국환경연구원(KEI)에서 만든 내부 도구의 일관된 룩앤필을 위한 규칙. **색은 먼저 정의하고, 컴포넌트는
> 시맨틱 토큰만 참조한다.** 색을 바꿀 일이 있으면 `src/app/globals.css`의 토큰만 고친다 — 컴포넌트
> 코드에 raw 색(hex)을 박지 않는다. (seed-design 방식을 따르되 팔레트는 KEI 브랜드로 교체.)

## 1. 브랜드 색

| 역할 | 색 | 의미 |
|---|---|---|
| **Primary (그린)** | `#00B48D` | KEI 메인. 주요 동작·활성·포커스·링크·브랜드 |
| **Secondary (블루)** | `#00A4E0` | 정보·진행·보조 강조 |
| **Neutral (그레이)** | `#80817E` | 본문 보조 텍스트·경계. **남용 금지**(많이 쓰지 않는다) |

이벤트 색은 의미 그대로 유지: **레드 = 중단·제척·오류**, **앰버 = 주의·로딩성 경고**, **그린(통과) =
완료·자동 통과·섭외가능**(브랜드 그린 계열).

## 2. 시맨틱 토큰

CSS 변수(`--seed-*`, `globals.css`) → Tailwind 색(`tailwind.config.ts`)으로 노출된다. 컴포넌트는
`bg-accent`, `text-fg-muted`, `bg-info-subtle` 처럼 **토큰 유틸리티만** 쓴다.

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `accent` / `-pressed` / `-subtle` | `#00B48D` / `#009B79` / `#E1F6F0` | `#1EC9A3` / `#00B48D` / `#10302A` | 주요 버튼·활성 칩·포커스 링·링크 |
| `info` / `-subtle` | `#00A4E0` / `#E2F4FC` | `#38B6E8` / `#102A36` | 정보 점·진행(추출 중) 배지·보조 강조 |
| `success` / `-subtle` | `#0E9F6E` / `#E3F5EE` | `#3FCF7F` / `#14301F` | 자동 통과·완료·섭외가능 |
| `warning` / `-subtle` | `#A66B00` / `#FFF5E0` | `#E0A23C` / `#382A10` | 미확인·동일소속·확인 권장 |
| `danger` / `-subtle` | `#D92D20` / `#FDECEB` | `#F5685C` / `#3A1714` | 제척·추출 오류·삭제 |
| `fg` / `-muted` / `-subtle` / `-oncolor` | `#1B1C1B` / `#565756` / `#80817E` / `#FFF` | `#F3F5F4` / `#B0B3B1` / `#80817E` / `#FFF` | 본문/보조/흐림/색 위 글자 |
| `bg` / `-layer` / `-elevated` | `#FFF` / `#F5F6F6` / `#FFF` | `#17191A` / `#1F2122` / `#26292A` | 본문/한 단계 낮은 면/떠 있는 면 |
| `stroke` / `-strong` | `#E7E8E7` / `#CFD1CF` | `#2D2F30` / `#3E4140` | 경계/강조 경계 |

반지름: `rounded-seed`(10px), `rounded-seed-lg`(16px). 폰트: Pretendard.

## 3. 컴포넌트 클래스 (`globals.css @layer components`)

- 버튼: `seed-btn-primary`(그린 채움) · `seed-btn-neutral`(테두리) · `seed-btn-ghost`(투명)
- 입력: `seed-input`(input·select 공용)
- 카드: `seed-card`
- 배지: `seed-badge-success` · `-warning` · `-danger` · `-info` · `-neutral`

새 UI는 위 클래스를 우선 재사용한다. 새 색이 필요하면 컴포넌트가 아니라 **토큰을 추가**한다.

## 4. 다크 / 시스템 테마

- 헤더 토글(`ThemeToggle`)로 **밝게 / 어둡게 / 시스템** 선택 → `localStorage.theme`. `system`은 OS 설정을
  추종(미디어쿼리 리스너).
- `html.dark` 클래스가 토큰을 다크 값으로 재정의한다(`darkMode: 'class'`). 모든 색이 토큰이라 **컴포넌트는
  다크 분기 코드가 없다**.
- 깜빡임(FOUC) 방지: `layout.tsx`의 인라인 스크립트가 페인트 전에 클래스를 적용. `<html suppressHydrationWarning>`.

## 5. 사용 규칙 (Do / Don't)

- **Do** — 색은 토큰으로만. 의미에 맞는 토큰 선택(중단=danger, 진행=info, 통과=success).
- **Do** — 그린(primary)과 블루(info)를 주연으로, 그레이는 절제해서.
- **Don't** — 컴포넌트에 hex/`text-[#...]` 박기(아바타 식별 칩 같은 예외는 주석으로 명시).
- **Don't** — 같은 의미에 다른 색 혼용(예: 같은 "검토 필요"를 어떤 곳은 주황, 어떤 곳은 빨강).
- **Don't** — 불필요한 그림자·그라데이션 남발(상호작용 어포던스에만 절제해 사용).
- 한국어 본문 가독성: 본문 14px 이상 권장. 11–12px는 메타/배지 등 밀도가 필요한 보조 정보에 한해.

## 6. 색을 바꾸려면

1. `src/app/globals.css`의 `:root`(라이트)와 `.dark`(다크) 토큰 값을 수정한다.
2. 새 의미색이 필요하면 토큰 추가 → `tailwind.config.ts` `colors`에 매핑 → (배지면) `seed-badge-*` 추가.
3. 컴포넌트는 건드리지 않는다. 이 문서의 표를 갱신한다.
