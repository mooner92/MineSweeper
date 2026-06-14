import type { CSSProperties, ReactNode } from 'react';

/**
 * 대시보드형 숫자 통계 셀 — 큰 숫자 + 라벨(+부가 설명). 지원자 헤더·홈 현황 요약에 쓴다.
 * tone: 경고성 수치(검토 대기·동일소속)는 warning, 긍정 수치는 success.
 * index: 그리드 내 순서 — 진입 애니메이션 딜레이(40ms 간격)에 사용.
 */
export function StatCell({
  value,
  label,
  detail,
  tone,
  index = 0,
}: {
  value: number | string;
  label: string;
  detail?: ReactNode;
  tone?: 'warning' | 'success' | 'danger';
  index?: number;
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
      className="seed-card ms-stat p-4"
      style={{ animationDelay: `${index * 50}ms` } as CSSProperties}
    >
      {/* 라벨(캡션) 먼저 — 맥락 제시 후 숫자를 읽도록. 토스식 위계. */}
      <p className="text-[11px] font-semibold tracking-wide text-fg-muted">{label}</p>
      <p className={`mt-1 text-3xl font-extrabold tabular-nums leading-none ${toneCls}`}>{value}</p>
      {detail && <p className="mt-1.5 truncate text-xs leading-relaxed text-fg-subtle">{detail}</p>}
    </div>
  );
}
