import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applicants, reviewFlags } from '@/db/schema';
import { cleanupCaches } from '@/worker/cleanup';
import { freshDb } from './helpers/db';

const DAY = 24 * 60 * 60 * 1000;

function fileAgedDays(path: string, days: number, now: number): void {
  writeFileSync(path, 'png');
  const t = new Date(now - days * DAY);
  utimesSync(path, t, t);
}

describe('cleanupCaches', () => {
  it('ages out old renders, keeps fresh ones', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'ms-clean-'));
    mkdirSync(join(dir, 'renders'), { recursive: true });
    const now = Date.now();
    fileAgedDays(join(dir, 'renders', 'old.png'), 10, now); // > 7d TTL → 삭제
    fileAgedDays(join(dir, 'renders', 'fresh.png'), 1, now); // 유지

    const result = await cleanupCaches(db, dir, now);
    expect(result.renders).toBe(1);
    expect(existsSync(join(dir, 'renders', 'old.png'))).toBe(false);
    expect(existsSync(join(dir, 'renders', 'fresh.png'))).toBe(true);
  });

  it('removes only ORPHAN crops — referenced crops survive regardless of age', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'ms-clean-'));
    mkdirSync(join(dir, 'crops'), { recursive: true });
    const now = Date.now();
    const referenced = join(dir, 'crops', 'kept.png');
    const orphan = join(dir, 'crops', 'orphan.png');
    const young = join(dir, 'crops', 'young-orphan.png');
    fileAgedDays(referenced, 30, now);
    fileAgedDays(orphan, 30, now);
    fileAgedDays(young, 0, now); // 고아지만 1일 미만 → 보호(감지 작업과 경합 방지)

    await db.insert(applicants).values({ id: 'a1', name: '홍길동' });
    await db.insert(reviewFlags).values({
      applicantId: 'a1',
      flagType: 'seal',
      cropPath: referenced,
      status: 'open',
    });

    const result = await cleanupCaches(db, dir, now);
    expect(result.crops).toBe(1);
    expect(existsSync(referenced)).toBe(true); // 플래그가 참조 → 유지
    expect(existsSync(orphan)).toBe(false); // 고아 + 오래됨 → 삭제
    expect(existsSync(young)).toBe(true); // 고아지만 신선 → 유지
  });

  it('is a no-op when the cache dirs do not exist', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'ms-clean-empty-'));
    const result = await cleanupCaches(db, dir);
    expect(result).toEqual({ renders: 0, crops: 0 });
  });
});
