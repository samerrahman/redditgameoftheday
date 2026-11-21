import { defineConfig, type Plugin } from 'vite';
import { devvit } from '@devvit/start/vite';

function buildIdPlugin(): Plugin {
  const envBuildIds = new Map<string, string>();
  let seq = 0;

  return {
    name: 'dungeonle-build-id',
    buildStart() {
      const envName = this.environment?.name ?? 'default';
      seq += 1;
      envBuildIds.set(envName, `${envName}-${Date.now()}-${seq}`);
    },
    renderChunk(code) {
      if (!code.includes('__DUNGEONLE_BUILD_ID__')) {
        return null;
      }
      const envName = this.environment?.name ?? 'default';
      const stamped = envBuildIds.get(envName) ?? `${envName}-${Date.now()}`;
      return {
        code: code.replaceAll('__DUNGEONLE_BUILD_ID__', stamped),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [
    devvit({
      client: {
        build: {
          chunkSizeWarningLimit: 2000,
        },
      },
    }),
    buildIdPlugin(),
  ],
});
