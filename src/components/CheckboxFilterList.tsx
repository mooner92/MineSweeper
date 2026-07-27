'use client';

/**
 * 재사용 체크박스 필터 리스트 — 카드형(제목 + 모두 선택/해제 + 세로 체크박스 목록). 좌측 사이드바
 * 공용 컴포넌트. 회차 뷰의 '대조할 지원자' 등 다른 화면과 동일한 필터 관례를 맞추기 위한 추출.
 */

export interface CheckboxItem {
  id: string;
  label: string;
  /** 우측 보조 텍스트(예: 처리 상태) — 있으면 앰버로 표시. */
  note?: string;
}

export function CheckboxFilterList({
  title,
  items,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  maxHeightClass = 'max-h-[24rem]',
  emptyText = '항목이 없습니다.',
}: {
  title: string;
  items: CheckboxItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  maxHeightClass?: string;
  emptyText?: string;
}) {
  return (
    <div className="seed-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="ms-eyebrow">{title}</h2>
        <span className="text-xs text-fg-subtle">
          {selected.size}/{items.length}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
        <button type="button" onClick={onSelectAll} className="text-accent hover:underline">
          모두 선택
        </button>
        <span className="text-fg-subtle">·</span>
        <button type="button" onClick={onClear} className="text-fg-muted hover:underline">
          해제
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-fg-subtle">{emptyText}</p>
      ) : (
        <ul className={`mt-2 ${maxHeightClass} space-y-0.5 overflow-y-auto`}>
          {items.map((it) => {
            const active = selected.has(it.id);
            return (
              <li key={it.id}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-seed px-2 py-1.5 text-sm transition-colors ${
                    active ? 'bg-accent-subtle text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onToggle(it.id)}
                    className="size-3.5 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.note && <span className="shrink-0 text-[11px] text-warning">{it.note}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
