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
  // 'idle' | 'editing' | 'confirm-exclude' — 한 번에 하나의 보조 UI만 연다.
  const [mode, setMode] = useState<'idle' | 'editing' | 'confirm-exclude'>('idle');
  const [editValue, setEditValue] = useState(currentName);

  async function act(action: Action, name?: string): Promise<void> {
    setBusy(true);
    await fetch(`/api/persons/${aggregateId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, name }),
    });
    setBusy(false);
    setMode('idle');
    router.refresh();
  }

  function submitEdit(): void {
    const v = editValue.trim();
    if (!v || v === currentName) {
      setMode('idle');
      return;
    }
    void act('edit', v);
  }

  const hasCandidates = candidates.length > 1;

  // 인라인 이름 수정 (브라우저 prompt 대신 그 자리에서 입력·저장).
  if (mode === 'editing') {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          type="text"
          value={editValue}
          disabled={busy}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitEdit();
            if (e.key === 'Escape') setMode('idle');
          }}
          aria-label="이름 수정"
          className="seed-input w-32"
        />
        <button type="button" className="seed-btn-primary" disabled={busy} onClick={submitEdit}>
          저장
        </button>
        <button
          type="button"
          className="seed-btn-ghost"
          disabled={busy}
          onClick={() => setMode('idle')}
        >
          취소
        </button>
      </div>
    );
  }

  // 제외 전 한 번 더 확인 (실수 클릭 방지 — 명단에서 빠지는 동작이라 되돌리기 번거로움).
  if (mode === 'confirm-exclude') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-danger">명단에서 제외할까요?</span>
        <button
          type="button"
          className="seed-btn bg-danger text-fg-oncolor hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => act('exclude')}
        >
          제외
        </button>
        <button
          type="button"
          className="seed-btn-ghost"
          disabled={busy}
          onClick={() => setMode('idle')}
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {hasCandidates ? (
        // Near-duplicate disambiguation: pick the correct reading (e.g. 후보 중 선택).
        <select
          aria-label="이름 후보 선택"
          className="seed-input py-1.5"
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
        <button
          type="button"
          className="seed-btn-neutral"
          disabled={busy}
          onClick={() => {
            setEditValue(currentName);
            setMode('editing');
          }}
        >
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
        onClick={() => setMode('confirm-exclude')}
      >
        제외
      </button>
    </div>
  );
}
