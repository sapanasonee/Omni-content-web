 /** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      allowedOrigins: ['omni-content-web-441385652994.us-central1.run.app'],
    },
  },
}
export default nextConfig