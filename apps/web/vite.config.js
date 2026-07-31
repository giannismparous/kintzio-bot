import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kintzio/chat-widget': path.resolve(
        __dirname,
        '../../packages/chat-widget/src/index.jsx'
      ),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['framer-motion'],
  },
});
