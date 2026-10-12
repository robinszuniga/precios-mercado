import { esTienda, INFO_TIENDAS, TIENDAS, type Tienda } from './tiendas.ts'

/**
 * Sedes (locales) de las tiendas y rutas entre ellas. Los precios son por cadena, no por local: la sede solo dice dónde
 * queda. Todo aquí es puro (sin red ni pantalla), para probarlo con facilidad.
 */

export interface Punto {
  lat: number
  lng: number
}

export interface Sede extends Punto {
  id: string
  tienda: Tienda
  nombre: string
}

const RADIO_TIERRA_KM = 6371.0088
/** Las calles no van en línea recta: la distancia por vía suele ser cerca de un 30 % mayor. Es una estimación, no un mapa de rutas. */
export const FACTOR_VIA = 1.3
export const MAX_SEDES = 200

export function puntoValido(p: unknown): p is Punto {
  const q = p as Partial<Punto> | null
  return !!q && typeof q.lat === 'number' && typeof q.lng === 'number'
    && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180
}

/**
 * El mapa repite el mundo: tocar en otra copia da una longitud como 287° en vez de -73°. Se lleva a su valor real (-180 a 180).
 */
export function normalizarPunto(p: Punto): Punto {
  // Lo que ya está en rango no se toca (la aritmética de abajo le cambiaría los últimos decimales).
  if (Math.abs(p.lng) <= 180) return p
  return { lat: p.lat, lng: ((((p.lng + 180) % 360) + 360) % 360) - 180 }
}

const rad = (g: number) => (g * Math.PI) / 180

/** Distancia en línea recta (km). */
export function distanciaKm(a: Punto, b: Punto): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Distancia estimada por las calles (km). */
export const distanciaViaKm = (a: Punto, b: Punto): number => distanciaKm(a, b) * FACTOR_VIA

/** "850 m" o "1,2 km". */
export function formatoKm(km: number): string {
  const m = Math.max(10, Math.round((km * 1000) / 10) * 10)
  return m < 1000 ? `${m} m` : `${(Math.round(km * 10) / 10).toFixed(1).replace('.', ',')} km`
}

// ── Guardado: una fila de la configuración por sede (clave `sede.<id>`) ─────────────────────────────────────
// Una fila por sede, no una lista en una sola: así dos celulares que agregan sedes a la vez no se pisan, y cada valor
// es corto (el servicio anterior de hojas cortaba los valores a 2000 caracteres).

export const PREFIJO_SEDE = 'sede.'
export const claveSede = (id: string): string => `${PREFIJO_SEDE}${id}`

/** El valor que se guarda de una sede (el id va en la clave). */
export function valorSede(s: Sede): string {
  const redondo = (n: number) => Math.round(n * 1e6) / 1e6
  return JSON.stringify({ tienda: s.tienda, nombre: s.nombre, lat: redondo(s.lat), lng: redondo(s.lng) })
}

/** Lee una sede guardada; lo que no tenga la forma correcta (o esté vacío: sede quitada) devuelve null. */
export function sedeDeFila(clave: string, valor: string | undefined | null): Sede | null {
  if (!clave.startsWith(PREFIJO_SEDE) || !valor) return null
  const id = clave.slice(PREFIJO_SEDE.length)
  let x: Partial<Sede> | null
  try { x = JSON.parse(valor) as Partial<Sede> | null } catch { return null }
  if (!id || !x || !esTienda(x.tienda)) return null
  const punto = { lat: x.lat, lng: x.lng }
  if (!puntoValido(punto)) return null
  const nombre = typeof x.nombre === 'string' && x.nombre.trim() ? x.nombre.trim().slice(0, 80) : INFO_TIENDAS[x.tienda].nombre
  return { id, tienda: x.tienda, nombre, lat: punto.lat, lng: punto.lng }
}

/** Todas las sedes guardadas, en un orden estable (tienda, nombre). Lo que no sirva se ignora, nunca rompe la pantalla. */
export function sedesDeConfig(filas: readonly { clave: string; valor: string }[]): Sede[] {
  const sedes: Sede[] = []
  for (const f of filas) {
    const s = sedeDeFila(f.clave, f.valor)
    if (s) sedes.push(s)
  }
  sedes.sort((a, b) => TIENDAS.indexOf(a.tienda) - TIENDAS.indexOf(b.tienda) || a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id))
  return sedes.slice(0, MAX_SEDES)
}

/**
 * Suma las sedes nuevas a las que ya hay. Una nueva se descarta si ya existe con ese id, o si es de la misma tienda y
 * queda a menos de `toleranciaM` metros de una que ya está (la misma tienda cargada de otra forma).
 */
export function fusionarSedes(actuales: readonly Sede[], nuevas: readonly Sede[], toleranciaM = 80): { sedes: Sede[]; agregadas: Sede[] } {
  const sedes = [...actuales]
  const agregadas: Sede[] = []
  for (const n of nuevas) {
    const repetida = sedes.some((s) => s.id === n.id || (s.tienda === n.tienda && distanciaKm(s, n) * 1000 < toleranciaM))
    if (repetida || sedes.length >= MAX_SEDES) continue
    sedes.push(n)
    agregadas.push(n)
  }
  return { sedes, agregadas }
}

// ── Sedes desde OpenStreetMap (Overpass) ────────────────────────────────────────────────────────────────────

const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * De qué tienda es un nombre o marca de OpenStreetMap ("Tiendas D1", "Supertiendas Olímpica"…); null si no es de las cuatro.
 * El nombre tiene que EMPEZAR por la cadena (con a lo sumo "tiendas"/"almacenes" antes): "Droguería Olímpica" o "Papelería Éxito"
 * no son el supermercado.
 */
export function tiendaDeNombre(texto: unknown): Tienda | null {
  if (typeof texto !== 'string') return null
  const t = sinTildes(texto)
  const cadena = /^(?:super\s?tiendas?\s+|tiendas?\s+|almacenes\s+|hipermercados?\s+)?(exito|olimpica)(?:\s|$)/.exec(t)
  if (cadena) return cadena[1] === 'exito' ? 'EXITO' : 'OLIMPICA'
  if (/^(tiendas?\s+)?d1(\s|$)/.test(t)) return 'D1'
  // "Ara" es una palabra común: solo vale exacta ("Ara", "Tiendas Ara"), no "Araújo" ni "Ara Mueblería".
  if (/^(tiendas?\s+)?ara$/.test(t)) return 'ARA'
  return null
}

/** Tipos de local de OpenStreetMap que pueden ser un supermercado o una tienda de barrio de estas cadenas. */
const TIPOS_DE_TIENDA = '^(supermarket|convenience|department_store|variety_store|discount|wholesale|general)$'
const NOMBRES_OVERPASS = '^((super ?)?tiendas? |almacenes |hipermercados? )?(éxito|exito|olímpica|olimpica)( |$)|^(tiendas? )?d1( |$)|^(tiendas? )?ara$'
const redondear = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

/**
 * La consulta que se manda a Overpass. El centro se redondea a ~1 km: no hace falta decirle a un servicio público
 * dónde está exactamente la persona para encontrar tiendas a 10 km a la redonda.
 */
export function consultaOverpass(centro: Punto, radioM = 15_000): string {
  const r = Math.min(30_000, Math.max(1_000, Math.round(radioM)))
  const lat = redondear(centro.lat, 2)
  const lng = redondear(centro.lng, 2)
  const cerca = `(around:${r},${lat},${lng})`
  const tipo = `["shop"~"${TIPOS_DE_TIENDA}"]`
  return `[out:json][timeout:25];(nwr${tipo}["name"~"${NOMBRES_OVERPASS}",i]${cerca};nwr${tipo}["brand"~"${NOMBRES_OVERPASS}",i]${cerca};);out center tags;`
}

interface ElementoOsm {
  type?: string
  id?: number
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number }
  tags?: Record<string, string>
}

/** Las sedes de la respuesta de Overpass. Lo que no sea de las cuatro tiendas, o no tenga posición, se ignora. */
export function sedesDeOverpass(respuesta: unknown): Sede[] {
  const elementos = (respuesta as { elements?: unknown } | null)?.elements
  if (!Array.isArray(elementos)) return []
  const sedes: Sede[] = []
  const vistos = new Set<string>()
  for (const e of elementos as ElementoOsm[]) {
    const tags = e?.tags ?? {}
    const tienda = tiendaDeNombre(tags.name) ?? tiendaDeNombre(tags['name:es']) ?? tiendaDeNombre(tags.brand)
    const punto = { lat: e?.lat ?? e?.center?.lat, lng: e?.lon ?? e?.center?.lon }
    if (!tienda || !puntoValido(punto) || typeof e.id !== 'number' || !e.type) continue
    const id = `osm:${e.type}${e.id}`
    if (vistos.has(id)) continue
    vistos.add(id)
    const calle = (tags['addr:street'] ?? '').trim()
    const base = (tags.name ?? '').trim() || INFO_TIENDAS[tienda].nombre
    sedes.push({ id, tienda, nombre: (calle ? `${base} · ${calle}` : base).slice(0, 80), lat: punto.lat, lng: punto.lng })
  }
  return sedes
}

// ── Ruta ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Parada {
  sede: Sede
  /** Km (por vía, estimados) desde la parada anterior, o desde el punto de partida en la primera. */
  km: number
}

export interface Ruta {
  paradas: Parada[]
  totalKm: number
  /** Tiendas del plan de las que no hay ninguna sede guardada. */
  sinSede: Tienda[]
}

function permutaciones<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]]
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]))
}

/**
 * El orden más corto para pasar por una sede de cada tienda. Con cuatro tiendas son a lo sumo 24 órdenes de tiendas; para
 * cada uno, la mejor sede de cada tienda se halla por capas (el mejor camino hasta cada sede de la capa siguiente), así que
 * el resultado es exacto aunque haya muchas sedes por tienda, con o sin punto de partida. Sin punto de partida, la primera
 * parada es libre.
 */
export function ordenarRuta(origen: Punto | null, sedes: readonly Sede[], tiendas: readonly Tienda[]): Ruta {
  const unicas = [...new Set(tiendas)]
  const sinSede = unicas.filter((t) => !sedes.some((s) => s.tienda === t))
  const conSede = unicas.filter((t) => !sinSede.includes(t))
  if (!conSede.length) return { paradas: [], totalKm: 0, sinSede }

  let mejor: { orden: Sede[]; km: number } | null = null
  for (const orden of permutaciones(conSede)) {
    const capas = orden.map((t) => sedes.filter((s) => s.tienda === t))
    // costo[i] = menor distancia para llegar a capas[k][i]; previo[k][i] = de cuál sede de la capa anterior se viene.
    let costo = capas[0].map((s) => (origen ? distanciaViaKm(origen, s) : 0))
    const previo: number[][] = [capas[0].map(() => -1)]
    for (let k = 1; k < capas.length; k++) {
      const siguiente: number[] = []
      const desde: number[] = []
      capas[k].forEach((s, j) => {
        let m = Infinity
        let de = 0
        capas[k - 1].forEach((p, i) => {
          const c = costo[i] + distanciaViaKm(p, s)
          if (c < m) { m = c; de = i }
        })
        siguiente.push(m)
        desde.push(de)
      })
      costo = siguiente
      previo.push(desde)
    }
    let fin = 0
    costo.forEach((c, i) => { if (c < costo[fin]) fin = i })
    if (mejor && costo[fin] >= mejor.km - 1e-9) continue
    const elegidas: Sede[] = []
    for (let k = capas.length - 1, i = fin; k >= 0; i = previo[k][i], k--) elegidas.unshift(capas[k][i])
    mejor = { orden: elegidas, km: costo[fin] }
  }
  const resultado = mejor!
  const paradas: Parada[] = resultado.orden.map((sede, i) => {
    const desde = i === 0 ? origen : resultado.orden[i - 1]
    return { sede, km: desde ? distanciaViaKm(desde, sede) : 0 }
  })
  return { paradas, totalKm: resultado.km, sinSede }
}

/** La sede más cercana de una tienda, con su distancia estimada por vía. */
export function sedeMasCercana(origen: Punto, sedes: readonly Sede[], tienda: Tienda): { sede: Sede; km: number } | null {
  let mejor: { sede: Sede; km: number } | null = null
  for (const s of sedes) {
    if (s.tienda !== tienda) continue
    const km = distanciaViaKm(origen, s)
    if (!mejor || km < mejor.km) mejor = { sede: s, km }
  }
  return mejor
}

// ── Enlaces para abrir la ruta en otra app (no hace falta clave ni cuenta) ──────────────────────────────────

const coord = (p: Punto) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`

/** Google Maps con las paradas en orden (la última es el destino). Sin `origen`, parte de donde esté la persona. Máximo 9 paradas intermedias. */
export function enlaceGoogleMaps(paradas: readonly Punto[], origen?: Punto | null): string | null {
  if (!paradas.length) return null
  const partes = ['api=1', `destination=${encodeURIComponent(coord(paradas[paradas.length - 1]))}`]
  if (origen) partes.push(`origin=${encodeURIComponent(coord(origen))}`)
  const intermedias = paradas.slice(0, -1).slice(0, 9)
  if (intermedias.length) partes.push(`waypoints=${encodeURIComponent(intermedias.map(coord).join('|'))}`)
  return `https://www.google.com/maps/dir/?${partes.join('&')}`
}

/** Waze solo lleva a un destino a la vez. */
export const enlaceWaze = (destino: Punto): string => `https://waze.com/ul?ll=${coord(destino)}&navigate=yes`
