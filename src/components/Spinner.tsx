/** 회전 스피너 — 추출/로딩 진행 표시. 크기·색은 className으로 (예: "h-4 w-4 text-accent"). */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="진행 중"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
