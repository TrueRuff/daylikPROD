import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // чтобы собранная версия работала с file:// и из PWA-хостинга
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
