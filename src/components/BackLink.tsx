'use client';

import { useRouter } from 'next/navigation';

/** Goes back in history, falling back to the home page when there is none. */
export function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
      className="seed-btn-ghost -ml-2 text-sm text-fg-muted"
    >
      ‹ 뒤로
    </button>
  );
}
