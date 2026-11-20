import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fairway/sdk', '@fairway/scoring', '@fairway/parser', '@fairway/fixtures', '@fairway/sim'],
  typedRoutes: false,
};

export default config;
