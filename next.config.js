/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client'],
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
}

module.exports = nextConfig
