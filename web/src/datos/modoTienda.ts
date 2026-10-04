import { contenidoCompatible } from '@shared/contenido.ts'
import { mismoEan, normalizarEan } from '@shared/ean.ts'
import type { Presentacion, Producto } from '@shared/esquema.ts'
import { claveProducto } from '@shared/importarLista.ts'
import type { Tienda, TiendaVtex } from '@shared/tiendas.ts'
import { llamarVtex } from './apiVtex.ts'
import { db } from './db.ts'
import { guardar, nuevaPresentacion } from './escritura.ts'
import { crearDesdeCandidato, TIENDAS_LOTE, type Cand } from './vincularLote.ts'

const TIEMPO_BUSQUEDA_MS = 8000

/** Lo que dice internet de un código de barras que no conocías: nombre, marca, tamaño y dónde lo venden. */
export interface Sugerencia {
  nombre: string
  marca: string
  candidatos: Cand[]
}

export type Resuelto =
  | { tipo: 'conocido'; producto: Producto; presentacion: Presentacion }
  | { tipo: 'elegir'; ean: string; sugerencia: Sugerencia | null }

/** Copia en esta tienda una presentación que ya tienes en otra (mismo código = mismo producto y tamaño). */
async function copiarA(tienda: Tienda, p: Presentacion): Promise<Presentacion> {
  const [nueva] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
    // Id fijo: escanear dos veces el mismo código en la misma tienda no crea dos.
    presentacion_id: `ean-${p.producto_id}-${tienda}-${normalizarEan(p.ean)}`,
    producto_id: p.producto_id,
    tienda,
    nombre_en_tienda: p.nombre_en_tienda,
    marca: p.marca,
    contenido: p.contenido,
    granel: p.granel,
    ean: normalizarEan(p.ean),
  }))
  return nueva
}

/**
 * Qué es lo que se escaneó. Primero en tus productos (el mismo código en cualquier tienda: la marca Diana de
 * Olímpica es la misma de D1); si no está, en internet, para sugerir nombre y tamaño.
 */
export async function resolverCodigo(ean: string, tienda: Tienda): Promise<Resuelto> {
  const codigo = normalizarEan(ean)
  const [presentaciones, productos] = await Promise.all([db.presentaciones.toArray(), db.productos.toArray()])
  const producto = new Map(productos.filter((p) => p.activo).map((p) => [p.producto_id, p]))
  const iguales = presentaciones.filter((p) => p.activo && mismoEan(p.ean, codigo) && producto.has(p.producto_id))
  const aqui = iguales.find((p) => p.tienda === tienda)
  if (aqui) return { tipo: 'conocido', producto: producto.get(aqui.producto_id)!, presentacion: aqui }
  if (iguales[0]) return { tipo: 'conocido', producto: producto.get(iguales[0].producto_id)!, presentacion: await copiarA(tienda, iguales[0]) }

  // En la tienda la señal es mala: si internet no responde pronto, se sigue sin la sugerencia.
  const r = await llamarVtex<{ candidatos: Cand[] }>('buscarEnTienda', { tienda: '*', ean: codigo }, TIEMPO_BUSQUEDA_MS)
  const cands = r.tipo === 'ok' ? (r.data.candidatos ?? []).filter((x) => mismoEan(x.ean, codigo)) : []
  const mejor = cands.find((x) => x.contenido) ?? cands[0]
  return { tipo: 'elegir', ean: codigo, sugerencia: mejor ? { nombre: mejor.nombre, marca: mejor.marca, candidatos: cands } : null }
}

/**
 * El usuario dijo a qué producto corresponde el código. Con lo que sabe internet se crea su presentación en esta
 * tienda (nombre, marca, tamaño) y, de paso, se vincula el precio online de Olímpica/Éxito donde el producto aún
 * no tenga. Sin tamaño comparable devuelve null: el formulario de precio lo pregunta.
 */
export async function asignarCodigo(producto: Producto, tienda: Tienda, ean: string, sugerencia: Sugerencia | null): Promise<Presentacion | null> {
  const compatibles = (sugerencia?.candidatos ?? []).filter((c) => contenidoCompatible(c.contenido, producto.unidad_base))
  if (!compatibles.length) return null
  const ya = await db.presentaciones.where('producto_id').equals(producto.producto_id).toArray()
  // Una sola presentación online por tienda: el mismo código puede salir dos veces en una tienda (dos SKU).
  const vinculadas = new Set(ya.filter((p) => p.activo && p.sku_id).map((p) => p.tienda))
  for (const c of compatibles) {
    const t = c.tienda as TiendaVtex
    if (!TIENDAS_LOTE.includes(t) || vinculadas.has(t)) continue
    if (await crearDesdeCandidato(producto, c, c.contenido!.valor)) vinculadas.add(t)
  }
  const base = compatibles[0]
  const ahora = await db.presentaciones.where('producto_id').equals(producto.producto_id).toArray()
  const igual = ahora.find((p) => p.activo && p.tienda === tienda && mismoEan(p.ean, ean))
  if (igual) return igual
  const [nueva] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
    presentacion_id: `ean-${producto.producto_id}-${tienda}-${normalizarEan(ean)}`,
    producto_id: producto.producto_id,
    tienda,
    nombre_en_tienda: base.nombre,
    marca: base.marca,
    contenido: base.contenido!.valor,
    ean: normalizarEan(ean),
  }))
  return nueva
}

/** Tus productos ordenados por parecido con el nombre que dio internet ("Arroz Diana 1000 g" → Arroz primero). La marca no cuenta. */
export function ordenarPorParecido(productos: readonly Producto[], nombre: string, marca = ''): Producto[] {
  const deMarca = new Set(claveProducto(marca).split(' '))
  const suyas = new Set(claveProducto(nombre).split(' ').filter((w) => w.length >= 3 && !deMarca.has(w)))
  const puntos = (p: Producto) => claveProducto(p.nombre).split(' ').filter((w) => suyas.has(w)).length
  return [...productos].sort((a, b) => puntos(b) - puntos(a) || a.nombre.localeCompare(b.nombre, 'es'))
}
