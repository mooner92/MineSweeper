'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { NameCandidate } from '@/lib/domain';

type Action = 'confirm' | 'exclude' | 'edit';

export function PersonActions({
  aggregateId,
  currentName,
  candidates = [],
}: {
  aggregateId: string;
  currentName: string;
  candidates?: NameCandidate[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: Action, name?: string): Promise<void> {
    setBusy(true);
    await fetch(`/api/persons/${aggregateId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, name }),
    });
    setBusy(false);
    router.refresh();
  }

  function onEdit(): void {
    const v = window.prompt('이름 수정', currentName);
    if (v === null) return;
    void act('edit', v);
  }

  const hasCandidates = candidates.length > 1;

  return (
    <div className="flex items-center gap-1.5">
      {hasCandidates ? (
        // Near-duplicate disambiguation: pick the correct reading (e.g. 이주영 vs 이조영).
        <select
          aria-label="이름 후보 선택"
          className="rounded-seed border border-stroke bg-bg px-2 py-1.5 text-sm"
          defaultValue={currentName}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value && e.target.value !== currentName) void act('edit', e.target.value);
          }}
        >
          {candidates.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      ) : (
        <button type="button" className="seed-btn-neutral" disabled={busy} onClick={onEdit}>
          수정
        </button>
      )}
      <button type="button" className="seed-btn-neutral" disabled={busy} onClick={() => act('confirm')}>
        확인
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
