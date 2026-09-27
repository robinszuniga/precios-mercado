import { claveProducto } from '../importarLista.ts'
import { precioPorUnidad, type UnidadBase } from '../unidades.ts'
import type { Candidato } from './parse.ts'

export type Opcion<C extends Candidato = Candidato> = C & {
  puntaje: number
  precioUnidad: number
  /** Coincidencia clara: se puede vincular sin preguntar. */
  seguro: boolean
}

// Palabras que no cuentan como "de más": tamaños, unidades y relleno de los nombres de catálogo.
const NEUTRAS = /^(\d+([.,]\d+)?|x\d+|\d+x|\d+(g|gr|grs|kg|ml|l|lt|lts|cc|und|un|u)|g|gr|grs|kg|kgs|ml|l|lt|lts|cc|und|unds|unid|un|u|lb|libra|litro|kilo|gramo|x|de|del|la|el|en|con|y|por|para|pague|lleve|precio|especial|oferta|paquete|pack|bolsa|botella|caja|pet|tarro|frasco|doypack|sixpack)$/

// Variantes que no cambian el producto: "Leche" = "Leche entera", "Huevos" = "Huevo rojo AA".
const INOFENSIVAS = new Set(['entera', 'entero', 'blanco', 'blanca', 'tradicional', 'clasico', 'clasica', 'original', 'fresco', 'fresca',
  'natural', 'premium', 'selecto', 'selecta', 'extra', 'colombiano', 'colombiana', 'nacional', 'familiar', 'economico', 'economica',
  'pasteurizada', 'pasteurizado', 'uht', 'larga', 'vida', 'rojo', 'roja', 'aa', 'aaa', 'grande', 'mediano', 'mediana', 'tipo',
  'refinado', 'refinada', 'fino', 'fina', 'puro', 'pura', 'granel', 'unidad', 'bandeja', 'malla'])

function palabras(texto: string): string[] {
  return claveProducto(texto).split(' ').filter(Boolean)
}

/**
 * Ordena lo que devolvió la tienda para un producto genérico ("Arroz", "Leche entera") y marca la opción
 * segura, si la hay. Solo sirven candidatos con tamaño en la misma unidad (sin eso no hay precio por kg/L/und).
 * Seguro = tiene todas las palabras del producto, ninguna palabra de más (salvo la marca y el tamaño),
 * precio y disponible. Entre varios seguros gana el más relevante para la tienda (su propio orden).
 */
export function ordenarCandidatos<C extends Candidato>(nombre: string, unidad: UnidadBase, cands: readonly C[], max = 4): Opcion<C>[] {
  const buscadas = palabras(nombre).filter((w) => w.length >= 3 || /\d/.test(w))
  if (!buscadas.length) return []
  const vistos = new Set<string>()
  const out: Opcion<C>[] = []
  cands.forEach((c, i) => {
    if (vistos.has(c.skuId)) return
    vistos.add(c.skuId)
    if (!c.contenido || c.contenido.unidad !== unidad || !(c.contenido.valor > 0)) return
    const ws = palabras(c.nombre)
    const marca = new Set(palabras(c.marca))
    // Solo la palabra exacta cuenta completa: "Papaya" empieza por "papa" pero es otro producto.
    const exactas = buscadas.filter((b) => ws.includes(b))
    const parecidas = buscadas.filter((b) => !ws.includes(b) && b.length >= 4 && ws.some((w) => w.startsWith(b)))
    if (!exactas.length && !parecidas.length) return
    const cobertura = (exactas.length + parecidas.length * 0.5) / buscadas.length
    const deMas = ws.filter((w) => !buscadas.includes(w) && !marca.has(w) && !NEUTRAS.test(w) && !INOFENSIVAS.has(w) && w.length > 2).length
    const precioUnidad = precioPorUnidad(c.precio, c.contenido.valor, unidad)
    const conPrecio = precioUnidad != null && c.disponible
    const empiezaIgual = ws[0] === buscadas[0] || (marca.has(ws[0]) && ws[1] === buscadas[0])
    const puntaje = cobertura * 100 - deMas * 12 + (empiezaIgual ? 15 : 0) + (conPrecio ? 10 : -40) + Math.max(0, 20 - i) / 2
    out.push({ ...c, puntaje, precioUnidad: precioUnidad ?? 0, seguro: exactas.length === buscadas.length && deMas === 0 && conPrecio && c.contenido.confianza !== 'baja' })
  })
  out.sort((a, b) => b.puntaje - a.puntaje)
  // Solo una opción puede ser la segura: la primera de las seguras.
  let hay = false
  for (const o of out) {
    if (o.seguro && hay) o.seguro = false
    if (o.seguro) hay = true
  }
  return out.slice(0, max)
}
