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
    // Tell Vite the project root is "src".
    root: 'src',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins,
    build: {
      // Build output goes to ../dist relative to src (root-level dist).
      outDir: '../dist',
      emptyOutDir: true,
    },
  };
});
