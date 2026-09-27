import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const shared = fileURLToPath(new URL('./shared/src', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'shared', environment: 'node', include: ['shared/test/**/*.test.ts'] },
      },
      {
        test: { name: 'apps-script', environment: 'node', include: ['apps-script/test/**/*.test.ts'] },
      },
      {
        resolve: { alias: { '@shared': shared } },
        define: { __VERSION__: JSON.stringify('test') },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['web/src/test-setup.ts'],
        },
      },
    ],
  },
})
