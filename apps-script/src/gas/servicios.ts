import { isoBogota } from '../../../shared/src/fechas.ts'
import { Ocupado, type Http, type PeticionHttp, type RespuestaHttp, type Servicios, type Triggers } from '../puertos.ts'
import { actualizarCodigo } from '../actualizar.ts'
import { puertosActualizarGas } from './actualizarGas.ts'
import { HojaRepo } from './hojaRepo.ts'

const UNA_VEZ = 'continuarPrecios'
const DIARIO = 'tareaDiaria'

function setCookieDe(r: GoogleAppsScript.URL_Fetch.HTTPResponse): string[] {
  const h = r.getAllHeaders() as Record<string, string | string[]>
  const v = h['Set-Cookie'] ?? h['set-cookie']
  return Array.isArray(v) ? v : v ? [v] : []
}

/** El único archivo que toca UrlFetchApp. Nunca lanza por códigos HTTP. */
export const httpGas: Http = {
  todas(peticiones: readonly PeticionHttp[]): RespuestaHttp[] {
    if (!peticiones.length) return []
    const reqs = peticiones.map((p) => ({
      url: p.url,
      headers: p.cabeceras ?? {},
      muteHttpExceptions: true,
      followRedirects: true,
    }))
    const convertir = (r: GoogleAppsScript.URL_Fetch.HTTPResponse): RespuestaHttp => ({
      status: r.getResponseCode(),
      cuerpo: r.getContentText('UTF-8'),
      setCookie: setCookieDe(r),
    })
    try {
      return UrlFetchApp.fetchAll(reqs).map(convertir)
    } catch {
      // fetchAll falla entero si una sola URL no responde (DNS, timeout): se repite de a una.
      return reqs.map((r) => {
        try {
          return convertir(UrlFetchApp.fetch(r.url, r))
        } catch (e) {
          return { status: 0, cuerpo: String(e), setCookie: [] }
        }
      })
    }
  },
}

export const triggersGas: Triggers = {
  unaVez(ms: number) {
    triggersGas.borrarUnaVez()
    ScriptApp.newTrigger(UNA_VEZ).timeBased().after(ms).create()
  },
  borrarUnaVez() {
    for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === UNA_VEZ) ScriptApp.deleteTrigger(t)
  },
  asegurarDiario(hora: number) {
    const hay = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === DIARIO)
    if (!hay) ScriptApp.newTrigger(DIARIO).timeBased().everyDays(1).atHour(hora).inTimezone('America/Bogota').create()
  },
  listar() {
    return ScriptApp.getProjectTriggers().map((t) => `${t.getHandlerFunction()} (${t.getEventType()})`)
  },
}

export function abrirHoja(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  if (id) return SpreadsheetApp.openById(id)
  const activa = SpreadsheetApp.getActiveSpreadsheet()
  if (!activa) throw new Error('No encuentro el Sheet: ejecuta inicializarHoja desde el editor del Sheet')
  return activa
}

export function serviciosGas(): Servicios {
  const props = PropertiesService.getScriptProperties()
  const cache = CacheService.getScriptCache()
  let repo: HojaRepo | null = null
  return {
    // Se abre al primer uso: así el ping (GET) responde aunque el proyecto todavía no tenga Sheet.
    get repo() {
      repo ??= new HojaRepo(abrirHoja())
      return repo
    },
    http: httpGas,
    lock: {
      con<T>(ms: number, fn: () => T): T {
        const lock = LockService.getScriptLock()
        try {
          lock.waitLock(ms)
        } catch {
          throw new Ocupado()
        }
        // Lo leído antes del lock puede estar viejo (otra ejecución escribió mientras tanto).
        repo?.refrescar()
        try {
          const r = fn()
          SpreadsheetApp.flush()
          return r
        } finally {
          lock.releaseLock()
        }
      },
    },
    cache: {
      get: (k) => cache.get(k),
      put: (k, v, s) => cache.put(k, v, s),
    },
    props: {
      get: (k) => props.getProperty(k),
      set: (k, v) => { props.setProperty(k, v) },
      borrar: (k) => { props.deleteProperty(k) },
    },
    reloj: {
      ahora: () => isoBogota(Date.now()),
      ms: () => Date.now(),
      dormir: (ms) => Utilities.sleep(ms),
    },
    triggers: triggersGas,
    uuid: () => Utilities.getUuid(),
    log: (m) => console.log(m),
    proyecto: () => ScriptApp.getScriptId().slice(-6),
    actualizar: (opciones) => actualizarCodigo(puertosActualizarGas(), opciones),
  }
}
