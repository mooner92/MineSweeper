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
    ],
  },
  // Type safety is enforced via `npm run typecheck`; ESLint is run separately so a missing
  // lint config never blocks `next build` in a fresh clone.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
