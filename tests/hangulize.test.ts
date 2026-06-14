import { describe, expect, it } from 'vitest';
import { estimateKoreanName } from '@/lib/hangulize';

describe('estimateKoreanName (로마자 → 한글 이름 추정)', () => {
  it('converts western-order romanized Korean names (붙여쓴 음절 분절)', () => {
    expect(estimateKoreanName('Minsu Kim')).toBe('김민수');
    expect(estimateKoreanName('Jiyoung Kim')).toBe('김지영'); // ji|young — jiy|oung으로 깨지면 안 됨
    expect(estimateKoreanName('Seunghyun Lee')).toBe('이승현'); // 'ngh' 연쇄에서 seung|hyun 경계
    expect(estimateKoreanName('Jiyoung Cho')).toBe('조지영');
    expect(estimateKoreanName('Hyun-woo Choe')).toBe('최현우');
  });

  it('converts comma form (성-우선)', () => {
    expect(estimateKoreanName('Kim, Minsu')).toBe('김민수');
    expect(estimateKoreanName('Kim, Ji-young')).toBe('김지영'); // young = RR(yeong) 아닌 통용 표기
    expect(estimateKoreanName('PARK, JISUNG')).toBe('박지성'); // 대문자+쉼표+붙여쓰기 조합
  });

  it('converts Korean-order, hyphen, and case variants', () => {
    expect(estimateKoreanName('Kim Min-su')).toBe('김민수');
    expect(estimateKoreanName('KIM MINSU')).toBe('김민수');
    expect(estimateKoreanName('Lee Seung-hyun')).toBe('이승현');
    expect(estimateKoreanName('Park Ji-sung')).toBe('박지성'); // Park = 통용 성씨 표기(RR은 Bak)
    expect(estimateKoreanName('Park Ji Sung')).toBe('박지성'); // 3토큰 한국 어순
    expect(estimateKoreanName('Choi Soo-jin')).toBe('최수진'); // soo = 통용 모음 표기(RR은 su)
    expect(estimateKoreanName('Jung Da-eun')).toBe('정다은');
    expect(estimateKoreanName('Ryu Seung-min')).toBe('류승민');
    expect(estimateKoreanName('Kang Hyeon-jeong')).toBe('강현정'); // negative 'Kang Wei'와 대조쌍
    expect(estimateKoreanName('lee min-ho')).toBe('이민호'); // 전부 소문자
  });

  it('handles 1~3 syllable given names and 복합 음절', () => {
    expect(estimateKoreanName('Park Sol')).toBe('박솔'); // 1음절 — 이니셜로 오판 금지
    expect(estimateKoreanName('Kim Sae-rom')).toBe('김새롬');
    expect(estimateKoreanName('Park Bo-ra-mi')).toBe('박보라미'); // 3음절 상한
    expect(estimateKoreanName('Kim Minsuminsu')).toBeNull(); // 4음절 이상은 한국 이름이 아님
  });

  it('rejects Chinese names — 성씨 게이트와 음절 게이트 이중 차단', () => {
    expect(estimateKoreanName('Zhihao Wang')).toBeNull(); // wu는 성씨표에서 의도적 제외
    expect(estimateKoreanName('Li Wei')).toBeNull(); // li = 중국 전용 표기로 제외
    expect(estimateKoreanName('Zhang Xiaoming')).toBeNull();
    expect(estimateKoreanName('Wang Fang')).toBeNull();
    // 성씨가 한국과 겹쳐도 이름이 한국 음절로 분절되지 않으면 차단 — 실질적 방어선
    expect(estimateKoreanName('Lee Xiaoming')).toBeNull();
    expect(estimateKoreanName('Kang Wei')).toBeNull(); // we+i 과분절 함정
    expect(estimateKoreanName('Yang Liwei')).toBeNull(); // li+wei 함정 (실존 인물 사례)
    expect(estimateKoreanName('Lee, Hsiao-wen')).toBeNull(); // 쉼표+하이픈으로 한국식 형식을 모방한 대만식 표기
  });

  it('rejects Japanese and Western names', () => {
    expect(estimateKoreanName('Takeshi Yamamoto')).toBeNull();
    expect(estimateKoreanName('Yuki Tanaka')).toBeNull();
    expect(estimateKoreanName('Hiroshi Sato')).toBeNull(); // Sato — 성씨 부분 문자열 매칭 금지
    expect(estimateKoreanName('John Smith')).toBeNull();
    expect(estimateKoreanName('Maria Garcia')).toBeNull();
  });

  it('rejects initials, single tokens, Hangul, and empty input', () => {
    expect(estimateKoreanName('M. Kim')).toBeNull(); // 마침표 = 이니셜
    expect(estimateKoreanName('Kim, J.')).toBeNull(); // 쉼표 경로에서도 이니셜 차단
    expect(estimateKoreanName('Kim, J.-Y.')).toBeNull(); // 하이픈 연결 이니셜
    expect(estimateKoreanName('Kim, J')).toBeNull(); // 한 글자 = 이니셜
    expect(estimateKoreanName('Kim')).toBeNull(); // 성만으로는 추정 불가
    expect(estimateKoreanName('김민수')).toBeNull(); // 이미 한글
    expect(estimateKoreanName('')).toBeNull();
    expect(estimateKoreanName(null)).toBeNull();
    expect(estimateKoreanName(undefined)).toBeNull();
  });

  it('allows hyphen-joined single letters and 복성(남궁)', () => {
    expect(estimateKoreanName('Kim Ji-a')).toBe('김지아'); // 하이픈 결합 한 글자는 이니셜이 아님
    expect(estimateKoreanName('Namgoong Min')).toBe('남궁민'); // 두 글자 성씨
  });

  it('rejects pinyin/W-G names sharing Korean surname spellings (충돌 성씨 게이트 — 실존 사례)', () => {
    expect(estimateKoreanName('Kang Hui')).toBeNull(); // 康辉 — 충돌 성씨 + 1음절 given
    expect(estimateKoreanName('Ma Yun')).toBeNull(); // 马云
    expect(estimateKoreanName('Jin Yong')).toBeNull(); // 金庸
    expect(estimateKoreanName('Sun Yang')).toBeNull(); // 孙杨 — 서양 어순 해석도 차단
    expect(estimateKoreanName('Yang Mi')).toBeNull(); // 杨幂
    expect(estimateKoreanName('Song Dandan')).toBeNull(); // 宋丹丹 — 동일 음절 중첩은 핀인 전형
    expect(estimateKoreanName('Ho Man')).toBeNull(); // 광둥 何 — ho는 성씨표에서 제외
  });

  it('rejects order-ambiguous names instead of silently picking one (모호성 게이트)', () => {
    expect(estimateKoreanName('Kang Min')).toBeNull(); // 민강/강민 — 모호하면 포기(정밀도 우선)
    expect(estimateKoreanName('Han Hong')).toBeNull(); // 韩红 — 홍한/한홍 모두 성립
    expect(estimateKoreanName('Yu Chang')).toBeNull(); // 張育成 — 장유/유창 모두 성립
    expect(estimateKoreanName('Ye Min')).toBeNull(); // 민예/예민 모두 성립
  });

  it('rejects foreign given names that segment into Korean syllables (외국 빈출 이름 차단)', () => {
    expect(estimateKoreanName('Juan Ko')).toBeNull(); // 충돌 성씨 + 서양 이름
    expect(estimateKoreanName('Anna Chang')).toBeNull();
    expect(estimateKoreanName('Yuki Oh')).toBeNull(); // 일본 이름 + 王(Oh)
    expect(estimateKoreanName('Jay Lee')).toBeNull(); // jay 키 제거 — 영어 이름이 음절 키였음
    expect(estimateKoreanName('June Kim')).toBeNull(); // june 키 제거
    // 비충돌 성씨 + 한국에서도 흔한 이름은 유지(교포 케이스)
    expect(estimateKoreanName('Yuri Kim')).toBe('김유리');
  });
});
