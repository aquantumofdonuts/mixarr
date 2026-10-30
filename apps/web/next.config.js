/** @type {import('next').NextConfig} */
const pkg = require('./package.json');
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  reactStrictMode: true,
  transpilePackages: ['@mixarr/shared-types', '@mixarr/ui'],
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },           // Spotify CDN
      { protocol: 'https', hostname: 'cdn-images.dzcdn.net' }, // Deezer CDN
      { protocol: 'https', hostname: 'e-cdns-images.dzcdn.net' }, // Deezer CDN alt
      { protocol: 'https', hostname: 'coverartarchive.org' },  // MusicBrainz
      { protocol: 'https', hostname: 'archive.org' },          // Archive.org (fallback)
      { protocol: 'https', hostname: 'lastfm.freetls.fastly.net' }, // Last.fm
      { protocol: 'https', hostname: '*.last.fm' },           // Last.fm alternative
    ],
  },
  // Disable build-time font optimization to prevent timeouts in slow CI builds (ARM64 emulation)
  // Fonts will still work correctly but will be fetched at runtime from Google instead of being inlined
  optimizeFonts: process.env.CI !== 'true',
  async rewrites() {
    // Bundled images use loopback; separate-container deployments set API_URL.
    const apiUrl = process.env.API_URL || 'http://127.0.0.1:3005';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
