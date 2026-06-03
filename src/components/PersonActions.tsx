'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Action = 'confirm' | 'exclude' | 'edit';

export function PersonActions({
  aggregateId,
  currentName,
}: {
  aggregateId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: Action): Promise<void> {
    let name: string | undefined;
    if (action === 'edit') {
      const v = window.prompt('이름 수정', currentName);
      if (v === null) return;
      name = v;
    }
    setBusy(true);
    await fetch(`/api/persons/${aggregateId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, name }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="seed-btn-neutral" disabled={busy} onClick={() => act('confirm')}>
        확인
      </button>
      <button type="button" className="seed-btn-neutral" disabled={busy} onClick={() => act('edit')}>
        수정
      </button>
      <button
        type="button"
        className="seed-btn-ghost text-danger"
        disabled={busy}
        onClick={() => act('exclude')}
      >
        제외
      </button>
    </div>
  );
}
