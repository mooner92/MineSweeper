import type { DocType } from '@/lib/domain';

export interface ExtractionPrompt {
  system: string;
  user: string;
}

const COMMON_RULES = `반드시 지켜라:
- 문서에 실제로 나타난 이름만 추출한다. 없으면 빈 배열을 반환한다. 절대 이름을 지어내지 마라.
- 참고문헌 / References / Bibliography / 참고자료에 인용된 저자는 절대 추출하지 않는다.
- 단, 제목 바로 아래(1페이지 상단)에 콤마로 나열된 "저자 블록"의 이름은 위 참고문헌 제외 규칙과
  무관하게 반드시 모두 추출한다. 영문 이름(예: "Choong-Ki Kim")은 번역하지 말고 그대로 둔다.
- 첨부된 이미지(스캔/이미지로 된 표 — 예: 공동연구개발기관·연구진 명단)가 있으면, 그 표의 모든
  담당자 이름과 역할을 한 명도 빠짐없이 추출한다(이미지 속 표도 본문과 동일하게 처리).
- 출력은 JSON 객체 하나만. 형식:
  {"persons":[{"name":string,"role":string,"affiliation":string|null,"source_kind":string,"page":number,"confidence":number,"is_self":boolean}]}
- role 허용값: supervisor, co_supervisor, committee, department_head, principal_investigator, research_staff, coauthor, project_manager.
- source_kind 허용값: printed, handwritten, seal, signature. 인쇄된 텍스트면 printed.
- confidence 는 0~1 사이 숫자.`;

export function buildExtractionPrompt(docType: DocType, text: string, selfName?: string): ExtractionPrompt {
  const selfNote = selfName
    ? `\n지원자 본인 이름은 "${selfName}"(영문 표기일 수 있음)이다. 본인이 저자/연구진 목록에 있으면 빼지 말고 추출하되 is_self=true 로 표시하라.`
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
        '논문 1페이지 상단 저자 블록(제목 바로 아래 콤마로 나열된 이름들)에서 공저자(coauthor)를 ' +
        '한 명도 빠짐없이 추출하라. 소속/이메일이 있으면 affiliation 에 담아라. 본문·참고문헌에 인용된 ' +
        '저자는 제외하되, 1페이지 저자 블록은 반드시 포함한다.';
      break;
    case 'research_project':
      task =
        '연구보고서/연구과제(용역·수탁) 문서에서 연구진을 추출하라. 연구책임자=principal_investigator, ' +
        '과제책임자=project_manager, 연구원/공동연구원/참여연구원=research_staff. 제출문·연구진 명단·' +
        '참여연구원 표를 보고, 소속이 있으면 affiliation 에 담아라. 발주처/감수자 등 기관명은 이름이 아니므로 제외한다.';
      break;
    case 'hindex':
      task =
        '구글스칼라 캡처 이미지에서 공저자 패널과 논문별 저자를 coauthor 로 추출하라. 약어형 이름(G Hong, J Carter)이 많다.';
      break;
    default:
      task = '문서에서 관계자(지도교수/심사위원/공저자 등)를 추출하라.';
  }

  // Image-only docs (scanned PDF / hindex) have no text layer — instruct the model to read the
  // attached image directly instead of pointing it at an empty text block (which yields []).
  const body = text.trim()
    ? `[문서 텍스트 시작]\n${text}\n[문서 텍스트 끝]`
    : '이 문서는 텍스트 레이어가 없는 스캔/이미지 문서다. 첨부된 페이지 이미지를 직접 읽어(OCR) 추출하라. 보이는 이름만 추출하고, 안 보이면 빈 배열.';

  return {
    system: `너는 채용 이해충돌 검토를 돕는 관계자 추출기다. ${COMMON_RULES}`,
    user: `${task}${selfNote}\n\n${body}`,
  };
}
