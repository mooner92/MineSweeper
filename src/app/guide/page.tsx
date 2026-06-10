import type { Metadata } from 'next';
import { Bullets, ContentShell, Section } from '@/components/page-shell';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `사용 안내 | ${SITE.name}` };

export default function GuidePage() {
  return (
    <ContentShell
      title="사용 안내"
      subtitle="지원자 첨부서류에서 이해충돌 관계자를 추출하고, 담당자가 검토·확정하는 순서입니다."
      updated={SITE.updated}
    >
      <div className="seed-card bg-accent-subtle p-4 text-sm leading-relaxed text-fg">
        <strong className="font-semibold">원칙 — 자동 추출은 초안, 최종 판단은 사람.</strong> 추출기는
        문서에 실제로 있는 이름만 뽑고, 없으면 비워 둡니다(지어내지 않음). 도장·손글씨처럼 판독이
        어려운 항목은 자동 확정하지 않고 검토 큐로 모읍니다.
      </div>

      <Section title="1. 업로드">
        <Bullets
          items={[
            <>메인 화면에서 지원자 ZIP을 올리고 <strong>업로드 &amp; 추출</strong>을 누릅니다.</>,
            '압축 내부 폴더 구조는 자유이며, 한글 파일명·HWP/HWPX도 처리됩니다.',
            <>같은 <strong>지원번호</strong>(예: 0323-000050)를 다시 올리면 이전 추출을 <strong>덮어씁니다</strong> — 항상 1지원자 = 1카드.</>,
            '업로드 후 백그라운드로 추출이 돌고, 지원자 목록에 "검토 가능"으로 표시됩니다.',
          ]}
        />
      </Section>

      <Section title="2. 지원자별 검토">
        <Bullets
          items={[
            <>관계자가 <strong>관계 유형(지도교수·심사위원·공저자·연구진…)별로 묶여</strong> 보이고, 상단 <strong>필터 칩(전체 / 검토 필요 / 역할별)</strong>으로 좁혀 볼 수 있습니다.</>,
            <>상태 배지: <span className="font-semibold text-success">초록 “자동 통과”</span>(인쇄·고신뢰) / <span className="font-semibold text-warning">노랑 “미확인”</span>(비인쇄·저신뢰 → 꼭 확인).</>,
            '각 항목은 확인 / 수정 / 제외할 수 있고, 교정 내역이 기록됩니다.',
            <><strong>동명이인/약어 후보</strong>(예: 김용 / 김용표)는 자동 병합하지 않고 후보를 병기해 사람이 선택합니다.</>,
            '본인은 자동 제외됩니다(영문명으로만 적힌 본인은 수동 제외가 필요할 수 있음).',
            '문서 카드에는 “관계자 N명” 태그로 어느 문서에서 몇 명이 나왔는지 표시합니다.',
          ]}
        />
      </Section>

      <Section title="3. 검토 필요 큐">
        <Bullets
          items={[
            '도장·서명·손글씨·동명이인 항목을 한 곳에 모아 봅니다.',
            '도장/서명은 위치를 감지한 크롭 이미지로, 동명이인/약어는 이름이 나온 원문 페이지 썸네일로 비교합니다.',
            <>HWP 원문은 <strong>“원문 보기”</strong>로 <code>.hwp</code> 파일을 받아 한글에서 엽니다(브라우저로는 열리지 않음).</>,
          ]}
        />
      </Section>

      <Section title="4. 명단 내보내기">
        <Bullets
          items={[
            <>지원자별 최종 명단을 <strong>CSV / Excel</strong>로 내보냅니다(심사위원 풀 대조용).</>,
            '본인·제외 처리한 항목은 빠집니다.',
          ]}
        />
      </Section>

      <Section title="지원 형식 / 처리 방식">
        <Bullets
          items={[
            '지원 형식: PDF · 이미지(스캔/캡처) · HWP·HWPX · 텍스트.',
            '이름 추출과 도장·서명 감지는 모두 온프레 로컬 모델로 수행하며, 외부 클라우드/API로 데이터를 전송하지 않습니다.',
            '한 문서 추출이 실패해도 전체가 멈추지 않고 해당 문서만 검토 큐로 강등됩니다.',
          ]}
        />
      </Section>
    </ContentShell>
  );
}
