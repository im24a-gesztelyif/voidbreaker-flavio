import type { NextConfig } from 'next';

const staticExport =
  process.env.VOIDBREAKER_STATIC_EXPORT === '1' || process.env.VERCEL === '1';

const nextConfig: NextConfig = staticExport ? { output: 'export' } : {};

export default nextConfig;
