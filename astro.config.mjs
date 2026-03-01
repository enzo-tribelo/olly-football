// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://aibot-tribelo.github.io',
  base: '/olly-football',
  vite: {
    plugins: [tailwindcss()]
  }
});
