import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const plugins = [react()];

  if (mode === 'analyze') {
    plugins.push(
      visualizer({
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        emitFile: true,
        filename: 'stats.html',
        open: true,
      }),
    );
  }

  return {
    // говорим Vite, что корень проекта — src
    root: 'src',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins,
    build: {
      // а билдить нужно в ../dist относительно src → в корневую dist
      outDir: '../dist',
      emptyOutDir: true,
    },
  };
});
