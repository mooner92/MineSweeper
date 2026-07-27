import type { CSSProperties, ReactNode } from 'react';

/**
 * 조인트 스탯 타일 — 부모의 seed-card 그리드 안에서 border-r 구분선으로 이어지는 칸.
 * .ms-eyebrow 라벨 + 큰 숫자(text-2xl). 지원자 헤더·홈 현황 요약에 쓴다.
 * tone: 경고성 수치(검토 대기·동일소속)는 warning, 제척은 danger, 긍정 수치는 success.
 * index: 그리드 내 순서 — 진입 애니메이션 딜레이(40ms 간격)에 사용.
 * className: 부모 그리드가 반응형 칸 구분선(border-r/border-b)을 주입.
 */
export function StatCell({
  value,
  label,
  detail,
  tone,
  index = 0,
  className = '',
}: {
  value: number | string;
  label: string;
  detail?: ReactNode;
  tone?: 'warning' | 'success' | 'danger';
  index?: number;
  className?: string;
}) {
  const toneCls =
    tone === 'warning'
      ? 'text-warning'
      : tone === 'success'
        ? 'text-success'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-fg';
  return (
    <div
      className={`ms-stat flex flex-col px-5 py-4 ${className}`}
      style={{ animationDelay: `${index * 50}ms` } as CSSProperties}
    >
      {/* 라벨(캡션) 먼저 — 맥락 제시 후 숫자를 읽도록. 토스식 위계. */}
      <p className="ms-eyebrow">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums leading-none tracking-tight ${toneCls}`}
      >
        {value}
      </p>
      {detail && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-fg-subtle">{detail}</p>}
    </div>
  );
}
