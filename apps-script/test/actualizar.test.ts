import { describe, expect, it } from 'vitest'
import { actualizarCodigo, ultimaActualizacion, type PuertosActualizar, type RespuestaSimple } from '../src/actualizar.ts'

const CODIGO = '// Generado por apps-script/build.mjs: no editar a mano. Código fuente en github.com/robinszuniga/precios-mercado\nfunction doPost(e) {}'

type Llamada = { metodo: string; ruta: string; cuerpo?: unknown }

function puertos(opciones: {
  version?: string
  permisos?: string[]
  codigo?: string
  api403?: boolean
  implementaciones?: unknown[]
} = {}) {
  const llamadas: Llamada[] = []
  const props = new Map<string, string>()
  const ok = (v: unknown): RespuestaSimple => ({ status: 200, texto: JSON.stringify(v) })
  const p: PuertosActualizar = {
    scriptId: 'SCRIPT',
    descargar: (url) => {
      if (url.endsWith('/version.json')) return ok({ version: opciones.version ?? 'gas-v2', permisos: opciones.permisos ?? [] })
      if (url.endsWith('/Code.js')) return { status: 200, texto: opciones.codigo ?? CODIGO }
      if (url.endsWith('/appsscript.json')) return ok({ timeZone: 'America/Bogota' })
      return { status: 404, texto: '' }
    },
    api: (metodo, ruta, cuerpo) => {
      llamadas.push({ metodo, ruta, cuerpo })
      if (opciones.api403) return { status: 403, texto: '{"error":{"message":"User has not enabled the Apps Script API."}}' }
      if (metodo === 'get' && ruta.endsWith('/content')) {
        return ok({ files: [{ name: 'Código', type: 'SERVER_JS', source: 'viejo' }, { name: 'otro', type: 'SERVER_JS', source: 'copia vieja' }, { name: 'appsscript', type: 'JSON', source: '{}' }, { name: 'ayuda', type: 'HTML', source: '<p>' }] })
      }
      if (metodo === 'post' && ruta.endsWith('/versions')) return ok({ versionNumber: 7 })
      if (metodo === 'get' && ruta.endsWith('/deployments')) {
        return ok({ deployments: opciones.implementaciones ?? [
          { deploymentId: 'HEAD', deploymentConfig: {} },
          { deploymentId: 'WEB', deploymentConfig: { versionNumber: 3 }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
          { deploymentId: 'LIB', deploymentConfig: { versionNumber: 2 }, entryPoints: [{ entryPointType: 'EXECUTION_API' }] },
        ] })
      }
      return ok({})
    },
    props: { get: (k) => props.get(k) ?? null, set: (k, v) => { props.set(k, v) }, borrar: (k) => { props.delete(k) } },
    ahora: () => '2026-09-28T06:05:00.000-05:00',
  }
  return { p, llamadas, props }
}

describe('actualización automática del script', () => {
  it('instala la versión nueva: un solo archivo de código con su nombre, conserva los HTML, crea versión y mueve solo la app web', () => {
    const { p, llamadas } = puertos()
    const r = actualizarCodigo(p)
    expect(r).toMatchObject({ estado: 'actualizado', actual: 'dev', nueva: 'gas-v2' })
    const put = llamadas.find((l) => l.metodo === 'put' && l.ruta === '/SCRIPT/content')!
    expect((put.cuerpo as { files: { name: string; type: string; source: string }[] }).files.map((f) => [f.name, f.type])).toEqual([
      ['Código', 'SERVER_JS'], ['appsscript', 'JSON'], ['ayuda', 'HTML'],
    ])
    const implementaciones = llamadas.filter((l) => l.metodo === 'put' && l.ruta.includes('/deployments/'))
    expect(implementaciones.map((l) => l.ruta)).toEqual(['/SCRIPT/deployments/WEB'])
    expect(implementaciones[0].cuerpo).toMatchObject({ deploymentConfig: { versionNumber: 7, manifestFileName: 'appsscript' } })
    expect(ultimaActualizacion(p.props)?.estado).toBe('actualizado')
  })

  it('si ya está en la última versión no toca nada', () => {
    const { p, llamadas } = puertos({ version: 'dev' })
    expect(actualizarCodigo(p).estado).toBe('al_dia')
    expect(llamadas).toHaveLength(0)
  })

  it('una versión que pide permisos nuevos no se instala sola; desde el editor sí', () => {
    const conPermisos = { permisos: ['https://www.googleapis.com/auth/drive'] }
    const solo = puertos(conPermisos)
    expect(actualizarCodigo(solo.p).estado).toBe('necesita_permiso')
    expect(solo.llamadas).toHaveLength(0)
    const editor = puertos(conPermisos)
    expect(actualizarCodigo(editor.p, { desdeEditor: true }).estado).toBe('actualizado')
  })

  it('un archivo que no es de esta app (página de error, otro código) no reemplaza nada', () => {
    const { p, llamadas } = puertos({ codigo: '<html>Not Found</html>' })
    const r = actualizarCodigo(p)
    expect(r.estado).toBe('error')
    expect(llamadas.some((l) => l.metodo === 'put')).toBe(false)
  })

  it('con la API de Apps Script apagada dice exactamente qué activar', () => {
    const { p } = puertos({ api403: true })
    const r = actualizarCodigo(p)
    expect(r.estado).toBe('api_apagada')
    expect(r.mensaje).toContain('script.google.com/home/usersettings')
  })
})
