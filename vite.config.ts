import { defineConfig } from 'vite';

export default defineConfig({
  // relative paths: the same build works at the site root and under /Capy/ on GitHub Pages
  base: './',
  server: {
    // let the Cloudflare quick-tunnel address (something.trycloudflare.com) reach the dev server
    allowedHosts: ['.trycloudflare.com'],
  },
});
