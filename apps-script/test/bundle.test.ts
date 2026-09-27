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

// ── Cargador: lo único pegado en Apps Script. Se prueba con un Google falso y el Code.js real. ────────────────

interface Estado {
  props: Map<string, string>
  cache: Map<string, string>
  release: { version: string; permisos?: string[]; codigo: string } | null
  bajadas: string[]
}

const MANIFIESTO = JSON.parse(readFileSync(`${dir}appsscript.json`, 'utf8')) as { oauthScopes: string[] }
const CARGADOR = readFileSync(`${dir}cargador/Cargador.js`, 'utf8')
const MINI = '// github.com/robinszuniga/precios-mercado\nvar __app = { doGet: function () { return "mini" }, doPost: function () { return "mini" } }\nfunction doPost(e) {}'

/** Una ejecución de Apps Script: contexto nuevo, pero propiedades y caché compartidas entre ejecuciones. */
function ejecucion(e: Estado, codigoSuelto?: string) {
  const bytes = (v: string) => new TextEncoder().encode(v).length
  const guardar = (k: string, v: string) => {
    if (bytes(v) > 9 * 1024) throw new Error(`Argumento demasiado grande: ${k}`)
    e.props.set(k, String(v))
  }
  const ctx: Record<string, unknown> = {
    console: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.fromEntries(e.props),
        getProperty: (k: string) => e.props.get(k) ?? null,
        setProperty: guardar,
        setProperties: (o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) guardar(k, v) },
        deleteProperty: (k: string) => { e.props.delete(k) },
      }),
    },
    CacheService: { getScriptCache: () => ({ get: (k: string) => e.cache.get(k) ?? null, put: (k: string, v: string) => { e.cache.set(k, v) } }) },
    UrlFetchApp: {
      fetch: (url: string) => {
        const archivo = url.split('/').pop()!
        e.bajadas.push(archivo)
        const r = e.release
        const cuerpo = !r ? null : archivo === 'version.json' ? JSON.stringify({ version: r.version, permisos: r.permisos ?? MANIFIESTO.oauthScopes }) : archivo === 'Code.js' ? r.codigo : null
        return { getResponseCode: () => (cuerpo == null ? 404 : 200), getContentText: () => cuerpo ?? 'Not Found' }
      },
    },
    ContentService: { createTextOutput: (t: string) => ({ t, setMimeType() { return this } }), MimeType: { JSON: 'json' } },
    ScriptApp: { getScriptId: () => 'SCRIPT-abc123' },
  }
  vm.createContext(ctx)
  vm.runInContext(codigoSuelto ?? CARGADOR, ctx)
  return ctx as Record<string, (...a: unknown[]) => unknown>
}

const ping = (x: unknown) => JSON.parse((x as { t: string }).t)

describe('cargador del script', () => {
  let codigo = ''
  beforeAll(() => {
    codigo = readFileSync(`${dir}dist/Code.js`, 'utf8')
  })
  const nuevo = (release: Estado['release']): Estado => ({ props: new Map([['TOKEN', 'secreto']]), cache: new Map(), release, bajadas: [] })

  it('la primera vez baja el código, lo guarda en trozos de menos de 9 kB y responde con la app real', () => {
    const e = nuevo({ version: 'gas-v9', codigo })
    const r = ping(ejecucion(e).doGet({}))
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ app: 'precios-mercado', configurado: true, cargador: 1, proyecto: 'abc123' })
    expect(e.bajadas).toEqual(['version.json', 'Code.js'])
    expect(JSON.parse(e.props.get('PM_CODIGO')!)).toMatchObject({ version: 'gas-v9', largo: codigo.length })
    expect(JSON.parse(e.props.get('ACTUALIZACION')!)).toMatchObject({ estado: 'actualizado', nueva: 'gas-v9' })
  })

  it('las siguientes ejecuciones usan lo guardado sin bajar nada; tras 6 horas solo miran version.json', () => {
    const e = nuevo({ version: 'gas-v9', codigo })
    ejecucion(e).doGet({})
    e.bajadas = []
    expect(ping(ejecucion(e).doGet({})).ok).toBe(true)
    ejecucion(e).onEdit({})
    expect(e.bajadas).toEqual([])
    e.cache.clear()
    expect(ping(ejecucion(e).doGet({})).ok).toBe(true)
    expect(e.bajadas).toEqual(['version.json'])
    expect(JSON.parse(e.props.get('ACTUALIZACION')!).estado).toBe('al_dia')
  })

  it('una versión nueva se instala sola al revisar, y deja limpios los trozos que sobran', () => {
    const e = nuevo({ version: 'gas-v9', codigo })
    ejecucion(e).doGet({})
    e.release = { version: 'gas-v10', codigo: MINI }
    e.cache.clear()
    ejecucion(e).doGet({}) // revisa, instala y ya responde con la nueva
    expect(ejecucion(e).doGet({})).toBe('mini')
    expect([...e.props.keys()].filter((k) => k.startsWith('PM_CODIGO_'))).toEqual(['PM_CODIGO_0'])
    expect(JSON.parse(e.props.get('ACTUALIZACION')!)).toMatchObject({ estado: 'actualizado', actual: 'gas-v9', nueva: 'gas-v10' })
  })

  it('"Actualizar ahora" desde la app pasa por el cargador', () => {
    const e = nuevo({ version: 'gas-v9', codigo })
    ejecucion(e).doGet({})
    e.release = { version: 'gas-v10', codigo }
    const r = ping(ejecucion(e).doPost({ postData: { contents: JSON.stringify({ a: 'actualizarScript', t: 'secreto', v: 1 }) } }))
    expect(r.data).toMatchObject({ estado: 'actualizado', actual: 'gas-v9', nueva: 'gas-v10', cargador: 1 })
  })

  it('un Code.js roto o ajeno no reemplaza al que funciona', () => {
    const e = nuevo({ version: 'gas-v9', codigo })
    ejecucion(e).doGet({})
    for (const malo of ['<html>GitHub caído</html>', `${MINI}\n}{ roto`, '// github.com/robinszuniga/precios-mercado\nfunction doPost(e) {}']) {
      e.release = { version: 'gas-v10', codigo: malo }
      const r = ejecucion(e).actualizarme() as { estado: string }
      expect(r.estado).toBe('error')
      expect(JSON.parse(e.props.get('PM_CODIGO')!).version).toBe('gas-v9')
      expect(ping(ejecucion(e).doGet({})).ok).toBe(true)
    }
  })

  it('una versión que pide permisos nuevos no se instala sola', () => {
    const e = nuevo({ version: 'gas-v9', codigo })
    ejecucion(e).doGet({})
    e.release = { version: 'gas-v10', codigo, permisos: [...MANIFIESTO.oauthScopes, 'https://www.googleapis.com/auth/gmail.send'] }
    expect(ejecucion(e).actualizarme()).toMatchObject({ estado: 'necesita_permiso', nueva: 'gas-v10' })
    expect(JSON.parse(e.props.get('PM_CODIGO')!).version).toBe('gas-v9')
  })

  it('sin código guardado y sin GitHub, la app recibe un error en JSON (no una página de Google)', () => {
    const e = nuevo(null)
    const r = ping(ejecucion(e).doGet({}))
    expect(r).toMatchObject({ ok: false, error: { codigo: 'interno' } })
    expect(r.error.mensaje).toMatch(/No se pudo bajar el código/)
    expect(ejecucion(e).onEdit({})).toBeUndefined()
    expect(e.bajadas).toEqual(['version.json'])
  })

  it('con el Code.js pegado completo (sin cargador) dice que falta el cargador', () => {
    const e = nuevo(null)
    const r = ejecucion(e, codigo).actualizarme() as { estado: string; mensaje: string }
    expect(r.estado).toBe('sin_cargador')
    expect(r.mensaje).toMatch(/Cargador\.js/)
  })

  it('declara las mismas funciones que el Code.js y los mismos permisos que appsscript.json', () => {
    const globales = JSON.parse(/const GLOBALES = (\[[^\]]+\])/.exec(readFileSync(`${dir}build.mjs`, 'utf8'))![1].replace(/'/g, '"')) as string[]
    const ctx = ejecucion(nuevo(null))
    for (const f of globales) expect(typeof ctx[f], f).toBe('function')
    expect(ctx.PM_PERMISOS).toEqual(MANIFIESTO.oauthScopes)
  })
})
