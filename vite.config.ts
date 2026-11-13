import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev proxy for the Mission Copilot: the Worker (`npm run dev:copilot`,
    // Cloudflare Wrangler on 127.0.0.1:8787) holds the OpenRouter key
    // server-side. The browser bundle never sees an API key.
    proxy: {
      '/api/copilot': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
