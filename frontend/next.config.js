/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allows Next dev server to accept requests to /_next/* coming from a Cloudflare Tunnel origin.
  // Example warning: auto-*.trycloudflare.com -> /_next/*
  allowedDevOrigins: ['*.trycloudflare.com']
};

module.exports = nextConfig;
