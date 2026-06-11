// Fail fast when the session-signing secret is absent — otherwise the app boots fine and only
// breaks at the first login, which reads as "auth is broken" instead of "config is missing".
// (scripts/create-user.ts generates AUTH_SECRET into .env; Next loads .env before this file.)
const authSecret = process.env.AUTH_SECRET ?? '';
if (authSecret.length < 32) {
  const msg =
    'AUTH_SECRET이 없거나 너무 짧습니다(<32자). `npx tsx scripts/create-user.ts <id> <pw>` 로 생성하세요 (.env).';
  if (process.env.NODE_ENV === 'production') throw new Error(msg);
  console.warn(`[minesweeper] ${msg}`);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Native / server-only packages must not be bundled into the client or RSC graph.
  experimental: {
    serverComponentsExternalPackages: [
      '@libsql/client',
      'libsql',
      'pdfjs-dist',
      'exceljs',
      'adm-zip',
      'pdf-to-img',
      '@napi-rs/canvas',
    ],
  },
  // Type safety is enforced via `npm run typecheck`; ESLint is run separately so a missing
  // lint config never blocks `next build` in a fresh clone.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
