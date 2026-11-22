// Standalone localhost config: serves the client without the Devvit/Reddit runtime.
// The game falls back to localStorage for profile, coins and leaderboard.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/client', import.meta.url));
const publicDir = fileURLToPath(new URL('./public', import.meta.url));

export default defineConfig({
  root,
  publicDir,
  server: { port: 5173, strictPort: true, open: false },
});
