# 이름 정규화·매칭

이 문서는 추출된 사람 이름을 **정규화(normalize)** 하고, 서로 다른 출처에서 나온 이름들을
**보수적으로(conservatively) 매칭·중복제거(dedup)** 하는 규칙을 설명한다. 구현은 전부
[`src/lib/names.ts`](../src/lib/names.ts) 한 파일에 있으며, 파일명/폴더명에서 메타데이터를
뽑아내는 보조 로직은 [`src/lib/filename.ts`](../src/lib/filename.ts) 에 있다. 동작 예시는
[`tests/names.test.ts`](../tests/names.test.ts) 의 실제 케이스를 그대로 인용한다.

> 설계 원칙(코드 주석 §3.3 인용): **"merge only what is *certain*; when in doubt, keep separate
> so a human can decide."** — 즉, 자동 병합은 *확실한 것만* 한다. 애매하면 분리해 두고 사람이
> 판단한다. 스크립트(문자 체계)가 다르면 fuzzy-match 하지 않고, 성(surname)이라는 닻(anchor)이
> 없는 bare initial 끼리는 절대 병합하지 않는다.
>
> 이 모듈은 4단 파이프라인의 마지막 [Aggregate 단계](./pipeline.md)에서 후보들을 묶어 사람
> 엔티티(person)로 집계할 때 쓰인다. 데이터 모델상의 위치는 [data-model](./data-model.md) 을 참고하라.

전체 export 목록과 시그니처는 다음과 같다.

```ts
export type Script = 'korean' | 'han' | 'latin' | 'mixed' | 'unknown';

export function normalizeName(raw: string): string;
export function detectScript(name: string): Script;
export function nameKey(name: string): string;
export function namesMatch(a: string, b: string): boolean;
export function initialsForm(name: string): string | null;
export function nameCompleteness(name: string): number;
```

내부 헬퍼(`isInitialsToken`, `latinParts`, `capitalize`)와 인터페이스 `LatinParts` 는 export 되지
않는다. 다만 `latinParts` 의 결과 구조가 매칭 규칙 전체를 떠받치고 있으므로 아래에서 자세히 다룬다.

문자 클래스 정의(파일 상단의 정규식 상수)도 그대로 인용한다.

```ts
const HANGUL = /[가-힣]/;            // 한글 음절이 하나라도 있는지
const HANGUL_SYLLABLE = /^[가-힣]$/; // 토큰 전체가 한글 음절 '한 글자'인지
const HAN = /[一-鿿㐀-䶿]/;          // CJK 한자(기본 + 확장 A)
const LATIN = /[A-Za-z]/;           // 라틴 문자
```

---

## 1. `normalizeName` — 자간 정규화 · 도장 마커 제거 · 공백 정리

```ts
export function normalizeName(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  // Drop trailing certification markers like "(인)", "(서명)".
  s = s.replace(/\(\s*(?:인|서명|signature|seal)\s*\)/gi, '').trim();
  // 자간 정규화: "이 준 호" -> "이준호" (only when every token is a single Hangul syllable).
  const tokens = s.split(' ');
  if (tokens.length >= 2 && tokens.every((t) => HANGUL_SYLLABLE.test(t))) {
    s = tokens.join('');
  }
  return s.replace(/\s+/g, ' ').trim();
}
```

처리 순서는 다음 4단계다. 순서 자체가 의미를 가진다.

```
raw
 │  ① NFC 정규화 + 모든 공백을 단일 스페이스로 축약 + 양끝 trim
 ▼
"이 준 호 (인)"
 │  ② 인증 마커 제거: (인) | (서명) | (signature) | (seal)  ※ 대소문자 무시(i), 전역(g)
 ▼
"이 준 호"
 │  ③ 자간 정규화: 모든 토큰이 '한글 단음절'일 때만 토큰들을 공백 없이 join
 ▼
"이준호"
 │  ④ 마지막으로 한 번 더 공백 축약 + trim
 ▼
"이준호"
```

### ① 빈 문자열·공백 처리

`raw` 가 falsy(빈 문자열 등)면 곧장 `''` 을 반환한다. 그 외에는 유니코드 **NFC** 로 정규화하여
한글 자모 조합 형태를 합성 음절로 통일하고, 연속 공백(`\s+`)을 단일 스페이스로 축약한다.

### ② 도장/서명 마커 제거

문서에 "이준호 (인)", "홍길동 (서명)" 처럼 날인·서명 표기가 이름에 붙어 들어오는 경우가 잦다.
정규식 `/\(\s*(?:인|서명|signature|seal)\s*\)/gi` 로 괄호 안 마커를 통째로 제거한다. 괄호 안쪽
공백도 허용하며(`\s*`), `g` 플래그로 여러 번 등장해도 모두 지운다.

| 입력 | 출력 |
| --- | --- |
| `이준호 (인)` | `이준호` |
| `홍길동 (서명)` | `홍길동` |
| `John Carter (signature)` | `John Carter` |

이는 [`detectFlags`/`FLAG_TYPES`](./pipeline.md) 의 `seal`·`signature` 플래그와는 별개다.
플래그는 "이 이름은 도장/서명 출처라 검증이 필요하다"는 **메타 신호**로 남기고, `normalizeName`
은 그 표기 노이즈만 떼어 이름 본문을 깨끗이 만든다.

### ③ 자간(字間) 정규화 — 가장 미묘한 규칙

한국어 문서는 강조를 위해 이름 글자 사이를 띄우는 경우가 있다("이 준 호"). 이를 "이준호" 로
되돌려야 같은 사람으로 묶을 수 있다. **다만 성+이름이 띄어쓰기로 분리된 정상 표기까지 붙여서는
안 된다.** 그래서 규칙을 매우 좁게 건다:

> 공백으로 나눈 토큰이 **2개 이상**이고, **모든 토큰이 정확히 한글 단음절 한 글자**
> (`HANGUL_SYLLABLE = /^[가-힣]$/`) 일 때만 join 한다.

이 조건 덕분에:

| 입력 | 토큰 | 모두 단음절? | 결과 | 이유 |
| --- | --- | --- | --- | --- |
| `이 준 호` | `정`,`주`,`철` | ✅ | `이준호` | 전부 1글자 → 자간으로 판단, 붙임 |
| `이  준  호` | `정`,`주`,`철` | ✅ | `이준호` | ①에서 다중 공백이 단일 공백으로 이미 축약됨 |
| `김 철수` | `김`,`철수` | ❌ (`철수`는 2글자) | `김 철수` | 성+이름 정상 표기 → **그대로 유지** |

`tests/names.test.ts` 의 해당 케이스:

```ts
expect(normalizeName('이 준 호')).toBe('이준호');
expect(normalizeName('이  준  호')).toBe('이준호');
expect(normalizeName('김 철수')).toBe('김 철수');   // over-join 하지 않음
expect(normalizeName('이준호 (인)')).toBe('이준호'); // 마커 제거
expect(normalizeName('  John   D.  Carter ')).toBe('John D. Carter'); // 라틴은 공백만 정리
```

라틴 이름은 어떤 토큰도 한글 단음절이 아니므로 ③ 조건에 걸리지 않고, 공백만 정리되어
`"John D. Carter"` 처럼 토큰 사이 단일 스페이스가 유지된다.

---

## 2. `detectScript` — 문자 체계 판별

```ts
export function detectScript(name: string): Script {
  const hasKo = HANGUL.test(name);
  const hasHan = HAN.test(name);
  const hasLatin = LATIN.test(name);
  const count = [hasKo, hasHan, hasLatin].filter(Boolean).length;
  if (count === 0) return 'unknown';
  if (count > 1) return 'mixed';
  if (hasKo) return 'korean';
  if (hasHan) return 'han';
  return 'latin';
}
```

세 가지 문자 클래스(한글/한자/라틴)의 존재 여부를 독립적으로 검사한 뒤, **몇 종류가 섞였는지**
세어 판정한다.

```
count = (한글있음?) + (한자있음?) + (라틴있음?)

count == 0  ────────────────► 'unknown'   (숫자·기호만 등)
count >  1  ────────────────► 'mixed'     (예: "John 정")
count == 1 ┬ 한글이면 ──────► 'korean'
           ├ 한자이면 ──────► 'han'
           └ 그 외(라틴) ──► 'latin'
```

`Script` 타입의 5개 값 전부 — `'korean' | 'han' | 'latin' | 'mixed' | 'unknown'` — 가 위 분기로
빠짐없이 커버된다. 테스트:

```ts
expect(detectScript('이준호')).toBe('korean');
expect(detectScript('John Carter')).toBe('latin');
expect(detectScript('鄭周哲')).toBe('han');
expect(detectScript('John 정')).toBe('mixed');
```

스크립트 판별은 매칭의 첫 관문이다. `namesMatch` 는 **같은 스크립트끼리만** 비교하므로(§5),
`mixed`·`unknown` 으로 분류된 이름은 정확 일치(exact equality)가 아닌 한 자동 병합되지 않는다.

---

## 3. `latinParts` — 라틴 이름 분해

라틴(영문) 이름은 어순·이니셜·콤마형 등 변형이 많아 별도의 파서가 필요하다. 내부 함수
`latinParts` 가 이름을 다음 구조로 분해한다.

```ts
interface LatinParts {
  firstInitial: string | null;       // 첫 given 토큰의 첫 글자(대문자), 예: "G"
  surname: string | null;            // 성. 신뢰할 수 없으면 null
  given: string[];                   // given-name 토큰 배열
  firstGiven: string | null;         // 첫 번째 given 토큰 원문, 예: "John" 또는 "G."
  firstGivenIsInitial: boolean;      // firstGiven 이 이니셜뿐인가? ("G", "G.", "CK")
}
```

### 3.1 이니셜 토큰 판정 — `isInitialsToken`

```ts
function isInitialsToken(t: string): boolean {
  const letters = t.replace(/\./g, '');
  return (
    letters.length >= 1 &&
    letters.length <= 3 &&
    /^[A-Za-z]+$/.test(letters) &&
    letters === letters.toUpperCase()
  );
}
```

점(`.`)을 무시한 뒤, **1~3글자이고 전부 라틴 알파벳이며 전부 대문자**이면 이니셜 토큰으로 본다.

| 토큰 | letters | 판정 | 비고 |
| --- | --- | --- | --- |
| `G` | `G` | ✅ | 단일 이니셜 |
| `G.` | `G` | ✅ | 점 무시 |
| `CK` | `CK` | ✅ | 2글자 복합 이니셜 |
| `G.D.` | `GD` | ✅ | 점 여러 개 무시 (2글자) |
| `John` | `John` | ❌ | 소문자 포함 → 풀네임 |
| `WHO` | `WHO` | ✅ | 규칙상 이니셜로 간주(전부 대문자·3글자) |

마지막 행은 의도적 보수성의 단면이다. 전부 대문자인 짧은 토큰은 이니셜로 간주되므로,
풀네임을 다 대문자로 쓴 경우 이니셜처럼 취급될 수 있다. 이는 "확실하지 않으면 병합하지 않는"
방향으로 안전하게 기운다.

### 3.2 분해 알고리즘

```
normalizeName(name)
   │
   ├─ 콤마 포함? ──► "Surname, Given M." 어순
   │      surname = 콤마 앞부분
   │      given   = 콤마 뒷부분을 공백 분리
   │
   └─ 콤마 없음 → 공백으로 토큰 분리
          ├ 토큰 0개 → 전부 null/빈 배열
          ├ 토큰 1개
          │     ├ 이니셜 토큰? → surname=null, given=[그 토큰], firstGivenIsInitial=true
          │     └ 아니면      → surname=그 토큰, given=[]  (성만 있고 닻 없음)
          └ 토큰 2개+
                ├ 마지막 토큰이 이니셜? → surname=null, given=전체  (trailing initials → 성 신뢰 불가)
                └ 아니면               → surname=마지막, given=앞부분 전부
```

분해가 끝나면 `firstGiven` 은 `given` 중 라틴 문자를 포함하는 첫 토큰, `firstInitial` 은
`firstGiven` 에서 점을 뗀 첫 글자를 대문자화한 값으로 계산한다.

```ts
const firstGiven = given.find((t) => LATIN.test(t)) ?? null;
const firstInitial = firstGiven ? firstGiven.replace(/\./g, '')[0].toUpperCase() : null;
```

### 3.3 분해 예시

| 입력 | surname | given | firstGiven | firstInitial | firstGivenIsInitial |
| --- | --- | --- | --- | --- | --- |
| `John D. Carter` | `Carter` | `[John, D.]` | `John` | `G` | false |
| `J Carter` | `Carter` | `[G]` | `G` | `G` | true |
| `J. Carter` | `Carter` | `[G.]` | `G.` | `G` | true |
| `Gildong Hong` | `Hong` | `[Gildong]` | `Gildong` | `S` | false |
| `CK Kim` | `Kim` | `[CK]` | `CK` | `C` | true |
| `Carter, John D.` | `Carter` | `[John, D.]` | `John` | `G` | false |
| `J C` | `null` | `[G, N]` | `G` | `G` | true |
| `Carter` | `Carter` | `[]` | `null` | `null` | false |

마지막 두 행이 핵심이다.

- `J C` — 마지막 토큰 `N` 이 이니셜이라 **성을 신뢰할 수 없다**(`surname=null`). 그래서 `J C` 은
  닻 없는 bare initials 로 분류되어 누구와도 자동 병합되지 않는다(§5 참조).
- `Carter` — 단일 풀네임 토큰은 **성으로만** 잡힌다(`firstGiven=null`, `firstInitial=null`).
  given 닻이 없으므로 다른 풀네임과 자동 병합되지 않는다.

---

## 4. `nameKey` — 중복제거(dedup) 키

```ts
export function nameKey(name: string): string {
  const norm = normalizeName(name);
  const script = detectScript(norm);
  if (script === 'korean' || script === 'han') {
    return `${script}:${norm.replace(/\s+/g, '')}`;
  }
  if (script === 'latin') {
    const p = latinParts(norm);
    if (p.surname && p.firstInitial) {
      return `latin:${p.firstInitial.toLowerCase()} ${p.surname.toLowerCase()}`;
    }
    return `latin-raw:${norm.toLowerCase()}`;
  }
  return `raw:${norm.toLowerCase()}`;
}
```

`nameKey` 는 **빠른 버킷팅(bucketing)** 용 키다. 키가 같은 이름들은 *병합 후보*이며, 실제 병합
여부는 §5 의 `namesMatch` 가 최종 확정한다. 즉 같은 키 != 같은 사람. 키는 같은 사람을 같은
버킷에 모으되, fail-safe 하게(오버머지 방지) 동작한다.

키 생성 규칙(스크립트별 prefix가 충돌을 막는다):

| 스크립트 | 키 형식 | 예시 입력 → 키 |
| --- | --- | --- |
| korean | `korean:<공백제거 norm>` | `이 준 호` → `korean:이준호` |
| han | `han:<공백제거 norm>` | `鄭周哲` → `han:鄭周哲` |
| latin (성+이니셜 도출 가능) | `latin:<firstInitial소문자> <surname소문자>` | `John D. Carter` → `latin:g newman` |
| latin (성/이니셜 불가) | `latin-raw:<norm소문자>` | `J C` → `latin-raw:g n` |
| mixed/unknown | `raw:<norm소문자>` | `John 정` → `raw:galen 정` |

핵심 성질: **풀네임과 그 이니셜 폼이 동일한 키**를 갖는다.

```ts
expect(nameKey('John D. Carter')).toBe(nameKey('J Carter'));
// 둘 다 → "latin:g newman"
```

`latin:` 키는 *성+첫이니셜*만 쓰므로 `John Carter` 과 `Gary Carter` 도 같은 키(`latin:g newman`)에
들어간다. 이는 의도된 동작이다 — 키는 후보를 모으는 단계이고, 실제로 둘이 다른 사람임을
가려내는 일은 `namesMatch` 가 한다(§5의 진리표에서 `John Carter` ↔ `Gary Carter` = false).

---

## 5. `namesMatch` — 보수적 매칭 규칙

```ts
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const sa = detectScript(na);
  const sb = detectScript(nb);
  if (sa !== sb) return false;                       // (R1) 교차 스크립트 불가

  if (sa === 'korean' || sa === 'han') {
    return na.replace(/\s+/g, '') === nb.replace(/\s+/g, ''); // (R2) 한글/한자: 공백제거 완전일치
  }

  if (sa === 'latin') {
    if (na.toLowerCase() === nb.toLowerCase()) return true;   // (R3) 대소문자 무시 완전일치
    const pa = latinParts(na);
    const pb = latinParts(nb);
    if (
      pa.surname && pb.surname &&
      pa.firstInitial && pb.firstInitial &&
      pa.surname.toLowerCase() === pb.surname.toLowerCase() &&
      pa.firstInitial.toLowerCase() === pb.firstInitial.toLowerCase()
    ) {
      // (R4) 같은 성 + 같은 첫 이니셜
      const aFull = pa.firstGiven && !pa.firstGivenIsInitial;
      const bFull = pb.firstGiven && !pb.firstGivenIsInitial;
      if (aFull && bFull) {
        // (R5) 양쪽 다 풀 given → 그 given 까지 같아야 매칭
        return pa.firstGiven!.toLowerCase() === pb.firstGiven!.toLowerCase();
      }
      return true; // 한쪽이라도 이니셜 폼이면 풀네임↔이니셜로 병합
    }
    return false;
  }

  return false; // mixed/unknown: 위에서 처리된 완전일치 외에는 매칭 안 함
}
```

### 매칭 결정 흐름

```
입력 a, b
  │ normalize 후 빈 문자열? ──► false
  │ 정규화 후 완전 동일?    ──► true   (스크립트 무관, 자간정규화/마커제거 효과 포함)
  │
  │ 스크립트 다름?          ──► false  (R1)
  │
  ├ korean/han ─► 공백 제거 후 글자열 일치? ─► true / false   (R2)
  │
  └ latin
       │ 소문자화 완전일치? ──► true                           (R3)
       │ 같은 성 + 같은 첫 이니셜?
       │      ├ 둘 다 풀 given → firstGiven 까지 같으면 true   (R5)
       │      └ 한쪽이 이니셜  → true (풀네임 ↔ 이니셜 병합)   (R4)
       └ 그 외 ──► false   (성·이니셜 닻 부족 시 항상 false)
```

규칙 요약:

- **(R1) 같은 스크립트만.** 교차 스크립트는 정확 일치가 아닌 한 절대 매칭하지 않는다.
- **(R2) 한글/한자는 정규화 완전 일치.** 공백만 제거하고 글자열이 같아야 한다. fuzzy 없음.
- **(R3) 라틴 완전 일치**(대소문자 무시)는 항상 매칭.
- **(R4) 라틴 부분 일치는 "같은 성 + 같은 첫 이니셜"** 일 때만, 그리고 한쪽이 이니셜 폼일 때
  풀네임 ↔ 이니셜로 병합한다.
- **(R5) 서로 다른 풀 given 은 분리.** 양쪽 다 풀네임이면 given 까지 같아야 한다
  (`John Carter` ↔ `Gary Carter` 은 분리).
- **bare initials(성 닻 없음)는 불가.** `surname` 이 null 이면 R4 조건이 무너져 false.

### 진리표 (tests/names.test.ts 실제 케이스)

| a | b | 결과 | 적용 규칙 / 이유 |
| --- | --- | :---: | --- |
| `John D. Carter` | `J Carter` | **true** | R4 — 같은 성 Carter, 같은 이니셜 G, b가 이니셜 폼 |
| `Gildong Hong` | `G Hong` | **true** | R4 — 같은 성 Hong, 같은 이니셜 S |
| `CK Kim` | `Chang Kim` | **true** | R4 — 같은 성 Kim, 이니셜 C(=CK의 첫 글자) = C(hang) |
| `이 준 호` | `이준호` | **true** | 자간정규화 후 R2 완전일치 |
| `John Carter` | `J. Carter` | **true** | R4 — 풀네임 ↔ 자기 이니셜 폼 |
| `John Carter` | `John Lee` | **false** | R4 실패 — 성이 다름(Carter ≠ Lee) |
| `John Carter` | `Gary Carter` | **false** | R5 — 둘 다 풀 given, John ≠ Gary |
| `John D. Carter` | `Gregory Carter` | **false** | R5 — 둘 다 풀 given, John ≠ Gregory |
| `G Hong` | `G Hong` | **false** | R4 실패 — 같은 성이나 이니셜 다름(S ≠ G) |
| `이준호` | `Junho Lee` | **false** | R1 — 교차 스크립트(korean vs latin) |
| `J C` | `John Carter` | **false** | bare initials — `J C` 은 surname=null (닻 없음) |

`CK Kim` ↔ `Chang Kim` = true 가 흥미롭다. `CK` 는 이니셜 토큰이라 `firstGivenIsInitial=true`,
`firstInitial='C'`. `Chang` 은 풀 given 으로 `firstInitial='C'`. 한쪽(`CK Kim`)이 이니셜 폼이므로
R5(둘 다 풀네임) 분기에 빠지지 않고 R4 의 `return true` 로 병합된다. 두 번째 글자 `K` 는
비교에 쓰이지 않는다 — 매칭은 **첫 이니셜**만 본다.

반대로 `J C` ↔ `John Carter` = false 인 이유는 §3.2 에서 본 대로 `J C` 의 마지막 토큰 `N` 이
이니셜이라 `latinParts('J C').surname === null` 이 되고, R4 의 `pa.surname && pb.surname` 조건이
무너지기 때문이다. 성이라는 닻이 없으면 매칭 불가 — 이것이 "bare initials 불가" 규칙의 구현이다.

---

## 6. `initialsForm` 과 `nameCompleteness` — canonical 선택

집계 단계에서는 같은 사람으로 묶인 후보들 중 **대표 표기(canonical)** 를 하나 골라야 한다.
이를 위해 두 헬퍼가 쓰인다.

### 6.1 `initialsForm` — 짧은 이니셜 폼 도출

```ts
export function initialsForm(name: string): string | null {
  const p = latinParts(name);
  if (p.firstInitial && p.surname) return `${p.firstInitial} ${capitalize(p.surname)}`;
  return null;
}
```

성과 첫 이니셜을 모두 도출할 수 있을 때만 `"J Carter"` 형태를 만든다. 둘 중 하나라도 없으면
(예: 한글 이름, 닻 없는 bare initials) `null`.

```ts
expect(initialsForm('John D. Carter')).toBe('J Carter');
```

### 6.2 `nameCompleteness` — 완전성 점수

```ts
export function nameCompleteness(name: string): number {
  const norm = normalizeName(name);
  const script = detectScript(norm);
  if (script === 'korean' || script === 'han') return norm.replace(/\s+/g, '').length >= 2 ? 3 : 1;
  if (script === 'latin') {
    const p = latinParts(norm);
    const hasFullGiven = p.given.some((t) => !isInitialsToken(t) && /[a-z]/.test(t));
    if (p.surname && hasFullGiven) return 3;
    if (p.surname) return 2;
    return 1;
  }
  return 1;
}
```

`3 = full`, `2 = surname+initial`, `1 = ambiguous` 의 세 등급으로 점수를 매긴다. 집계 시 이
점수가 가장 높은 표기를 canonical 로 채택하면 된다(동점일 때의 tie-break 정책은 호출부의 몫).

| 입력 | 스크립트 | 점수 | 근거 |
| --- | --- | :---: | --- |
| `John Carter` | latin | 3 | 성 Carter + 풀 given John |
| `이준호` | korean | 3 | 공백 제거 길이 ≥ 2 |
| `J Carter` | latin | 2 | 성 Carter 있으나 given 이 이니셜뿐 |
| `Carter` | latin | 2 | 성만 있음 |
| `J C` | latin | 1 | 성 null(닻 없음) → ambiguous |
| `정` | korean | 1 | 길이 1 |
| `John 정` | mixed | 1 | 기본값 |

테스트가 보장하는 핵심 부등식:

```ts
expect(nameCompleteness('John Carter')).toBeGreaterThan(nameCompleteness('J Carter'));
// 3 > 2
```

즉 같은 사람으로 병합된 `John Carter`(3)과 `J Carter`(2) 사이에서는 풀네임이 canonical 로
선택된다. 한국어 풀이름(`이준호`, 3)과 단일 글자(`정`, 1)도 마찬가지로 더 완전한 쪽이 이긴다.

---

## 7. `filename.ts` — 파일명·폴더명 파싱

이름 모듈과 짝을 이루는 보조 모듈. 응시자 폴더와 문서 파일의 명명 규약에서 메타데이터를 뽑아낸다.
명명 규약(코드 주석 §2 인용):

```
응시자 폴더 = "<id> (<name>)"
문서 파일   = "<id>_[<tag>]_<title>"
```

> `[tag]` 만으로 문서 유형(doc-type)을 ~100% 결정할 수 있으며 이는 PDF/PNG 등 **형식과 무관**하다.
> (형식 차이는 1단 Ingest 에만, 문서 유형 차이는 3단 Extract 에만 작용한다 — [pipeline](./pipeline.md) 참조.)

### 7.1 `parseFilename` — 파일명 분해

```ts
export interface ParsedFilename {
  applicantId: string | null;
  tag: string | null;          // 대괄호 태그 원문, 예: "학위논문" (없으면 null)
  title: string | null;
  degree: 'master' | 'doctoral' | null;
  language: 'ko' | 'en' | null;
  base: string;                // 확장자 제거한 파일명
}

export function parseFilename(filename: string): ParsedFilename;
```

처리 단계:

1. 경로 구분자(`/` 또는 `\`)로 잘라 **파일명만** 취하고(`justName`), 확장자(`.[^.]+$`)를 제거해 `base` 를 만든다.
2. 핵심 정규식으로 `<id>_[<tag>]_<title>` 을 분해한다:

   ```ts
   const m = /^([^_]+)_(?:\[([^\]]+)\]_?)?(.*)$/.exec(base);
   ```

   - 그룹 1 `([^_]+)` → `applicantId`
   - 그룹 2 `\[([^\]]+)\]` (선택적) → `tag` (대괄호 안 원문)
   - 그룹 3 `(.*)` → `title`
   - 매치 실패 시 `base` 전체를 `title` 로 둔다.
3. `degree` 추론: `/박사|doctoral|ph\.?\s?d/i` → `'doctoral'`, 아니면 `/석사|master/i` → `'master'`, 아니면 `null`.
4. `language` 추론: `/영문|english/i` → `'en'`, 아니면 `/국문|korean/i` → `'ko'`, 아니면 `null`.

degree/language 정규식은 `base` 전체를 대상으로 하므로 태그뿐 아니라 제목에 들어간 단서도 잡는다.

| 파일명 | applicantId | tag | title | degree | language |
| --- | --- | --- | --- | --- | --- |
| `2401-000001_[학위논문]_박사학위_영문.pdf` | `2401-000001` | `학위논문` | `박사학위_영문` | `doctoral` | `en` |
| `2401-000001_[대표연구]_journal.png` | `2401-000001` | `대표연구` | `journal` | `null` | `null` |
| `report_master_국문.pdf` | `report` | `null` | `master_국문` | `master` | `ko` |
| `randomfile` | `randomfile` | `null` | `null`* | `null` | `null` |

\* `randomfile` 처럼 언더스코어가 없는 경우, 정규식 그룹 1이 전체를 먹고 `title` 은 빈 문자열이
되어 `null` 로 떨어진다(`m[3]?.trim() || null`). `tag` 은 문서 유형 분류의 1차 단서로,
[Extract 단계](./pipeline.md) 가 이를 `DOC_TYPES`(`degree_thesis | representative_research |
journal_article | hindex | unknown`) 중 하나로 매핑한다.

### 7.2 `parseApplicantFolder` — 응시자 폴더 분해

```ts
export interface ParsedFolder {
  applicantId: string | null;
  applicantName: string | null;
}

/** "2401-000001 (홍길동)" -> { applicantId: "2401-000001", applicantName: "홍길동" } */
export function parseApplicantFolder(folderName: string): ParsedFolder;
```

정규식 `/^(.*?)\s*\(([^)]+)\)\s*$/` 으로 `"<id> (<name>)"` 형식을 분해한다. 괄호 그룹이 매치되면
앞부분을 `applicantId`, 괄호 안을 `applicantName` 으로 잡고, 매치 실패 시 전체를 `applicantId`
로 두고 `applicantName=null`.

| 폴더명 | applicantId | applicantName |
| --- | --- | --- |
| `2401-000001 (홍길동)` | `2401-000001` | `홍길동` |
| `2401-000001(홍길동)` | `2401-000001` | `홍길동` (앞 공백 `\s*` 선택적) |
| `2401-000099` | `2401-000099` | `null` (괄호 없음) |

여기서 추출한 `applicantName` 은 응시자 본인의 이름이며, 본문에서 추출한 관계자 이름들과는
구분된다. 집계 단계에서 이 이름 역시 `normalizeName`/`namesMatch` 를 거쳐 정규화·대조된다.

---

## 8. 다른 문서와의 연결

- [pipeline.md](./pipeline.md) — 4단 파이프라인(Ingest→Type→Extract→Aggregate). 이 모듈은 마지막
  Aggregate 단계에서 후보 병합에 쓰인다. `tag` → `DOC_TYPES` 매핑, `FLAG_TYPES`(seal/signature 등)도 참조.
- [pipeline.md (Stage 4 Aggregate)](./pipeline.md) — `nameKey` 버킷팅 → `namesMatch` 확정 →
  `nameCompleteness` 기반 canonical 선택의 실제 호출 흐름.
- [data-model.md](./data-model.md) — 정규화된 이름과 키가 저장되는 컬럼/테이블 구조.

> 마지막으로 다시 한번: **자동 추출·정규화·매칭은 모두 "초안"이며 최종 판단은 사람**이다.
> 이 모듈은 의심스러우면 병합하지 않고 분리해 두는 방향으로 일관되게 설계되어 있다.
> 절대 이름을 지어내지 않으며, 닻(성) 없는 이니셜은 묶지 않는다.
