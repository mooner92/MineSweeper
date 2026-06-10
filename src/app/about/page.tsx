import type { Metadata } from 'next';
import Link from 'next/link';
import { Bullets, ContentShell, Section } from '@/components/page-shell';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `사이트 소개 | ${SITE.name}` };

export default function AboutPage() {
  return (
    <ContentShell title="사이트 소개" subtitle={SITE.tagline}>
      <Section title="무엇을 하나요">
        <p>
          {SITE.name}은 지원자 첨부서류(학위논문·연구실적·구글스칼라 캡처·연구보고서 등)에서 채용
          이해충돌 관계자(지도교수·심사위원·공저자·연구진)를 자동으로 추출해 출처와 함께 보여주고,
          담당자가 육안으로 검토·수정·확정하는 내부 보조 도구입니다.
        </p>
      </Section>

      <Section title="왜 필요한가요">
        <Bullets
          items={[
            '심사위원 풀에서 지원자와 이해충돌이 있는 사람을 걸러야 하는데, 서류를 일일이 열어 대조하는 작업은 느리고 누락 위험이 큽니다.',
            '첨부서류가 PDF·이미지·HWP 등 제각각이라 사람이 직접 확인하기 번거롭습니다.',
            '이 도구는 그 1차 정리를 자동화해 검토 시간을 줄이고 누락을 방지합니다.',
          ]}
        />
      </Section>

      <Section title="핵심 원칙">
        <p>
          <strong>자동 추출은 초안, 최종 판단은 항상 사람.</strong> 문서에 실제로 있는 이름만 뽑고,
          없으면 “없음”으로 둡니다(지어내지 않음). 합·불 판정이나 자동 확정은 하지 않습니다.
        </p>
      </Section>

      <Section title="대상 사용자">
        <p>채용·심사 과정에서 이해충돌을 검토하는 담당자(권한이 부여된 내부 사용자).</p>
      </Section>

      <Section title="데이터 처리 · 보안">
        <Bullets
          items={[
            '지원자 서류와 추출 결과는 온프레 서버(로컬 디스크·DB)에만 저장하며, 외부 클라우드나 제3자에게 전송하지 않습니다.',
            '이름 추출·도장 감지에 쓰는 AI 모델도 서버 내부의 로컬 모델이며, 외부 API를 사용하지 않습니다.',
            '광고·외부 분석 도구(AdSense·트래킹 등)를 사용하지 않습니다.',
            '내부망 전용으로 운영하며, 권한이 있는 담당자만 접근합니다. 개인정보는 검토 목적에 한해 처리하고 내부 보존정책에 따라 파기합니다.',
          ]}
        />
      </Section>

      <Section title="더 알아보기">
        <p>
          사용 순서는 <Link className="text-accent hover:underline" href="/guide">사용 안내</Link>,
          자주 묻는 질문은 <Link className="text-accent hover:underline" href="/faq">FAQ</Link>를
          참고하세요. 문의:{' '}
          <a className="text-accent hover:underline" href={`mailto:${SITE.contactEmail}`}>
            {SITE.contactEmail}
          </a>
        </p>
      </Section>
    </ContentShell>
  );
}
