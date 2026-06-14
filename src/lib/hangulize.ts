/**
 * 로마자 표기 한국 이름 → 한글 이름 추정 (advisory).
 *
 * 영문 논문 공저자("Minsu Kim", "Kim, Ji-young")를 한글 심사위원 풀과 수기 대조할 때 보조용으로
 * "한글 추정"을 병기한다. 원칙: 절대 이름을 지어내지 않는다 — 추정은 항상 참고 표시로만 쓰이고,
 * 확신이 없으면 null을 반환해 아예 병기하지 않는다(정밀도 우선, 누락 허용).
 *
 * 이중 게이트(중국·일본·서양 이름 오변환 차단):
 *  1) 성씨 게이트 — 성 토큰이 한국 성씨 로마자 표기표에 있어야만 진행. 중국·일본 전용 표기
 *     (li, wang, wu, zhang, tanaka …)는 표에 없으므로 여기서 끝난다.
 *  2) 음절 게이트 — 이름(given) 부분이 한국 이름 음절표로 1~3음절로 **완전** 분절돼야 변환.
 *     "Zhihao"(zh-), "Xiaoming"(x-)처럼 비한국 음절이 섞이면 분절이 실패해 null.
 */

/** 한국 성씨 로마자 표기 → 한글. 중국·베트남 전용 표기(li/wang/wu 등)는 의도적으로 제외. */
const SURNAMES: Record<string, string> = {
  kim: '김', gim: '김',
  lee: '이', yi: '이', rhee: '이', rhie: '이', ri: '이',
  park: '박', pak: '박', bak: '박',
  choi: '최', choe: '최',
  jung: '정', jeong: '정', chung: '정', joung: '정', cheong: '정',
  kang: '강', gang: '강',
  cho: '조', jo: '조',
  yoon: '윤', yun: '윤', youn: '윤',
  jang: '장', chang: '장',
  lim: '임', im: '임', yim: '임',
  han: '한',
  oh: '오',
  seo: '서', suh: '서', sur: '서',
  shin: '신', sin: '신',
  kwon: '권', gwon: '권', kweon: '권',
  hwang: '황', whang: '황',
  ahn: '안', an: '안',
  song: '송',
  yoo: '유', yu: '유', you: '유',
  ryu: '류', ryoo: '류', lyu: '류',
  hong: '홍',
  moon: '문', mun: '문',
  yang: '양',
  bae: '배', pae: '배',
  baek: '백', paik: '백', back: '백', baik: '백',
  heo: '허', hur: '허', huh: '허',
  nam: '남',
  noh: '노', no: '노', roh: '노', ro: '노',
  ha: '하',
  kwak: '곽', gwak: '곽', kwack: '곽',
  sung: '성', seong: '성',
  cha: '차',
  joo: '주', ju: '주',
  woo: '우',
  koo: '구', goo: '구', ku: '구', gu: '구',
  min: '민',
  yeom: '염', yum: '염', youm: '염',
  byun: '변', byeon: '변', byon: '변',
  pyo: '표',
  seol: '설', sul: '설',
  bang: '방',
  jeon: '전', jun: '전', chun: '전',
  cheon: '천',
  son: '손', sohn: '손',
  ko: '고', koh: '고', go: '고',
  do: '도', doh: '도',
  hyun: '현', hyeon: '현',
  uhm: '엄', um: '엄', eom: '엄',
  jin: '진',
  ji: '지',
  won: '원',
  na: '나',
  ra: '라',
  maeng: '맹',
  gil: '길', kil: '길',
  yeo: '여',
  bong: '봉',
  geum: '금', keum: '금',
  tak: '탁',
  ma: '마',
  pi: '피',
  chu: '추',
  ok: '옥',
  seok: '석', suk: '석',
  hyung: '형',
  in: '인',
  ka: '가',
  myung: '명', myeong: '명',
  pyeon: '편', pyun: '편',
  hahn: '한',
  shim: '심', sim: '심',
  chae: '채',
  kook: '국', gook: '국',
  ban: '반',
  so: '소',
  wi: '위',
  ye: '예',
  jee: '지',
  bu: '부', boo: '부',
  myo: '묘',
  // ho('호')는 의도적 제외 — 극희소 한국 성씨인데 광둥 何·베트남 Hồ의 표준 표기라 오변환 위험이 압도적.
  kam: '감', gam: '감',
  bahk: '박', chey: '최', jong: '정', chon: '전', rhyu: '류', goh: '고', paek: '백',
  rho: '노', surh: '서', rim: '임', kong: '공', gong: '공', ham: '함', hahm: '함',
  choo: '추', soh: '소', yook: '육', yuk: '육',
  namgung: '남궁', namkoong: '남궁', namgoong: '남궁',
};

/** 한국인 이름(given) 음절 로마자 표기 → 한글 음절. 비한국 음절(zh-, x-, -ao, shi …)은 제외. */
const SYLLABLES: Record<string, string> = {
  a: '아', ah: '아', ae: '애', an: '안',
  bae: '배', beom: '범', bum: '범', bin: '빈', been: '빈', bit: '빛', bo: '보', bok: '복',
  bong: '봉', boo: '부', bu: '부', byeol: '별', byul: '별', byeong: '병', byung: '병',
  chae: '채', chan: '찬', chang: '창', cheol: '철', chul: '철', cheon: '천', cheong: '청',
  cho: '초', choon: '춘', chun: '춘',
  da: '다', dae: '대', dal: '달', dan: '단', deok: '덕', duk: '덕', do: '도', dong: '동',
  doo: '두', du: '두',
  eon: '언', eun: '은', eum: '음',
  ga: '가', gang: '강', kang: '강', geon: '건', gun: '건', kun: '건', geum: '금', keum: '금',
  gi: '기', ki: '기', gil: '길', kil: '길', go: '고', ko: '고', gon: '곤', guk: '국',
  gook: '국', kook: '국', gwan: '관', kwan: '관', gwang: '광', kwang: '광',
  gyeong: '경', kyung: '경', kyoung: '경', kyeong: '경', gyung: '경', gyu: '규', kyu: '규',
  ha: '하', hae: '해', hak: '학', han: '한', hang: '항', hee: '희', hui: '희', heui: '희',
  ho: '호', hoon: '훈', hun: '훈', hong: '홍', hwa: '화', hwan: '환', hwang: '황',
  hyang: '향', hye: '혜', hyo: '효', hyeon: '현', hyun: '현', hyeok: '혁', hyuk: '혁',
  hyeong: '형', hyung: '형',
  il: '일', in: '인',
  ja: '자', jae: '재', jang: '장', je: '제', jeong: '정', jung: '정', ji: '지', jin: '진',
  jo: '조', jong: '종', joo: '주', ju: '주', joon: '준', jun: '준',
  kyo: '교',
  man: '만', mee: '미', mi: '미', min: '민', mo: '모', mok: '목', moo: '무', mu: '무',
  mun: '문', moon: '문', myeong: '명', myung: '명',
  na: '나', nam: '남', nan: '난', neul: '늘',
  o: '오', oh: '오', ok: '옥',
  ra: '라', rae: '래', ram: '람', ran: '란', rim: '림', rin: '린',
  sae: '새', sang: '상', se: '세', seul: '슬', seo: '서', suh: '서', seok: '석', suk: '석',
  sook: '숙', seon: '선', sun: '선', seong: '성', sung: '성', si: '시', sik: '식',
  shik: '식', shin: '신', sin: '신', so: '소', sol: '솔', song: '송', soo: '수', su: '수',
  tae: '태', taek: '택',
  u: '우', uk: '욱', wook: '욱', woon: '운', wan: '완', won: '원', woo: '우',
  ye: '예', yeo: '여', yeol: '열', yul: '율', yeon: '연', youn: '연', yun: '윤',
  yeong: '영', young: '영', yong: '용', yu: '유', yoo: '유',
  ahn: '안', baek: '백', bom: '봄', bi: '비', byoung: '병',
  chol: '철', chin: '진', chong: '정', chung: '정', choong: '중',
  eui: '의', geun: '근', keun: '근', gyeol: '결', gyun: '균', kyun: '균',
  gwon: '권', kwon: '권', heon: '헌', heung: '흥', hi: '희', hu: '후', hoo: '후',
  wha: '화', whan: '환', hwi: '휘', hyon: '현', hyoung: '형',
  // jay('재')·june('준')은 의도적 제외 — 영어 이름 Jay/June 자체가 키가 되어 비한국계가 변환된다.
  i: '이', ik: '익', im: '임', joong: '중',
  kee: '기', kuk: '국', la: '라', myoung: '명', nu: '누', on: '온',
  phil: '필', pil: '필', reum: '름', rum: '름', ri: '리', rom: '롬',
  sok: '석', soon: '순', seung: '승', seop: '섭', sub: '섭', sup: '섭',
  un: '운', ung: '웅', woong: '웅', yon: '연', yung: '영',
};

/** 음절 로마자 표기의 최대 길이("kyoung", "hyeong" = 6). DP 탐색 범위 제한용. */
const MAX_SYLLABLE_ROM = 6;

/**
 * 알려진 편향: 다중 후보 표기는 더 흔한 쪽 하나만 매핑한다 — un=운(MR식 은ŭn 아님),
 * jong=종(북한식 정 아님), 성씨 chun=전(천 아님). '약간 다른 한글' 추정이 나올 수 있으나
 * 참고 병기 목적상 허용한다.
 *
 * 중국(핀인·웨이드-자일스)·일본·광둥 표기와 정면 충돌하는 성씨 — 이 성씨로 시작하는 이름은
 * 아래 추가 게이트(2음절 이상 + 외국 빈출 이름 차단)를 거친다.
 * 예: Kang Hui(康辉)→강희, Ma Yun(马云)→마윤, Jin Yong(金庸)→진용 류의 오변환 차단.
 */
const COLLISION_SURNAMES = new Set([
  'han', 'hahn', 'kang', 'gang', 'chang', 'jin', 'min', 'yang', 'song', 'ma',
  'chu', 'choo', 'an', 'gu', 'ku', 'koo', 'goo', 'ko', 'koh', 'go', 'goh', 'oh',
]);

/** 충돌 성씨와 결합 시 차단하는 서양·일본 빈출 given — 음절 분절을 통과하는 것들만 등재. */
const FOREIGN_GIVEN = new Set(['anna', 'hanna', 'mia', 'hana', 'dana', 'juan', 'yuki', 'yuri']);

/**
 * 로마자 조각을 음절표로 완전 분절한다(최소 음절 수 우선). 분절 불가면 null.
 * 비한국 음절이 하나라도 섞이면 전체가 실패한다 — 이것이 음절 게이트다.
 */
function segmentSyllables(part: string): string[] | null {
  const n = part.length;
  if (n === 0) return null;
  // best[i] = part.slice(0, i)의 최소 음절 분절
  const best: Array<string[] | null> = Array.from({ length: n + 1 }, () => null);
  best[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - MAX_SYLLABLE_ROM); j < i; j++) {
      const prev = best[j];
      if (!prev) continue;
      const hangul = SYLLABLES[part.slice(j, i)];
      if (!hangul) continue;
      if (!best[i] || prev.length + 1 < best[i]!.length) best[i] = [...prev, hangul];
    }
  }
  return best[n];
}

/** 이름(given) 토큰들 → 한글. 하이픈은 추가 분리. 총 1~3음절로 완전 분절돼야 한다. */
function givenToHangul(tokens: string[]): string | null {
  const parts = tokens
    .flatMap((t) => t.split('-'))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: string[] = [];
  for (const p of parts) {
    if (!/^[a-z]+$/.test(p)) return null;
    const seg = segmentSyllables(p);
    if (!seg) return null;
    out.push(...seg);
  }
  // 동일 음절 중첩(단단·링링 류)은 핀인 이름의 전형 — 한국 이름엔 거의 없으므로 포기한다.
  if (out.length === 2 && out[0] === out[1]) return null;
  return out.length >= 1 && out.length <= 3 ? out.join('') : null;
}

/** 한 어순 해석(성 토큰 + 이름 토큰들)을 끝까지 변환해 본다. 어느 게이트든 실패하면 null. */
function tryConvert(surnameTok: string, givenToks: string[]): string | null {
  if (!surnameTok || givenToks.length === 0) return null;

  // 한 글자 토큰은 이니셜로 간주("Kim, J"). 하이픈 결합 한 글자("Ji-a"의 a)는 허용된다.
  if (givenToks.some((t) => t.replace(/-/g, '').length < 2)) return null;

  const surname = SURNAMES[surnameTok.toLowerCase()];
  if (!surname) return null; // 성씨 게이트 — 한국 성씨가 아니면 변환 포기

  const given = givenToHangul(givenToks);
  if (!given) return null; // 음절 게이트 — 한국 이름 음절로 완전 분절돼야 한다

  return surname + given;
}

/**
 * 3차 정밀도 게이트 — 충돌 성씨(중국·일본·광둥 표기와 겹침)는 더 엄격한 조건을 요구한다.
 * 한글 음절은 글자당 1음절이므로 given 음절 수 = 결과 길이 - 성씨 길이.
 */
function passesPrecisionGates(surnameTok: string, givenToks: string[], result: string): boolean {
  const sur = surnameTok.toLowerCase();
  if (!COLLISION_SURNAMES.has(sur)) return true;
  // 1음절 given은 핀인 단음절 이름(Hui·Yun·Yong·Mi…)과 구분 불가 → 포기.
  if (result.length - SURNAMES[sur].length < 2) return false;
  const flatGiven = givenToks.flatMap((t) => t.split('-')).join('').toLowerCase();
  if (FOREIGN_GIVEN.has(flatGiven)) return false; // Juan Ko, Anna Chang, Yuki Oh 류
  return true;
}

/**
 * 로마자 표기 이름의 한글 추정. 추정 불가(비한국 이름·이니셜·이미 한글 등)면 null.
 *
 * 지원 형식: "Kim, Minsu"(쉼표 = 성 우선), "Minsu Kim"(서양 어순), "Kim Min-su"(한국 어순),
 * "KIM MINSU", "Park Ji Sung"(3토큰).
 *
 * 어순 판별(정밀도 우선): 서양 어순(마지막 토큰 = 성)과 한국 어순(첫 토큰 = 성)을 둘 다
 * 시도해, 한쪽만 성립하면 그것을 쓰고 **둘 다 성립하는데 결과가 다르면 모호하므로 포기**한다
 * ("Kang Min"이 민강/강민 중 하나로 침묵 변환되는 것을 막는다 — 핀인 "Han Hong" 류도 함께
 * 차단된다). 마지막으로 충돌 성씨 게이트(passesPrecisionGates)를 통과해야 한다.
 */
export function estimateKoreanName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/[가-힣]/.test(trimmed)) return null; // 이미 한글 — 병기 불필요
  if (!/^[A-Za-z][A-Za-z ,'-]*$/.test(trimmed)) return null; // 비라틴 문자·마침표(이니셜) 거부

  const comma = trimmed.split(',');
  if (comma.length === 2) {
    // "Kim, Minsu" — 쉼표가 어순을 명시하므로 모호성 없음
    const sur = comma[0].trim();
    const given = comma[1].trim().split(/\s+/);
    const r = tryConvert(sur, given);
    return r && passesPrecisionGates(sur, given, r) ? r : null;
  }
  if (comma.length > 2) return null;

  const toks = trimmed.split(/\s+/);
  if (toks.length < 2 || toks.length > 3) return null;

  const westSur = toks[toks.length - 1];
  const westGiven = toks.slice(0, -1);
  const eastSur = toks[0];
  const eastGiven = toks.slice(1);
  const west = tryConvert(westSur, westGiven);
  const east = tryConvert(eastSur, eastGiven);

  if (west && east && west !== east) return null; // 모호성 게이트

  if (west) return passesPrecisionGates(westSur, westGiven, west) ? west : null;
  if (east) return passesPrecisionGates(eastSur, eastGiven, east) ? east : null;
  return null;
}
