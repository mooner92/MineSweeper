import type { SourceFormat } from '@/lib/domain';

// 벤치마킹: 동일 주제의 사내 배제리스트 생성기(verify.py C1~C7 + 동일소속기관 제척 근거)에서
// 좋았던 두 가지를 가져온 모듈 — (1) 지원자 단위 자동 점검(누락을 숨기지 않음),
// (2) 본인과 동일 소속기관 추정(기관 단위 제척 근거). 표시·참고용일 뿐 자동 차단하지 않는다.

/** 기관형 접미사 — 이걸로 끝나면서 실제 기관명 접두가 붙은 토큰만 기관으로 본다. */
const INSTITUTION_SUFFIXES = ['대학교', '대학', '연구원', '연구소', '학교', '병원', '공단', '공사', '청'];

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '');

const tokens = (s: string) => s.split(/[\s,;·()/[\]]+/).filter(Boolean);

function institutionTokens(s: string): string[] {
  return tokens(s).filter((t) => {
    const suffix = INSTITUTION_SUFFIXES.find((x) => t.endsWith(x));
    // 맨몸 접미사("연구원"=직함, "대학")는 제외 — 기관명 접두가 2자 이상 붙어야 기관으로 취급.
    return suffix !== undefined && t.length >= suffix.length + 2;
  });
}

/**
 * 지원자 본인 소속(들)과 비교해 같은 기관으로 추정되면 그 기관명을 돌려준다.
 * 보수적 규칙 — (a) 기관형 토큰 공유("서울대학교 환경대학원" ↔ "서울대학교 지구환경과학부"),
 * (b) 공백 제거 후 접두 일치(한글 포함 5자 이상), (c) 완전 동일 문자열(영문 소속 포함).
 * 영문 소속끼리의 부분 일치는 매칭하지 않는다(오탐 방지 — 자문 기능이므로 정밀도 우선).
 */
export function sharedInstitution(
  selfAffiliations: Array<string | null | undefined>,
  other: string | null | undefined,
): string | null {
  if (!other?.trim()) return null;
  const otherToks = new Set(tokens(other));
  const otherInst = institutionTokens(other);
  const otherNorm = norm(other);

  for (const self of selfAffiliations) {
    if (!self?.trim()) continue;

    // (a) 기관형 토큰 공유 (양방향)
    const selfToks = new Set(tokens(self));
    const hit =
      otherInst.find((t) => selfToks.has(t)) ?? institutionTokens(self).find((t) => otherToks.has(t));
    if (hit) return hit;

    // (c) 완전 동일 (영문 소속도 커버)
    const selfNorm = norm(self);
    if (selfNorm.length >= 5 && selfNorm === otherNorm) return other.trim();

    // (b) 접두 일치 — "한국환경연구원" ↔ "한국환경연구원 물국토연구본부"
    const [short] = selfNorm.length <= otherNorm.length ? [selfNorm] : [otherNorm];
    const long = selfNorm.length <= otherNorm.length ? otherNorm : selfNorm;
    if (short.length >= 5 && /[가-힣]/.test(short) && long.startsWith(short)) {
      return (self.trim().length <= other.trim().length ? self : other).trim();
    }
  }
  return null;
}

export type CheckLevel = 'pass' | 'info' | 'warn';

export interface ApplicantCheck {
  id: string;
  level: CheckLevel;
  label: string;
  detail?: string;
}

export interface ApplicantCheckInput {
  documents: Array<{ id: string; filename: string; sourceFormat: SourceFormat; hasTextLayer: boolean }>;
  /** documentId → 그 문서에서 검출된 (본인 제외) 인원 수 */
  peopleByDoc: Map<string, number>;
  /** 본인으로 식별된 이름들 — 비어 있으면 본인 미식별 경고. */
  selfNames: string[];
  reviewCount: number;
  openFlags: number;
  sameAffiliationCount: number;
}

/** 지원자 단위 자동 점검 — 추출 결과의 신뢰성 게이트. 결과는 표시용, 최종 판단은 사람. */
export function buildApplicantChecks(input: ApplicantCheckInput): ApplicantCheck[] {
  const checks: ApplicantCheck[] = [];

  // V1 본인 식별: self가 안 잡히면 본인이 명단에 섞여 있을 수 있다.
  checks.push(
    input.selfNames.length > 0
      ? {
          id: 'self',
          level: 'pass',
          label: '본인 식별 — 명단에서 자동 제외됨',
          detail: input.selfNames.join(', '),
        }
      : {
          id: 'self',
          level: 'warn',
          label: '본인 이름이 문서에서 식별되지 않음',
          detail: '영문·한자 표기 차이 가능 — 명단에 본인이 포함됐는지 확인하세요',
        },
  );

  // V2 검출 커버리지: 텍스트가 있는데 0명인 문서는 추출 실패 가능성 — 숨기지 않고 드러낸다.
  const textDocs = input.documents.filter(
    (d) => d.hasTextLayer || d.sourceFormat === 'text' || d.sourceFormat === 'hwp',
  );
  const zero = textDocs.filter((d) => (input.peopleByDoc.get(d.id) ?? 0) === 0);
  checks.push(
    zero.length === 0
      ? {
          id: 'coverage',
          level: 'pass',
          label:
            textDocs.length > 0
              ? `텍스트 문서 ${textDocs.length}건 모두에서 관계자 검출`
              : '텍스트 문서 없음',
        }
      : {
          id: 'coverage',
          level: 'warn',
          label: `관계자 0명 텍스트 문서 ${zero.length}건 — 원문 대조 권장`,
          detail: zero.map((d) => d.filename).join(', '),
        },
  );

  // V3 이미지/스캔: 텍스트 추출이 불가능했던 문서 — 비전(OCR) 결과라 수동 확인 대상.
  const scanned = input.documents.filter(
    (d) => !d.hasTextLayer && (d.sourceFormat === 'pdf' || d.sourceFormat === 'image'),
  );
  if (scanned.length > 0) {
    checks.push({
      id: 'vision',
      level: 'info',
      label: `이미지/스캔 문서 ${scanned.length}건 — 비전(OCR) 추출, 수동 확인 대상`,
      detail: scanned.map((d) => d.filename).join(', '),
    });
  }

  // V4 검토 필요 (용어 통일: 헤더 배지·필터 칩·StatCell과 같은 단어를 쓴다)
  checks.push(
    input.reviewCount === 0 && input.openFlags === 0
      ? { id: 'review', level: 'pass', label: '검토 필요 항목 없음' }
      : {
          id: 'review',
          level: 'info',
          label: `검토 필요 ${input.reviewCount}명 · 열린 플래그 ${input.openFlags}건`,
        },
  );

  // V5 동일 소속기관 — 기관 단위 제척 근거(주황 '동일소속' 배지).
  if (input.sameAffiliationCount > 0) {
    checks.push({
      id: 'same-aff',
      level: 'info',
      label: `본인과 동일 소속기관(추정) ${input.sameAffiliationCount}명 — 표에 '동일소속' 표시`,
    });
  }

  return checks;
}
