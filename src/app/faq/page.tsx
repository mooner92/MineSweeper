import type { Metadata } from 'next';
import { ContentShell, Faq } from '@/components/page-shell';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `자주 묻는 질문 | ${SITE.name}` };

export default function FaqPage() {
  return (
    <ContentShell
      title="자주 묻는 질문 (FAQ)"
      subtitle="검토 담당자가 자주 마주치는 상황을 모았습니다."
      updated={SITE.updated}
    >
      <div className="space-y-2">
        <Faq q="추출이 한 명도 안 나오거나 너무 느려요.">
          대용량·스캔 문서는 시간이 걸립니다. 지원자 상태가 <strong>“추출 running”</strong>이면 아직
          진행 중이니 잠시 후 새로고침하세요. 텍스트 레이어가 없는 스캔/이미지 문서는 비전(OCR)으로
          읽어 더 느립니다. 한참 뒤에도 0명이고 상태가 error면 모델 서버 상태를 운영자에게
          문의하세요.
        </Faq>

        <Faq q="같은 지원자가 목록에 여러 번 보여요.">
          같은 <strong>지원번호</strong>의 ZIP을 다시 올리면 이전 것을 자동으로 덮어써 1지원자 =
          1카드로 유지됩니다. 단, 지원번호가 없는(파일명이 이름만 있는) ZIP은 동명이인 위험 때문에
          새 항목으로 생성됩니다.
        </Faq>

        <Faq q="“동명이인/약어”는 무슨 뜻인가요?">
          같은 사람인지 다른 사람인지 자동으로 단정하기 애매한 경우입니다. 예: <strong>김용 / 김용표</strong>
          (약어일 수 있음), <strong>이주영 / 이조영</strong>(한 글자 오인식일 수 있음). 시스템은 이런
          후보를 <strong>자동 병합하지 않고</strong> 이름이 나온 원문 페이지를 띄워 사람이 직접
          비교·판단하게 합니다. (성씨가 다르거나 명백히 다른 이름은 묶지 않습니다.)
        </Faq>

        <Faq q="도장·서명의 글자(이름)를 읽어 주나요?">
          아니요. 도장·서명은 <strong>위치만 감지</strong>해 잘라서 모아 보여줄 뿐, 글자 판독은 사람이
          합니다. 전서체 도장 등은 오판 위험이 커서 자동 확정하지 않는 것이 원칙입니다.
        </Faq>

        <Faq q="한글 파일명이 깨져 보여요.">
          mac에서 만든 ZIP 등은 파일명이 분해돼 저장되는 경우가 있습니다. 서버에서 최대한 복원하며,
          복원이 불가능하면 깨진 글자 대신 <strong>문서 유형 라벨</strong>로 표시합니다. 원본이
          필요하면 “원문 보기”로 받아 확인하세요.
        </Faq>

        <Faq q="HWP “원문 보기”를 눌렀더니 안 열려요.">
          HWP는 브라우저에서 바로 열리지 않습니다. <code>.hwp</code> 파일로 다운로드된 뒤 한글(한컴
          오피스)에서 엽니다. 확장자 없이 받아졌다면 파일 이름 끝에 <code>.hwp</code>를 붙이면
          열립니다.
        </Faq>

        <Faq q="추출 결과가 틀렸어요. 어떻게 하나요?">
          자동 추출은 <strong>초안</strong>입니다. 잘못된 항목은 <strong>수정</strong> 또는
          <strong> 제외</strong>로 바로잡으면 되고, 교정 내역은 기록되어 추후 정확도 개선에
          활용됩니다.
        </Faq>

        <Faq q="지원자 정보가 외부로 전송되나요?">
          아니요. 이름 추출·도장 감지 모두 <strong>온프레 로컬 모델</strong>로만 처리하며, 외부
          클라우드나 외부 API로 문서·개인정보를 전송하지 않습니다. 원본·DB는 서버 로컬에만
          저장됩니다.
        </Faq>

        <Faq q="업로드 용량 제한이 있나요?">
          공개 도메인을 경유하면 약 100MB까지 가능합니다. 더 큰 압축파일은 내부망으로 직접
          접속(포트 3100)해 올리거나, ZIP을 나눠 올려 주세요.
        </Faq>
      </div>

      <p className="text-sm text-fg-muted">
        여기서 해결되지 않으면{' '}
        <a className="text-accent hover:underline" href={`mailto:${SITE.contactEmail}`}>
          {SITE.contactEmail}
        </a>{' '}
        로 문의해 주세요.
      </p>
    </ContentShell>
  );
}
