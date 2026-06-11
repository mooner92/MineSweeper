/**
 * data/ 백업 — DB는 SQLite `VACUUM INTO`로 온라인 일관 스냅샷(서비스 중단 없음), 보존 개수 초과분은
 * 오래된 것부터 삭제. 업로드 원본은 용량이 커서 기본 제외 — `--with-uploads`로 함께 복사.
 *
 *   npx tsx scripts/backup-data.ts                 # DB만 → data/backups/minesweeper-<ts>.db
 *   npx tsx scripts/backup-data.ts --with-uploads  # + data/uploads → data/backups/uploads/
 *
 * cron 예시(매일 03:00): 0 3 * * * cd /gits/MineSweeper && npx tsx scripts/backup-data.ts
 * 보존 개수: BACKUP_KEEP (기본 14개)
 *
 * ⚠ 같은 디스크에 남는 백업은 디스크 장애엔 무력 — 주기적으로 data/backups를 다른 장비로 복사할 것.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@libsql/client';

const DB_URL = process.env.DATABASE_URL ?? 'file:./data/minesweeper.db';
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/uploads';
const BACKUP_DIR = process.env.BACKUP_DIR ?? './data/backups';
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  if (!DB_URL.startsWith('file:')) {
    console.error(`백업은 파일 모드 DB만 지원합니다: ${DB_URL}`);
    process.exit(1);
  }
  mkdirSync(BACKUP_DIR, { recursive: true });

  // 1) DB 스냅샷 — VACUUM INTO는 실행 중인 커넥션과 안전하게 공존하는 일관 복사본을 만든다.
  const dest = resolve(BACKUP_DIR, `minesweeper-${ts()}.db`);
  const client = createClient({ url: DB_URL });
  await client.execute(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  client.close();
  const size = (statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(`DB 백업: ${dest} (${size}MB)`);

  // 2) 보존 개수 초과분 삭제(오래된 것부터).
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => /^minesweeper-.*\.db$/.test(f))
    .sort();
  for (const f of backups.slice(0, Math.max(0, backups.length - KEEP))) {
    unlinkSync(join(BACKUP_DIR, f));
    console.log(`보존 기간 초과 삭제: ${f}`);
  }

  // 3) (선택) 업로드 원본 동기화 복사.
  if (process.argv.includes('--with-uploads') && existsSync(UPLOAD_DIR)) {
    const upDest = join(BACKUP_DIR, 'uploads');
    cpSync(UPLOAD_DIR, upDest, { recursive: true, force: true });
    console.log(`업로드 원본 복사: ${UPLOAD_DIR} → ${upDest}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
