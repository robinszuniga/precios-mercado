import type { UnidadBase } from './unidades.ts'

export type Confianza = 'alta' | 'media' | 'baja'

export interface Contenido {
  /** En g, ml o unidades. */
  valor: number
  unidad: UnidadBase
  confianza: Confianza
}

type Tipo = { base: UnidadBase; factor: number; confianza?: Confianza }

// Orden: de lo más largo a lo más corto, para que "kg" gane a "g" y "lts" a "l".
const UNIDADES: [string, Tipo][] = [
  ['kilogramos', { base: 'g', factor: 1000 }],
  ['kilogramo', { base: 'g', factor: 1000 }],
  ['kilos', { base: 'g', factor: 1000 }],
  ['kilo', { base: 'g', factor: 1000 }],
  ['kgs', { base: 'g', factor: 1000 }],
  ['kg', { base: 'g', factor: 1000 }],
  ['gramos', { base: 'g', factor: 1 }],
  ['gramo', { base: 'g', factor: 1 }],
  ['grs', { base: 'g', factor: 1 }],
  ['gr', { base: 'g', factor: 1 }],
  ['g', { base: 'g', factor: 1 }],
  ['libras', { base: 'g', factor: 500, confianza: 'baja' }],
  ['libra', { base: 'g', factor: 500, confianza: 'baja' }],
  ['lbs', { base: 'g', factor: 500, confianza: 'baja' }],
  ['lb', { base: 'g', factor: 500, confianza: 'baja' }],
  ['mililitros', { base: 'ml', factor: 1 }],
  ['mililitro', { base: 'ml', factor: 1 }],
  ['ml', { base: 'ml', factor: 1 }],
  ['cc', { base: 'ml', factor: 1 }],
  ['litros', { base: 'ml', factor: 1000 }],
  ['litro', { base: 'ml', factor: 1000 }],
  ['lts', { base: 'ml', factor: 1000 }],
  ['lt', { base: 'ml', factor: 1000 }],
  ['l', { base: 'ml', factor: 1000 }],
  ['unidades', { base: 'unidad', factor: 1 }],
  ['unidad', { base: 'unidad', factor: 1 }],
  ['unds', { base: 'unidad', factor: 1 }],
  ['und', { base: 'unidad', factor: 1 }],
  ['unid', { base: 'unidad', factor: 1 }],
  ['uds', { base: 'unidad', factor: 1 }],
  ['ud', { base: 'unidad', factor: 1 }],
  ['un', { base: 'unidad', factor: 1 }],
  ['u', { base: 'unidad', factor: 1 }],
  ['rollos', { base: 'unidad', factor: 1 }],
  ['rollo', { base: 'unidad', factor: 1 }],
  ['pastillas', { base: 'unidad', factor: 1 }],
  ['sobres', { base: 'unidad', factor: 1 }],
  ['bolsas', { base: 'unidad', factor: 1 }],
  ['tabletas', { base: 'unidad', factor: 1 }],
  ['pares', { base: 'unidad', factor: 1 }],
]

const MAPA = new Map(UNIDADES)
const NUM = String.raw`\d+(?:[.,]\d+)*`
const ALT = UNIDADES.map(([u]) => u).join('|')
const RE_MEDIDA = new RegExp(String.raw`(${NUM})\s*(${ALT})(?![a-z])`, 'g')
// "6 x 200 ml", "3x160g", "pack 6 x 1 L": el primer número multiplica a la medida.
const RE_MULTI = new RegExp(String.raw`(?:^|[^\d.,])(\d{1,3})\s*(?:und|unds|unidades|u|uds)?\s*x\s*(${NUM})\s*(${ALT})(?![a-z])`)
// "x6", "x 6", "pack x 6" que no van seguidos de una unidad de medida.
const RE_POR_N = new RegExp(String.raw`(?:^|[^a-z])(?:pack\s*)?x\s*(\d{1,3})(?![\d.,])(?!\s*(?:${ALT})(?![a-z]))`)
const RE_PACK = /(?:pack|paquete|six\s*pack)\s*(?:de|x)?\s*(\d{1,3})(?![\d.,])/

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[×✕]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Número al estilo colombiano: "1.000" = mil, "1,5" = uno y medio, "1.5" = uno y medio.
 * Para kg, L y lb, un "2.500" se lee como 2,5 (nadie vende 2.500 kg en el súper).
 */
export function numeroCO(s: string, unidadGrande = false): number {
  if (s.includes('.') && s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'))
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    const miles = Number(s.replace(/\./g, ''))
    if (unidadGrande && miles >= 100) return Number(s)
    return miles
  }
  return Number(s)
}

function medida(numero: string, unidad: string): { valor: number; tipo: Tipo } | null {
  const tipo = MAPA.get(unidad)
  if (!tipo) return null
  const n = numeroCO(numero, tipo.factor > 1)
  if (!(n > 0)) return null
  return { valor: n * tipo.factor, tipo }
}

function peor(a: Confianza, b: Confianza | undefined): Confianza {
  const orden: Confianza[] = ['alta', 'media', 'baja']
  return orden[Math.max(orden.indexOf(a), orden.indexOf(b ?? 'alta'))]
}

function redondear(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Saca el contenido neto del nombre de un producto. null si no encuentra nada confiable. */
export function parseContenido(texto: string): Contenido | null {
  const t = normalizar(texto)

  const multi = t.match(RE_MULTI)
  if (multi) {
    const m = medida(multi[2], multi[3])
    const n = Number(multi[1])
    if (m && n > 0 && m.tipo.base !== 'unidad') {
      return { valor: redondear(n * m.valor), unidad: m.tipo.base, confianza: peor('alta', m.tipo.confianza) }
    }
  }

  const medidas: { valor: number; tipo: Tipo }[] = []
  const conteos: number[] = []
  for (const r of t.matchAll(RE_MEDIDA)) {
    const m = medida(r[1], r[2])
    if (!m) continue
    if (m.tipo.base === 'unidad') conteos.push(m.valor)
    else medidas.push(m)
  }
  const porN = t.match(RE_POR_N) ?? t.match(RE_PACK)
  if (porN) conteos.push(Number(porN[1]))

  if (medidas.length > 0) {
    const m = medidas[0]
    let confianza = peor(medidas.length > 1 ? 'media' : 'alta', m.tipo.confianza)
    let valor = m.valor
    // "Leche 6 und 200 ml" o "Leche 200 ml x6": conteo por medida.
    if (conteos.length > 0 && conteos[0] > 1) {
      valor *= conteos[0]
      if (conteos.length > 1) confianza = peor(confianza, 'media')
    }
    return { valor: redondear(valor), unidad: m.tipo.base, confianza }
  }
  if (conteos.length > 0) {
    return { valor: conteos[0], unidad: 'unidad', confianza: conteos.length > 1 ? 'baja' : 'alta' }
  }
  return null
}

/** El contenido sirve para este producto solo si está en su misma unidad base. */
export function contenidoCompatible(c: Contenido | null, unidad: UnidadBase): boolean {
  return c != null && c.unidad === unidad
}
