import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is the sub-path the site is served from, e.g. "/agent-dlc-workshop/" for
// https://<user>.github.io/agent-dlc-workshop/. Defaults to "/" for local dev.
function normalizeBase(b?: string): string {
  if (!b || b === '/') return '/';
  return `/${b.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [react()],
  // Keep Vite's own bundles out of dist/assets/, which holds the workshop downloads.
  build: { assetsDir: '_app', chunkSizeWarningLimit: 1600 },
});
