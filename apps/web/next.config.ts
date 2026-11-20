import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fairway/sdk', '@fairway/scoring', '@fairway/parser', '@fairway/fixtures', '@fairway/sim'],
  typedRoutes: false,
  // the server reads these files by computed path at runtime (the real-data snapshot, fixtures and sim outputs), so tell the
  // file tracer to ship them with the serverless functions (needed on Vercel, where there is no backend)
  outputFileTracingRoot: join(here, '..', '..'),
  outputFileTracingIncludes: {
    '/**': ['./data/**', '../../packages/fixtures/data/**', '../../packages/sim/out/**'],
  },
};

export default config;
