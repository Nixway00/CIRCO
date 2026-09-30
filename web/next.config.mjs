/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // the 3D stage must always be fresh after a deploy
  async headers() {
    return [{ source: '/stage/:path*', headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }] }];
  },
};
