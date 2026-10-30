/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The whole app runs in the browser (geometry, STL, ZIP and storage are all client-side),
  // so it is exported as plain static files into ./out. That works on Netlify (or any static
  // host) without serverless functions, and needs no environment variables.
  output: 'export',
  images: { unoptimized: true },
};

module.exports = nextConfig;
