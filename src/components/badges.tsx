import { ROLE_LABELS_KO, type ReviewStatus, type Role } from '@/lib/domain';

/**
 * 미확인(needsHuman)일 때만 배지 표시. 자동 통과는 배지 없음 — 80% 해피패스에 시각 노이즈 제거.
 * 제척·동일소속 등 실제 신호가 있는 배지가 먼저 눈에 들어오도록 색 계층을 정리.
 */
export function ConfidenceBadge({ needsHuman }: { needsHuman: boolean }) {
  if (!needsHuman) return null;
  return <span className="seed-badge-warning">미확인</span>;
}

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '대기',
  confirmed: '확정',
  rejected: '제외',
  edited: '수정됨',
};

/**
 * pending → 렌더 없음(ConfidenceBadge가 담당).
 * confirmed → neutral(그린은 실제 문제 신호용으로 예약).
 * rejected → danger. edited → neutral.
 */
export function FinalStatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'pending') return null;
  const cls =
    status === 'rejected'
      ? 'seed-badge-danger'
      : 'seed-badge-neutral';
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

/**
 * compact=true(테이블 기본): 역할을 "·" 구분 텍스트로 — 박스 배지 제거로 시각 밀도 완화.
 * compact=false(기타): 기존 박스 배지 스타일 유지.
 */
export function RoleBadges({ roles, compact = true }: { roles: Role[]; compact?: boolean }) {
  if (compact) {
    return (
      <span className="text-xs text-fg-muted">
        {roles.map((r) => ROLE_LABELS_KO[r]).join(' · ')}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className="seed-badge-neutral">
          {ROLE_LABELS_KO[r]}
        </span>
      ))}
    </span>
  );
}
