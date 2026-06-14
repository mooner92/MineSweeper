'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from './Spinner';

/**
 * 추출 진행 배지 + 자동 갱신. 추출이 도는 동안 스피너를 보여주고, 일정 간격으로 서버 컴포넌트를
 * 다시 불러(`router.refresh()`) 결과가 채워지는 걸 인사팀이 수동 새로고침 없이 본다. 완료되면
 * `running=false`로 바뀌며 폴링이 멈춘다. 멈추지 않는 잡(stuck) 대비 ~10분 안전 상한.
 */
export function RunningIndicator({ running }: { running: boolean }) {
  const router = useRouter();
  const ticks = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      ticks.current += 1;
      if (ticks.current > 150) {
        clearInterval(id); // 안전장치: ~10분(4s×150) 후 자동 폴링 중단
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [running, router]);

  if (!running) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-info-subtle px-2.5 py-1 text-xs font-medium text-info">
      <Spinner className="h-3 w-3" />
      추출 중…
    </span>
  );
}
