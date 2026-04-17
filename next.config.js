/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['undici'],
  webpack: (config) => {
    config.externals = [...(config.externals || []), { 'undici': 'commonjs undici' }]
    return config
  },
}

module.exports = nextConfig
