import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = new URL('../', import.meta.url).pathname

describe('bundle de Apps Script', () => {
  let codigo = ''
  beforeAll(() => {
    execFileSync(process.execPath, [`${dir}build.mjs`], { stdio: 'pipe' })
    codigo = readFileSync(`${dir}dist/Code.js`, 'utf8')
  })

  it('no trae import/export (Apps Script no usa módulos)', () => {
    expect(codigo).not.toMatch(/^\s*(import|export)\s/m)
  })

  it('declara las funciones globales que usan el editor, la web app y los triggers', () => {
    const ctx: Record<string, unknown> = { console }
    vm.createContext(ctx)
    vm.runInContext(codigo, ctx)
    for (const f of ['doGet', 'doPost', 'inicializarHoja', 'probarTiendas', 'autoprueba', 'tareaDiaria', 'continuarPrecios', 'onEdit']) {
      expect(typeof ctx[f], f).toBe('function')
    }
  })

  it('no depende de APIs que Apps Script no tiene', () => {
    expect(codigo).not.toMatch(/(?<![.\w$])(btoa|atob|Buffer|fetch|URLSearchParams|structuredClone|setTimeout)\(/)
  })
})
