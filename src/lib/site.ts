/**
 * Site-wide constants for the footer and legal/info pages — one place to edit.
 *
 * TODO(배포): operator(운영 기관)·contactEmail 을 실제 값으로 교체하세요. 나머지 문구는
 * 본 시스템의 실제 성격(내부망·온프레·지원자 PII 처리·자동추출은 초안)에 맞춰 작성되어 있습니다.
 */
export const SITE = {
  name: 'Minesweeper',
  tagline: '채용 이해충돌 관계자 검토 시스템',
  /** 운영 주체 — 저작권·사이트 소개에 표기됩니다. */
  operator: 'KEI AIDT',
  /** 문의 이메일 — KEI 메일 별칭(support.aidt@kei.re.kr → mhchoi@kei.re.kr 사서함 수신). */
  contactEmail: 'support.aidt@kei.re.kr',
  /** 저작권 연도 표기. */
  copyrightYears: '2026',
  /** 안내 문서(사용 안내/FAQ/소개) 마지막 수정일(YYYY.MM.DD). */
  updated: '2026.06.10',
} as const;
