import { defineConfig } from 'vite';
import { resolve } from 'path';

// Two entry pages (EN + RU). base is './' so the build can be dropped into
// /next/ on GitHub Pages without knowing its absolute path.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ru: resolve(__dirname, 'ru/index.html'),
      },
    },
  },
});
