import { ROLE_LABELS_KO, type ReviewStatus, type Role } from '@/lib/domain';

/** Green = auto-pass (printed/high-confidence); yellow = unverified (needs human). */
export function ConfidenceBadge({ needsHuman }: { needsHuman: boolean }) {
  return needsHuman ? (
    <span className="seed-badge-warning">미확인</span>
  ) : (
    <span className="seed-badge-success">자동 통과</span>
  );
}

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '대기',
  confirmed: '확정',
  rejected: '제외',
  edited: '수정됨',
};

export function FinalStatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'pending') return null;
  const cls =
    status === 'confirmed'
      ? 'seed-badge-success'
      : status === 'rejected'
        ? 'seed-badge-danger'
        : 'seed-badge-neutral';
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

export function RoleBadges({ roles }: { roles: Role[] }) {
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
