import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://dbpaw.dev',
  integrations: [sitemap()],
  redirects: {
    '/features': { status: 301, destination: '/' },
    '/faq': { status: 301, destination: '/' },
    '/download': { status: 301, destination: '/' }
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }
});
