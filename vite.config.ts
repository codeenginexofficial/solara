import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import { cloudflare } from "@cloudflare/vite-plugin";

const cesiumStaticDirectories = ['ThirdParty', 'Workers', 'Assets', 'Widgets'];

// https://vite.dev/config/
export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
  },
  plugins: [react(), tailwindcss(), viteStaticCopy({
    targets: cesiumStaticDirectories.map((directory) => ({
      src: `node_modules/cesium/Build/Cesium/${directory}`,
      dest: 'cesium',
      rename: { stripBase: 4 },
    })),
  }), cloudflare()],
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