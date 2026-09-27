import type { Props } from './puertos.ts'
import { PERMISOS_CODIGO, VERSION_CODIGO } from './version.ts'

/**
 * El script se actualiza desde los releases de GitHub (solo lo que se marcó como versión lista, nunca un cambio a
 * medias): baja el Code.js, reemplaza el código del proyecto, crea una versión y mueve la implementación de la
 * aplicación web a esa versión. La URL /exec y el token no cambian. Si la versión nueva pide permisos que el
 * usuario no ha dado, no se instala sola: la instala él desde el editor ("actualizarme") y Google le pregunta.
 */

export const REPO = 'robinszuniga/precios-mercado'
const BASE = `https://github.com/${REPO}/releases/latest/download`
export const API = 'https://script.googleapis.com/v1/projects'
const PROP = 'ACTUALIZACION'

export type EstadoActualizacion = 'al_dia' | 'actualizado' | 'necesita_permiso' | 'api_apagada' | 'error'

export interface ResultadoActualizacion {
  estado: EstadoActualizacion
  actual: string
  nueva: string | null
  mensaje: string
  fecha: string
}

export interface RespuestaSimple {
  status: number
  texto: string
}

/** Lo que el actualizador necesita del mundo (en Apps Script: UrlFetchApp con el token del propio script). */
export interface PuertosActualizar {
  scriptId: string
  descargar(url: string): RespuestaSimple
  api(metodo: 'get' | 'put' | 'post', ruta: string, cuerpo?: unknown): RespuestaSimple
  props: Props
  ahora(): string
}

interface ArchivoProyecto {
  name: string
  type: 'SERVER_JS' | 'JSON' | 'HTML'
  source: string
}

interface Implementacion {
  deploymentId: string
  deploymentConfig?: { versionNumber?: number; description?: string }
  entryPoints?: { entryPointType?: string }[]
}

class FallaApi extends Error {
  status: number
  constructor(status: number, mensaje: string) {
    super(mensaje)
    this.status = status
  }
}

function json<T>(r: RespuestaSimple, que: string): T {
  if (r.status < 200 || r.status >= 300) throw new FallaApi(r.status, `${que}: HTTP ${r.status} ${r.texto.slice(0, 200)}`)
  return JSON.parse(r.texto || '{}') as T
}

export function ultimaActualizacion(props: Props): ResultadoActualizacion | null {
  const v = props.get(PROP)
  if (!v) return null
  try { return JSON.parse(v) as ResultadoActualizacion } catch { return null }
}

/**
 * `desdeEditor`: la pidió el usuario (editor o botón de la app). Solo así se instala una versión que pide permisos
 * nuevos, porque Google se los pregunta en la siguiente ejecución desde el editor.
 */
export function actualizarCodigo(p: PuertosActualizar, opciones: { desdeEditor?: boolean } = {}): ResultadoActualizacion {
  const fin = (estado: EstadoActualizacion, nueva: string | null, mensaje: string): ResultadoActualizacion => {
    const r = { estado, actual: VERSION_CODIGO, nueva, mensaje, fecha: p.ahora() }
    p.props.set(PROP, JSON.stringify(r))
    return r
  }
  let nueva: string | null = null
  try {
    const info = json<{ version: string; permisos?: string[] }>(p.descargar(`${BASE}/version.json`), 'version.json')
    nueva = info.version
    if (!nueva || nueva === VERSION_CODIGO) return fin('al_dia', nueva, `Al día (${VERSION_CODIGO}).`)

    const faltan = (info.permisos ?? []).filter((x) => !PERMISOS_CODIGO.includes(x))
    if (faltan.length && !opciones.desdeEditor) {
      return fin('necesita_permiso', nueva, `La versión ${nueva} pide permisos nuevos: en Apps Script ejecuta "actualizarme" y acéptalos.`)
    }

    const codigo = p.descargar(`${BASE}/Code.js`)
    const manifiesto = p.descargar(`${BASE}/appsscript.json`)
    if (codigo.status !== 200 || manifiesto.status !== 200) throw new Error(`descarga: Code.js ${codigo.status}, appsscript.json ${manifiesto.status}`)
    // Que sea de verdad esta app y venga completo (una página de error no reemplaza el código).
    if (!codigo.texto.includes(REPO) || !/function doPost\(/.test(codigo.texto)) throw new Error('el Code.js descargado no parece de esta app')
    JSON.parse(manifiesto.texto)

    const contenido = json<{ files?: ArchivoProyecto[] }>(p.api('get', `/${p.scriptId}/content`), 'leer el proyecto')
    const actuales = contenido.files ?? []
    // Un solo archivo de código (con el nombre que ya tenía) y el manifiesto; los HTML se conservan.
    const nombre = actuales.find((f) => f.type === 'SERVER_JS')?.name ?? 'Código'
    const files: ArchivoProyecto[] = [
      { name: nombre, type: 'SERVER_JS', source: codigo.texto },
      { name: 'appsscript', type: 'JSON', source: manifiesto.texto },
      ...actuales.filter((f) => f.type === 'HTML'),
    ]
    json(p.api('put', `/${p.scriptId}/content`, { files }), 'guardar el código')

    const version = json<{ versionNumber: number }>(p.api('post', `/${p.scriptId}/versions`, { description: `precios-mercado ${nueva}` }), 'crear versión')
    const lista = json<{ deployments?: Implementacion[] }>(p.api('get', `/${p.scriptId}/deployments`), 'leer implementaciones')
    const web = (lista.deployments ?? []).filter((d) =>
      d.deploymentConfig?.versionNumber != null && (d.entryPoints ?? []).some((e) => e.entryPointType === 'WEB_APP'))
    for (const d of web) {
      json(p.api('put', `/${p.scriptId}/deployments/${d.deploymentId}`, {
        deploymentConfig: { scriptId: p.scriptId, versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: `precios-mercado ${nueva}` },
      }), 'actualizar la implementación')
    }
    return fin('actualizado', nueva, `Actualizado de ${VERSION_CODIGO} a ${nueva} (versión ${version.versionNumber}${web.length ? '' : ', sin aplicación web implementada'}).`)
  } catch (e) {
    if (e instanceof FallaApi && e.status === 403 && /Apps Script API|has not (been )?(used|enabled)|disabled/i.test(e.message)) {
      return fin('api_apagada', nueva, 'Falta activar la "API de Google Apps Script" en script.google.com/home/usersettings.')
    }
    return fin('error', nueva, e instanceof Error ? e.message : String(e))
  }
}
