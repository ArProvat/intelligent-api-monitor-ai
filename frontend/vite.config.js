import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: Object.fromEntries(['/monitor', '/alerts', '/health'].map(path => [path, process.env.DEV_BACKEND_URL || 'http://127.0.0.1:3000'])) },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.js'], css: false }
});
