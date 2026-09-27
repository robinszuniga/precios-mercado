import { normalizar } from './contenido.ts'
import type { UnidadBase } from './unidades.ts'

/** Un producto leído de la lista que el usuario pegó. La cantidad va en kg, L o unidades (lo que ve el usuario). */
export interface Renglon {
  nombre: string
  cantidad: number
  unidad_base: UnidadBase
  /** '' si la lista no traía títulos de pasillo. */
  pasillo: string
  /** Algo que conviene revisar antes de guardar (unidad adivinada, paquetes, repetido…). */
  aviso: string
  original: string
}

type Medida = { base: UnidadBase; factor: number; paquete?: boolean }

// De lo más largo a lo más corto para que "kilos" gane a "k" y "litros" a "l".
const MEDIDAS: [string, Medida][] = [
  ['kilogramos', { base: 'g', factor: 1 }], ['kilogramo', { base: 'g', factor: 1 }], ['kilos', { base: 'g', factor: 1 }],
  ['kilo', { base: 'g', factor: 1 }], ['kgs', { base: 'g', factor: 1 }], ['kg', { base: 'g', factor: 1 }],
  ['gramos', { base: 'g', factor: 0.001 }], ['gramo', { base: 'g', factor: 0.001 }], ['grs', { base: 'g', factor: 0.001 }],
  ['gr', { base: 'g', factor: 0.001 }], ['g', { base: 'g', factor: 0.001 }],
  ['libras', { base: 'g', factor: 0.5 }], ['libra', { base: 'g', factor: 0.5 }], ['lbs', { base: 'g', factor: 0.5 }], ['lb', { base: 'g', factor: 0.5 }],
  ['mililitros', { base: 'ml', factor: 0.001 }], ['ml', { base: 'ml', factor: 0.001 }], ['cc', { base: 'ml', factor: 0.001 }],
  ['litros', { base: 'ml', factor: 1 }], ['litro', { base: 'ml', factor: 1 }], ['lts', { base: 'ml', factor: 1 }],
  ['lt', { base: 'ml', factor: 1 }], ['l', { base: 'ml', factor: 1 }],
  ['unidades', { base: 'unidad', factor: 1 }], ['unidad', { base: 'unidad', factor: 1 }], ['unds', { base: 'unidad', factor: 1 }],
  ['und', { base: 'unidad', factor: 1 }], ['unid', { base: 'unidad', factor: 1 }], ['uds', { base: 'unidad', factor: 1 }],
  ['ud', { base: 'unidad', factor: 1 }], ['un', { base: 'unidad', factor: 1 }], ['u', { base: 'unidad', factor: 1 }],
  ['piezas', { base: 'unidad', factor: 1 }], ['pieza', { base: 'unidad', factor: 1 }],
  ['docenas', { base: 'unidad', factor: 12 }], ['docena', { base: 'unidad', factor: 12 }],
  ['cubetas', { base: 'unidad', factor: 30 }], ['cubeta', { base: 'unidad', factor: 30 }],
  ['panales', { base: 'unidad', factor: 30 }], ['panal', { base: 'unidad', factor: 30 }],
  ...['rollos', 'rollo', 'sobres', 'sobre', 'barras', 'barra', 'pastillas', 'pastilla', 'atados', 'atado', 'manojos', 'manojo', 'racimos', 'racimo']
    .map((u): [string, Medida] => [u, { base: 'unidad', factor: 1 }]),
  ...['pacas', 'paca', 'paquetes', 'paquete', 'paq', 'bolsas', 'bolsa', 'cajas', 'caja', 'latas', 'lata', 'frascos', 'frasco',
    'botellas', 'botella', 'tarros', 'tarro', 'cartones', 'carton', 'potes', 'pote']
    .map((u): [string, Medida] => [u, { base: 'unidad', factor: 1, paquete: true }]),
]
const MAPA = new Map(MEDIDAS)
const UNIDAD = MEDIDAS.map(([u]) => u).join('|')

const PALABRAS: Record<string, number> = {
  un: 1, una: 1, uno: 1, medio: 0.5, media: 0.5, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, doce: 12, quince: 15, veinte: 20, treinta: 30,
}
const FRACCION: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3 }

// Un número: "2", "1,5", "1.5", "1/2", "1 1/2", "1½", "½" o una palabra ("medio", "dos").
const NUM = String.raw`(?:\d+\s+\d/\d|\d+[½¼¾]|\d/\d|\d+(?:[.,]\d+)?|[½¼¾⅓]|${Object.keys(PALABRAS).join('|')})`
const B = String.raw`(?<![a-zñ])` // borde de palabra que entiende la ñ
const E = String.raw`(?![a-zñ])`

// "2 bolsas de 1 kg", "6 x 1 L", "2x500 g": paquetes por medida.
const RE_MULTI = new RegExp(String.raw`${B}(${NUM})\s*(?:(${UNIDAD})\s*(?:de|x)|x)\s*(${NUM})\s*(${UNIDAD})${E}`)
// "5 kg", "medio kilo", "x2", "30 und", "1 docena".
const RE_MEDIDA = new RegExp(String.raw`${B}(?:x\s*)?(${NUM})\s*(${UNIDAD})${E}`)
// "kilo de carne", "libra de queso": unidad sin número = 1.
const RE_SOLO_UNIDAD = new RegExp(String.raw`^(${UNIDAD})\s+de\s+`)
// Un número suelto: "Huevos 30", "Arroz x5", "(2) Papa", "Pan 10".
const RE_SUELTO = new RegExp(String.raw`(?:^|\s|\(|x)(${NUM})\s*\)?(?=\s|$)`)

function numero(s: string): number {
  const t = s.trim()
  if (t in PALABRAS) return PALABRAS[t]
  if (t in FRACCION) return FRACCION[t]
  const mixto = t.match(/^(\d+)\s+(\d)\/(\d)$/)
  if (mixto) return Number(mixto[1]) + Number(mixto[2]) / Number(mixto[3])
  const pegado = t.match(/^(\d+)([½¼¾])$/)
  if (pegado) return Number(pegado[1]) + FRACCION[pegado[2]]
  const frac = t.match(/^(\d)\/(\d)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  // "1.000 g" es mil; "1.5" y "1,5" son uno y medio.
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  return Number(t.replace(',', '.'))
}

/** Si no dice la unidad, se adivina por el nombre. El usuario lo revisa antes de guardar. */
const POR_NOMBRE: [RegExp, UnidadBase][] = [
  [/\b(liquid[oa]|leche|aceite|agua|jugo|gaseosa|vinagre|yogur|kumis|suero|shampoo|champu|suavizante|cloro|limpido|blanqueador|enjuague|alcohol|vino|cerveza|refresco)(?:e?s)?\b/, 'ml'],
  [/\b(huevo|platano|limon|aguacate|pan|arepa|papel|jabon|cepillo|crema dental|toalla|esponja|bombillo|servilleta|panal|pila|vela|fosforo|mango|pina|coco|guineo|repollo|lechuga|pepino|pimenton|mazorca|desodorante|maquina de afeitar|cuchilla)(?:e?s)?\b/, 'unidad'],
]

export function unidadPorNombre(nombre: string): UnidadBase {
  const n = normalizar(nombre)
  for (const [re, u] of POR_NOMBRE) if (re.test(n)) return u
  return 'g'
}

/** Clave para reconocer el mismo producto: sin tildes, minúsculas y en singular ("Limones" = "limón"). */
export function claveProducto(nombre: string): string {
  return normalizar(nombre)
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 4 && /[lnrdzj]es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ')
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu

/** Quita lo que WhatsApp y las notas le ponen a cada renglón: hora y autor, viñetas, numeración, casillas, emojis. */
function limpiar(linea: string): string {
  return sinPrefijo(linea)
    .replace(/^[\s\-–—*•·▪►>✓✔☐☑□■○●+]+/, '')
    .replace(/^\d{1,3}\s*[.)]\s+/, '') // "1. " o "2) "
    .replace(/^\(\s*\)\s*|^\[\s*[xX]?\s*\]\s*/, '')
    .replace(/[*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Quita solo la hora y el autor de WhatsApp y los emojis (sin tocar las marcas de título). */
function sinPrefijo(linea: string): string {
  return linea
    .replace(/^\[[^\]]{4,40}\]\s*[^:]{1,40}:\s*/, '') // [27/9/26, 10:15 a. m.] Robinson:
    .replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}[^-]{0,12}-\s*[^:]{1,40}:\s*/, '') // 27/9/26 10:15 - Robinson:
    .replace(EMOJI, ' ')
    .trim()
}

/** "LÁCTEOS:", "*Aseo*", "== Carnes ==", "# Granos": títulos de pasillo (sin números). */
function titulo(linea: string, mayusculasSonTitulo: boolean): string | null {
  const t = sinPrefijo(linea)
  if (!t || /\d/.test(t)) return null
  const marcado = t.endsWith(':') || /^#/.test(t) || (/^[*_=~]/.test(t) && /[*_=~]$/.test(t))
  const limpio = limpiar(t).replace(/[*_=#~:]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!limpio) return null
  if (marcado) return limpio
  if (mayusculasSonTitulo && limpio.length <= 30 && limpio === limpio.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(limpio)) return limpio
  return null
}

/** "Lista de mercado", "Mercado de la quincena": encabezados que no son productos. */
function esEncabezado(linea: string): boolean {
  const t = normalizar(limpiar(linea))
  return !/\d/.test(t) && /^(lista|mercado|compras?|pedido)\b/.test(t)
}

function bonito(s: string): string {
  const t = s.trim()
  if (t === t.toUpperCase()) return t.charAt(0) + t.slice(1).toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function nombreSin(texto: string, desde: number, hasta: number): string {
  return (texto.slice(0, desde) + ' ' + texto.slice(hasta))
    .replace(/^\s*(?:de|del)\s+/i, '')
    .replace(/\s+(?:de|del)\s*$/i, '')
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s:=,;.\-–—]+|[\s:=,;.\-–—]+$/g, '')
    .replace(/^x\s+|\s+x$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type Leido = Omit<Renglon, 'pasillo'>

/** Lee un renglón de producto. null si no queda nombre. */
export function leerRenglon(linea: string): Leido | null {
  const original = linea
  const texto = limpiar(linea)
  if (!texto) return null
  const bajo = texto.toLowerCase()
  const listo = (desde: number, hasta: number, cantidad: number, unidad: UnidadBase, aviso = ''): Leido | null => {
    const nombre = bonito(nombreSin(texto, desde, hasta))
    if (!nombre || !/[a-zñáéíóú]/i.test(nombre)) return null
    return { nombre, cantidad: Math.round(cantidad * 1000) / 1000, unidad_base: unidad, aviso, original }
  }

  const multi = bajo.match(RE_MULTI)
  if (multi && multi.index != null) {
    const med = MAPA.get(multi[4])!
    if (!med.paquete) {
      const n = numero(multi[1]) * numero(multi[3]) * med.factor
      if (n > 0) return listo(multi.index, multi.index + multi[0].length, n, med.base)
    }
  }

  const med = bajo.match(RE_MEDIDA)
  if (med && med.index != null) {
    const m = MAPA.get(med[2])!
    const n = numero(med[1]) * m.factor
    if (n > 0) {
      const aviso = m.paquete ? `Dice “${med[2]}”: se contará por unidad. Si prefieres por kg o L, cámbialo.` : ''
      return listo(med.index, med.index + med[0].length, n, m.base, aviso)
    }
  }

  const solo = bajo.match(RE_SOLO_UNIDAD)
  if (solo) {
    const m = MAPA.get(solo[1])!
    return listo(0, solo[0].length, m.factor, m.base, m.paquete ? `Dice “${solo[1]}”: se contará por unidad.` : '')
  }

  const unidad = unidadPorNombre(texto)
  const suelto = bajo.match(RE_SUELTO)
  if (suelto && suelto.index != null) {
    const n = numero(suelto[1])
    if (n > 0) {
      const aviso = unidad === 'unidad' ? '' : `No dice la unidad: puse ${n} ${unidad === 'g' ? 'kg' : 'L'}. Revísalo.`
      return listo(suelto.index, suelto.index + suelto[0].length, n, unidad, aviso)
    }
  }

  return listo(0, 0, 1, unidad, 'No dice cuánto: puse 1. Revísalo.')
}

const ENCABEZADOS: Record<string, keyof Columnas> = {
  producto: 'nombre', productos: 'nombre', nombre: 'nombre', articulo: 'nombre', item: 'nombre', descripcion: 'nombre',
  cantidad: 'cantidad', cant: 'cantidad',
  unidad: 'unidad', unidades: 'unidad', medida: 'unidad', und: 'unidad',
  pasillo: 'pasillo', categoria: 'pasillo', seccion: 'pasillo', tipo: 'pasillo',
}
type Columnas = { nombre: number; cantidad: number; unidad: number; pasillo: number }

/** Filas copiadas de Excel o Google Sheets (tabuladas) o separadas por ";" o "|". */
function tabla(lineas: string[]): Renglon[] | null {
  const sep = [/\t/, /;/, /\|/].find((re) => lineas.filter((l) => re.test(l)).length >= Math.max(1, lineas.length * 0.6))
  if (!sep) return null
  const filas = lineas.map((l) => l.split(sep).map((c) => c.trim()))
  let col: Columnas = { nombre: 0, cantidad: -1, unidad: -1, pasillo: -1 }
  const cab = filas[0].map((c) => ENCABEZADOS[normalizar(c)])
  if (cab.filter(Boolean).length >= 2) {
    col = { nombre: -1, cantidad: -1, unidad: -1, pasillo: -1 }
    cab.forEach((k, i) => { if (k && col[k] < 0) col[k] = i })
    if (col.nombre < 0) col.nombre = 0
    filas.shift()
  } else {
    // Sin encabezado: la primera columna con letras es el nombre; la numérica, la cantidad; una unidad conocida, la unidad.
    const muestra = filas[0]
    col.nombre = Math.max(0, muestra.findIndex((c) => /[a-zñ]/i.test(c) && !MAPA.has(normalizar(c))))
    col.cantidad = muestra.findIndex((c, i) => i !== col.nombre && new RegExp(`^${NUM}$`).test(normalizar(c)))
    col.unidad = muestra.findIndex((c, i) => i !== col.nombre && MAPA.has(normalizar(c)))
    col.pasillo = muestra.findIndex((c, i) => i !== col.nombre && i !== col.cantidad && i !== col.unidad && /[a-zñ]/i.test(c))
  }
  const out: Renglon[] = []
  for (const f of filas) {
    const nombre = f[col.nombre] ?? ''
    if (!nombre.trim()) continue
    const pasillo = col.pasillo >= 0 ? bonito(f[col.pasillo] ?? '') : ''
    const linea = [nombre, col.cantidad >= 0 ? f[col.cantidad] : '', col.unidad >= 0 ? f[col.unidad] : ''].join(' ')
    const r = leerRenglon(linea)
    if (r) out.push({ ...r, original: f.join(' · '), pasillo })
  }
  return out
}

/** Convierte el texto pegado (WhatsApp, Notas, Excel) en productos con cantidad, unidad y pasillo. */
export function leerLista(texto: string): Renglon[] {
  let lineas = texto.split(/\r?\n/).map((l) => l.replace(/\u00a0/g, ' ')).filter((l) => l.trim())
  // Todo en un renglón ("arroz, fríjol, 2 kg papa"): se separa por comas o punto y coma (no "1,5").
  if (lineas.length === 1) lineas = lineas[0].split(/;\s*|,\s+(?=\D)/).filter((l) => l.trim())
  const tab = lineas.length >= 2 ? tabla(lineas) : null
  const renglones = tab ?? (() => {
    // Si casi todo está en mayúsculas, las mayúsculas no marcan títulos.
    const limpias = lineas.map(limpiar).filter(Boolean)
    const conLetras = limpias.filter((l) => /[a-zñáéíóú]/i.test(l))
    const mayus = conLetras.filter((l) => l === l.toUpperCase()).length
    const mayusculasSonTitulo = mayus > 0 && mayus < conLetras.length / 2
    let pasillo = ''
    const out: Renglon[] = []
    for (const l of lineas) {
      if (esEncabezado(l)) continue
      const t = titulo(l, mayusculasSonTitulo)
      if (t) { pasillo = bonito(t); continue }
      const r = leerRenglon(l)
      if (r) out.push({ ...r, pasillo })
    }
    return out
  })()
  return unirRepetidos(renglones)
}

/** El mismo producto dos veces en la lista: se suma si está en la misma unidad. */
function unirRepetidos(xs: Renglon[]): Renglon[] {
  const vistos = new Map<string, Renglon>()
  const out: Renglon[] = []
  for (const r of xs) {
    const k = claveProducto(r.nombre)
    const previo = vistos.get(k)
    if (!previo) { vistos.set(k, r); out.push(r); continue }
    if (previo.unidad_base === r.unidad_base) previo.cantidad = Math.round((previo.cantidad + r.cantidad) * 1000) / 1000
    previo.aviso = [previo.aviso, 'Estaba repetido en la lista: se sumó.'].filter(Boolean).join(' ')
  }
  return out
}

/** Marca los renglones que ya son productos tuyos (para actualizarlos en vez de duplicarlos). */
export function emparejar<P extends { nombre: string; activo: boolean }>(renglones: Renglon[], productos: P[]): (Renglon & { existente: P | null })[] {
  const porClave = new Map<string, P>()
  for (const p of productos) {
    const k = claveProducto(p.nombre)
    if (!porClave.has(k) || p.activo) porClave.set(k, p)
  }
  return renglones.map((r) => ({ ...r, existente: porClave.get(claveProducto(r.nombre)) ?? null }))
}
