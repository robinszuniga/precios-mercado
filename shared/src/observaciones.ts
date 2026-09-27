import { claveActual, type Observacion, type PrecioActual, type PrecioHistorico } from './esquema.ts'
import { compararIso } from './fechas.ts'

export interface ResultadoObservaciones {
  /** Filas de Precios_actuales nuevas o modificadas. */
  actuales: PrecioActual[]
  /** Filas nuevas para el histórico (solo cuando algo cambió). */
  historial: PrecioHistorico[]
  /** obs_id que no hicieron nada: repetidas, viejas o sin cambios. */
  sinEfecto: string[]
}

function mismoPrecio(a: PrecioActual, o: Observacion): boolean {
  const precio = o.disponible ? o.precio : a.precio
  const lista = o.disponible ? o.precio_lista : a.precio_lista
  return a.precio === precio && a.precio_lista === lista && a.disponible === o.disponible
}

/**
 * Aplica observaciones sobre los precios actuales.
 * - Si el precio no cambió, solo se mueve fecha_verificado (el histórico no crece).
 * - Si cambió, se actualiza el actual y se agrega una fila al histórico.
 * - Si llegó más vieja que la última verificación, se ignora.
 * - "Agotado" conserva el último precio válido.
 * Es idempotente: aplicar dos veces la misma observación no cambia nada.
 */
export function aplicarObservaciones(
  actualesPrevios: ReadonlyMap<string, PrecioActual>,
  observaciones: readonly Observacion[],
  idsHistorial: ReadonlySet<string> = new Set(),
): ResultadoObservaciones {
  const vigentes = new Map(actualesPrevios)
  const tocadas = new Map<string, PrecioActual>()
  const historial: PrecioHistorico[] = []
  const vistos = new Set(idsHistorial)
  const sinEfecto: string[] = []

  const ordenadas = [...observaciones].sort((a, b) => compararIso(a.fecha_observado, b.fecha_observado))
  for (const o of ordenadas) {
    if (vistos.has(o.obs_id)) { sinEfecto.push(o.obs_id); continue }
    if (o.disponible && (o.precio == null || !(o.precio > 0))) { sinEfecto.push(o.obs_id); continue }

    const clave = claveActual(o.presentacion_id, o.origen)
    const previo = vigentes.get(clave)
    if (previo && compararIso(o.fecha_observado, previo.fecha_verificado) < 0) { sinEfecto.push(o.obs_id); continue }

    if (previo && mismoPrecio(previo, o)) {
      if (previo.fecha_verificado === o.fecha_observado) { sinEfecto.push(o.obs_id); continue }
      const act = { ...previo, fecha_verificado: o.fecha_observado, fuente: o.fuente, region: o.region || previo.region }
      vigentes.set(clave, act)
      tocadas.set(clave, act)
      vistos.add(o.obs_id)
      continue
    }

    const act: PrecioActual = {
      clave,
      presentacion_id: o.presentacion_id,
      tienda: o.tienda,
      origen: o.origen,
      fuente: o.fuente,
      precio: o.disponible ? o.precio : (previo?.precio ?? null),
      precio_lista: o.disponible ? o.precio_lista : (previo?.precio_lista ?? null),
      disponible: o.disponible,
      region: o.region,
      fecha_observado: o.fecha_observado,
      fecha_verificado: o.fecha_observado,
    }
    vigentes.set(clave, act)
    tocadas.set(clave, act)
    vistos.add(o.obs_id)
    historial.push({
      precio_id: o.obs_id,
      presentacion_id: o.presentacion_id,
      tienda: o.tienda,
      origen: o.origen,
      fuente: o.fuente,
      precio: act.precio,
      precio_lista: act.precio_lista,
      disponible: o.disponible,
      region: o.region,
      fecha_observado: o.fecha_observado,
      compra_id: o.compra_id,
    })
  }
  return { actuales: [...tocadas.values()], historial, sinEfecto }
}
