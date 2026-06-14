import { type DocType, ROLES, type Role } from '@/lib/domain';
import { namesMatch } from '@/lib/names';
import type { PageBundle, RawPerson } from '@/lib/pipeline/types';

/**
 * 참여연구진 표의 **결정적(regex) 추출** — `이름 ( 역할 )` 패턴(연구보고서에서 매우 규칙적)을 직접 뽑는다.
 * 7B VLM은 평탄화된 표에서 행을 누락하곤 하는데(예: 7명 중 연구책임자·맨 끝 보조원 누락), pdfjs가
 * 뽑은 텍스트엔 전원이 또렷이 남으므로 이 패턴이 모델보다 재현율이 높다. VLM 결과와 union(누락분 추가).
 */
const ROLE_MAP: Record<string, Role> = {
  연구책임자: 'principal_investigator',
  과제책임자: 'project_manager',
  공동연구원: 'research_staff',
  참여연구원: 'research_staff',
  연구보조원: 'research_staff',
  보조연구원: 'research_staff',
  연구원: 'research_staff',
  보조원: 'research_staff',
};

// 역할 라벨은 긴 것 먼저(보조연구원이 연구원보다 앞서 매칭되도록). 이름은 역할 바로 앞 2~4 한글.
const ROSTER_RE =
  /([가-힣]{2,4})\s*\(\s*(연구책임자|과제책임자|공동연구원|참여연구원|연구보조원|보조연구원|연구원|보조원)\s*\)/g;

const rolePriority = (r: Role): number => {
  const i = ROLES.indexOf(r);
  return i < 0 ? ROLES.length : i;
};

/** 페이지들에서 `이름(역할)` 명단을 추출. 같은 이름은 가장 높은 우선순위 역할로 합친다. */
export function extractRosterFromText(pages: PageBundle[], selfName?: string): RawPerson[] {
  const byName = new Map<string, RawPerson>();
  for (const pg of pages) {
    if (!pg.text) continue;
    const re = new RegExp(ROSTER_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(pg.text)) !== null) {
      const name = m[1];
      const role = ROLE_MAP[m[2]] ?? 'research_staff';
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, {
          nameRaw: name,
          role,
          affiliation: null,
          sourceKind: 'printed',
          sourcePage: pg.pageNumber,
          confidence: 0.85,
          isSelf: selfName ? namesMatch(name, selfName) : false,
          ocrEngine: 'roster:regex',
          ocrConfidence: null,
        });
      } else if (rolePriority(role) < rolePriority(existing.role)) {
        existing.role = role; // 더 높은 역할(연구책임자 등)로 승격
      }
    }
  }
  return [...byName.values()];
}

/** VLM 결과에 명단 추출 결과를 합친다(이름이 겹치지 않는 인물만 추가). */
export function mergeRoster(vlmPersons: RawPerson[], roster: RawPerson[]): RawPerson[] {
  const merged = [...vlmPersons];
  for (const r of roster) {
    if (!merged.some((v) => namesMatch(v.nameRaw, r.nameRaw))) merged.push(r);
  }
  return merged;
}

// ── 논문 저자 블록 결정적 추출 ───────────────────────────────────────────────
// 영문 논문 1페이지 저자 블록(제목 아래 콤마 나열, 위첨자 a,b,c 소속 마커 섞임)에서 저자를 뽑는다.
// 7B VLM은 긴 저자목록(예: 15명)에서 앞 3명만 읽고 끊는 경우가 잦다(실측) — pdfjs 텍스트엔 전원이
// 또렷이 남으므로 패턴이 모델보다 재현율이 높다. 저자명 = 대문자 시작 단어 1~4개 + 위첨자 마커.

// 저자 블록의 끝(= 소속 목록 시작) 추정: 위첨자 마커(소문자 1자/숫자) + 기관 키워드.
// 'Research'(단독)는 "Research Article" 헤더를 오인해 일찍 자르므로 제외(다른 키워드로 충분).
const AFFIL_START =
  /(?:^|\s)(?:[a-z]|\d{1,2})\s+(?:Department|School|College|Institute|Centre|Center|Graduate|Faculty|Laborator|Division|Korea|Korean|National|University)\b/;
// 저자 = 대문자 시작 단어 1~4개 + 위첨자 마커(소문자 1자/숫자/별표), 뒤에 콤마·세미콜론·and·끝.
// 숫자 마커도 지원(저널마다 a,b,c 또는 1,2,3). 2단어 이상 이름 + 영역 cut + 콤마 룩어헤드로 오탐 차단.
const AUTHOR_RE =
  /([A-Z][A-Za-z'’.-]*(?:[ -][A-Z][A-Za-z'’.-]*){0,3})\s+(?:[a-z]|\d{1,2}|\*|†|‡)(?:\s*,\s*(?:[a-z]|\d{1,2}|\*|†|‡))*\s*(?=,|\*|;|and\b|&|$)/g;

/**
 * 논문 1페이지 저자 블록에서 공저자를 결정적으로 추출한다. 소속 목록 시작 전까지로 영역을 자르고,
 * '대문자 이름 + 위첨자 마커' 패턴을 뽑는다. 단일 토큰(제목·지명 오탐)은 버린다(2단어 이상만).
 */
export function extractAuthorsFromText(pages: PageBundle[], selfName?: string): RawPerson[] {
  const front = [...pages].filter((p) => p.text).sort((a, b) => a.pageNumber - b.pageNumber)[0];
  if (!front) return [];
  let region = front.text;
  const m = region.match(AFFIL_START);
  if (m && m.index !== undefined && m.index > 40) region = region.slice(0, m.index);

  const out = new Map<string, RawPerson>();
  const re = new RegExp(AUTHOR_RE.source, 'g');
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(region)) !== null) {
    const name = mm[1].trim().replace(/\s+/g, ' ');
    if (name.split(' ').length < 2) continue; // 단일 토큰(제목/지명) 오탐 차단
    if (out.has(name)) continue;
    out.set(name, {
      nameRaw: name,
      role: 'coauthor',
      affiliation: null,
      sourceKind: 'printed',
      sourcePage: front.pageNumber,
      confidence: 0.8,
      isSelf: selfName ? namesMatch(name, selfName) : false,
      ocrEngine: 'authors:regex',
      ocrConfidence: null,
    });
  }
  return [...out.values()];
}

// ── 공동연구개발기관 등 명단 표 결정적 추출 ───────────────────────────────────
// 연구보고서 1페이지의 '공동연구개발기관 등' 표는 `기관 이름 직위 전화 이메일 역할 유형` 행이라
// 괄호도 위첨자도 없다. 7B는 이 표(20~30행)도 일부만 읽고 끊는다. 각 행에 이메일이 있는 점을
// 앵커로 삼아 '이름 + 직위 + …이메일'을 뽑으면 오탐 없이 전원 추출된다. 공동연구원=공동과제 제척 대상.
const INSTITUTION_ROW_RE =
  /([가-힣]{2,4})\s+(?:대표|교수|부교수|조교수|실장|처장|단장|소장|이사|부장|차장|과장|팀장|원장|책임연구원|선임연구원|수석연구원|연구위원|연구원|위원|책임|선임|수석|박사|연구사)\s+[A-Za-z0-9.\s()+-]*@/g;

/** '공동연구개발기관 등' 표(이름+직위+이메일 행)에서 담당자를 결정적으로 추출한다. */
export function extractInstitutionRoster(pages: PageBundle[], selfName?: string): RawPerson[] {
  const byName = new Map<string, RawPerson>();
  for (const pg of pages) {
    if (!pg.text) continue;
    const re = new RegExp(INSTITUTION_ROW_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(pg.text)) !== null) {
      const name = m[1];
      if (byName.has(name)) continue;
      byName.set(name, {
        nameRaw: name,
        role: 'research_staff', // 공동연구개발기관 책임자 = 공동연구자
        affiliation: null,
        sourceKind: 'printed',
        sourcePage: pg.pageNumber,
        confidence: 0.85,
        isSelf: selfName ? namesMatch(name, selfName) : false,
        ocrEngine: 'institution:regex',
        ocrConfidence: null,
      });
    }
  }
  return [...byName.values()];
}

// ── 참여자 명단 표 결정적 추출 ────────────────────────────────────────────────
// 보고서 부록의 '참여자 명단' 표는 `성명 연령 재직기간 소속/직책 최종학력 자격증 담당업무` 행이라
// 이메일도 괄호역할도 없다(위 두 추출기로는 안 잡힘). 각 행이 `이름 나이 재직기간(N년)`으로 시작하는
// 점을 앵커로 삼아 이름을 뽑는다. 표 헤더(참여자 명단/성명…담당업무)가 있는 페이지에서만 동작해 오탐 차단.
const PARTICIPANT_ANCHOR = /참여\s*자?\s*명단|성\s*명[\s\S]{0,60}담당\s*업무/;
const PARTICIPANT_ROW_RE = /([가-힣]{2,4})\s+\d{1,2}\s+\d{1,2}\s*년/g;

/** '참여자 명단' 표(성명+나이+재직기간 행)에서 참여자를 결정적으로 추출한다. */
export function extractParticipantRoster(pages: PageBundle[], selfName?: string): RawPerson[] {
  const byName = new Map<string, RawPerson>();
  for (const pg of pages) {
    if (!pg.text || !PARTICIPANT_ANCHOR.test(pg.text)) continue;
    const re = new RegExp(PARTICIPANT_ROW_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(pg.text)) !== null) {
      const name = m[1];
      if (byName.has(name)) continue;
      byName.set(name, {
        nameRaw: name,
        role: 'research_staff', // 참여자 명단 = 공동 참여연구자
        affiliation: null,
        sourceKind: 'printed',
        sourcePage: pg.pageNumber,
        confidence: 0.85,
        isSelf: selfName ? namesMatch(name, selfName) : false,
        ocrEngine: 'participant:regex',
        ocrConfidence: null,
      });
    }
  }
  return [...byName.values()];
}

/**
 * docType별 결정적(regex) 명단 추출의 단일 진입점. **추출기(VLM 등)의 성공/실패와 무관하게**
 * 파이프라인(run.ts)에서 호출해 결과에 union한다 — 7B가 긴 표를 놓치거나 컨텍스트 한도(16k)로
 * 통째로 실패해도 정형 명단(참여연구진·공동연구개발기관·참여자 명단·저자 블록)은 반드시 확보한다.
 */
export function supplementRoster(
  pages: PageBundle[],
  docType: DocType,
  selfName?: string,
): RawPerson[] {
  if (docType === 'research_project') {
    return mergeRoster(
      mergeRoster(extractRosterFromText(pages, selfName), extractInstitutionRoster(pages, selfName)),
      extractParticipantRoster(pages, selfName),
    );
  }
  if (docType === 'journal_article' || docType === 'representative_research') {
    return extractAuthorsFromText(pages, selfName);
  }
  return [];
}
