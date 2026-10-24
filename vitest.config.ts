import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

const src = (dir: string) => resolve(__dirname, 'src', dir);

export default defineConfig({
  resolve: {
    alias: {
      '@api': src('api'),
      '@cache': src('cache'),
      '@config': src('config'),
      '@exceptions': src('exceptions'),
      '@libs': src('libs'),
      '@utils': src('utils'),
      '@validate': src('validate'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    sequence: { shuffle: true },
  },
});
