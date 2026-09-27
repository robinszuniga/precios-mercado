// Empaqueta apps-script/src + shared en un único dist/Code.js sin import/export (Apps Script no usa módulos).
// Las funciones que ve el editor y los triggers se declaran al final como funciones globales.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const GLOBALES = ['doGet', 'doPost', 'inicializarHoja', 'probarTiendas', 'autoprueba', 'tareaDiaria', 'continuarPrecios', 'onEdit', 'actualizarme']
const dir = new URL('.', import.meta.url).pathname

mkdirSync(`${dir}dist`, { recursive: true })
// La versión sale de la etiqueta del release (gas-vN); en local o en el CI queda "dev".
const version = process.env.GAS_VERSION || 'dev'
const permisos = JSON.parse(readFileSync(`${dir}appsscript.json`, 'utf8')).oauthScopes ?? []
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
  define: { __VERSION_GAS__: JSON.stringify(version), __PERMISOS_GAS__: JSON.stringify(permisos) },
  banner: { js: '// Generado por apps-script/build.mjs: no editar a mano. Código fuente en github.com/robinszuniga/precios-mercado' },
  footer: { js: GLOBALES.map((f) => `function ${f}(e) { return __app.${f}(e) }`).join('\n') },
})
copyFileSync(`${dir}appsscript.json`, `${dir}dist/appsscript.json`)
// Lo que lee el actualizador del script para saber si hay algo nuevo y si pide permisos nuevos.
writeFileSync(`${dir}dist/version.json`, JSON.stringify({ version, permisos }, null, 2))
console.log(`apps-script/dist/Code.js listo (${version})`)
