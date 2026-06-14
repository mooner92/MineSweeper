'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 지원자 카드 우상단 삭제 버튼. 카드 링크 위에 절대배치된 형제 버튼이라 클릭이 네비게이션과 섞이지
 * 않는다. 되돌릴 수 없는 동작이므로 확인을 받는다. 삭제 후 목록을 새로고침한다.
 */
export function DeleteApplicantButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (
      !window.confirm(
        `'${name}' 지원자를 삭제할까요?\n추출 결과·문서·검토 플래그·초빙 명단이 모두 지워지며 되돌릴 수 없습니다.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(`/api/applicants/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(String(r.status));
      router.refresh();
    } catch {
      setBusy(false);
      window.alert('삭제에 실패했습니다. 다시 시도해 주세요.');
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label={`${name} 삭제`}
      title="지원자 삭제"
      className="absolute right-2 top-2 z-10 rounded-seed px-1.5 py-0.5 text-xs text-fg-subtle opacity-0 transition-opacity hover:bg-danger-subtle hover:text-danger focus-visible:opacity-100 group-hover/card:opacity-100 disabled:opacity-50"
    >
      {busy ? '삭제 중…' : '✕ 삭제'}
    </button>
  );
}
