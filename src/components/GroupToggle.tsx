'use client';

/** Expand/collapse every role group (<details data-role-group>) on the applicant page. */
export function GroupToggle() {
  function setAll(open: boolean): void {
    for (const d of document.querySelectorAll<HTMLDetailsElement>('details[data-role-group]')) {
      d.open = open;
    }
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="seed-btn-ghost px-2.5 py-1 text-xs"
        onClick={() => setAll(true)}
      >
        모두 펼치기
      </button>
      <span className="text-xs text-fg-subtle">·</span>
      <button
        type="button"
        className="seed-btn-ghost px-2.5 py-1 text-xs"
        onClick={() => setAll(false)}
      >
        모두 접기
      </button>
    </div>
  );
}
