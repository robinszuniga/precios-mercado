// Empaqueta apps-script/src + shared en un único dist/Code.js sin import/export (Apps Script no usa módulos).
// Las funciones que ve el editor y los triggers se declaran al final como funciones globales.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

const GLOBALES = ['doGet', 'doPost', 'inicializarHoja', 'probarTiendas', 'autoprueba', 'tareaDiaria', 'continuarPrecios', 'onEdit']
const dir = new URL('.', import.meta.url).pathname

mkdirSync(`${dir}dist`, { recursive: true })
await build({
  entryPoints: [`${dir}src/index.ts`],
  outfile: `${dir}dist/Code.js`,
  bundle: true,
  format: 'iife',
  globalName: '__app',
  target: 'es2019',
  platform: 'neutral',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: '// Generado por apps-script/build.mjs: no editar a mano. Código fuente en github.com/robinszuniga/precios-mercado' },
  footer: { js: GLOBALES.map((f) => `function ${f}(e) { return __app.${f}(e) }`).join('\n') },
})
copyFileSync(`${dir}appsscript.json`, `${dir}dist/appsscript.json`)
console.log('apps-script/dist/Code.js listo')
