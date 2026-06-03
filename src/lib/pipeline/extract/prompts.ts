import type { DocType } from '@/lib/domain';

export interface ExtractionPrompt {
  system: string;
  user: string;
}

const COMMON_RULES = `반드시 지켜라:
- 문서에 실제로 나타난 이름만 추출한다. 없으면 빈 배열을 반환한다. 절대 이름을 지어내지 마라.
- 참고문헌 / References / Bibliography / 참고자료에 인용된 저자는 절대 추출하지 않는다.
- 출력은 JSON 객체 하나만. 형식:
  {"persons":[{"name":string,"role":string,"affiliation":string|null,"source_kind":string,"page":number,"confidence":number,"is_self":boolean}]}
- role 허용값: supervisor, co_supervisor, committee, department_head, principal_investigator, research_staff, coauthor.
- source_kind 허용값: printed, handwritten, seal, signature. 인쇄된 텍스트면 printed.
- confidence 는 0~1 사이 숫자.`;

export function buildExtractionPrompt(docType: DocType, text: string, selfName?: string): ExtractionPrompt {
  const selfNote = selfName
    ? `\n지원자 본인 이름은 "${selfName}" 이다. 본인으로 판단되면 is_self=true 로 표시하라.`
    : '';

  let task: string;
  switch (docType) {
    case 'degree_thesis':
      task =
        '학위논문 표지/인준 페이지에서 지도교수(supervisor), 부지도교수(co_supervisor), 심사위원(committee), 학과장(department_head)을 추출하라. 영문 표기는 Advisor / Co-Advisor / Chair / Committee Member / Head of Department 를 참고하라.';
      break;
    case 'representative_research':
    case 'journal_article':
      task =
        '논문 1페이지 저자 블록에서 공저자(coauthor)를 추출하라. 소속/이메일이 있으면 affiliation 에 담아라. 본문/참고문헌의 인용 저자는 제외한다.';
      break;
    case 'hindex':
      task =
        '구글스칼라 캡처 이미지에서 공저자 패널과 논문별 저자를 coauthor 로 추출하라. 약어형 이름(S Jang, G Newman)이 많다.';
      break;
    default:
      task = '문서에서 관계자(지도교수/심사위원/공저자 등)를 추출하라.';
  }

  return {
    system: `너는 채용 이해충돌 검토를 돕는 관계자 추출기다. ${COMMON_RULES}`,
    user: `${task}${selfNote}\n\n[문서 텍스트 시작]\n${text}\n[문서 텍스트 끝]`,
  };
}
