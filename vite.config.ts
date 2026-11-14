import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev proxy for the Cloudflare Worker (`npm run dev:copilot`,
    // Cloudflare Wrangler on 127.0.0.1:8787) which handles Copilot AI and
    // NASA MEDA environmental archive queries server-side.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
