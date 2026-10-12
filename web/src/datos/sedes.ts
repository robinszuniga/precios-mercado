import { claveSede, consultaOverpass, fusionarSedes, MAX_SEDES, sedesDeConfig, sedesDeOverpass, valorSede, type Punto, type Sede } from '@shared/mapa.ts'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { nuevoId } from './api.ts'
import { db } from './db.ts'
import { guardar, guardarConfig } from './escritura.ts'

/**
 * Cada sede es una fila de la configuración de la cuenta (clave `sede.<id>`): se sincroniza con la nube sin tablas nuevas,
 * y dos celulares que agregan sedes a la vez no se pisan (una fila por sede). Quitar una deja su valor vacío.
 */
async function leerSedes(): Promise<Sede[]> {
  return sedesDeConfig(await db.config.toArray())
}

/** Agrega una sede a mano (donde estás, o el punto que tocaste en el mapa). null si ya se llegó al máximo. */
export async function agregarSede(tienda: Tienda, punto: Punto, nombre?: string): Promise<Sede | null> {
  if ((await leerSedes()).length >= MAX_SEDES) return null
  const sede: Sede = { id: nuevoId(), tienda, nombre: nombre?.trim() || INFO_TIENDAS[tienda].nombre, lat: punto.lat, lng: punto.lng }
  await guardarConfig(claveSede(sede.id), valorSede(sede))
  return sede
}

/** Suma las sedes encontradas en OpenStreetMap; devuelve cuántas eran nuevas. */
export async function agregarSedesEncontradas(nuevas: readonly Sede[]): Promise<number> {
  const { agregadas } = fusionarSedes(await leerSedes(), nuevas)
  if (agregadas.length) await guardar('Config', agregadas.map((s) => ({ clave: claveSede(s.id), valor: valorSede(s) })))
  return agregadas.length
}

export async function quitarSede(id: string): Promise<Sede | undefined> {
  const quitada = (await leerSedes()).find((s) => s.id === id)
  if (quitada) await guardarConfig(claveSede(id), '')
  return quitada
}

/** Devuelve una sede quitada (el "Deshacer" del aviso). */
export async function restaurarSede(sede: Sede) {
  await guardarConfig(claveSede(sede.id), valorSede(sede))
}

/** Lo que responde Overpass cuando no pudo terminar la consulta: 200 con una nota ("remark") y sin resultados. */
const consultaIncompleta = (r: unknown) => {
  const x = r as { remark?: unknown; elements?: unknown[] } | null
  return typeof x?.remark === 'string' && !(x.elements?.length)
}

/** Busca en OpenStreetMap (Overpass) las tiendas de las cuatro cadenas cerca de un punto. Nunca lanza: devuelve el motivo. */
export async function buscarSedesEnLinea(centro: Punto, fetchFn: typeof fetch = fetch): Promise<{ ok: true; sedes: Sede[] } | { ok: false; motivo: string }> {
  const servidores = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
  let ultimo = 'sin respuesta'
  for (const url of servidores) {
    const control = new AbortController()
    const plazo = setTimeout(() => control.abort(), 25_000)
    try {
      const r = await fetchFn(url, { method: 'POST', body: new URLSearchParams({ data: consultaOverpass(centro) }), signal: control.signal })
      if (!r.ok) { ultimo = r.status === 429 || r.status >= 500 ? 'el servicio está ocupado' : 'el servicio no pudo responder'; continue }
      const datos = await r.json()
      if (consultaIncompleta(datos)) { ultimo = 'el servicio está ocupado'; continue }
      return { ok: true, sedes: sedesDeOverpass(datos) }
    } catch (e) {
      ultimo = e instanceof DOMException && e.name === 'AbortError' ? 'tardó demasiado' : 'sin señal o sin respuesta'
    } finally {
      clearTimeout(plazo)
    }
  }
  return { ok: false, motivo: ultimo }
}
