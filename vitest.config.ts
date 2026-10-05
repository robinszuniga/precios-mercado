import { configDefaults, defineConfig } from 'vitest/config'
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
          exclude: [...configDefaults.exclude, 'web/src/**/*.integracion.test.ts'],
          setupFiles: ['web/src/test-setup.ts'],
          // jsdom + IndexedDB falso tardan en los servidores del CI: las esperas largas no deben cortar la prueba.
          testTimeout: 20_000,
        },
      },
      {
        // Integración con un Postgres de verdad (PGlite). Usa mucho procesador: corre aparte y después del resto
        // (`npm test` las encadena), porque a la vez le quita tiempo a las pruebas de interfaz, que miden ventanas de 1 s.
        resolve: { alias: { '@shared': shared } },
        define: { __VERSION__: JSON.stringify('test') },
        test: {
          name: 'integracion',
          environment: 'node',
          include: ['web/src/**/*.integracion.test.ts'],
          setupFiles: ['web/src/test-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
