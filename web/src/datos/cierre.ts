import { claveActual, type Compra, type Observacion, type PrecioActual } from '@shared/esquema.ts'
import { aplicarObservaciones } from '@shared/observaciones.ts'
import { resumenCierre, type ResultadoCierre } from '@shared/resumen.ts'
import { cargarCatalogo } from './consultas.ts'
import { db, exigirCuenta, generacionActual } from './db.ts'
import { observacion } from './escritura.ts'
import { ahoraIso, encolar, sincronizarPronto } from './sync.ts'

/**
 * Cierra la compra: lo pagado queda como precio de tienda (manda sobre el online), se congela el resumen y
 * todo viaja al servidor como una sola operación idempotente.
 */
export async function cerrarCompra(compra: Compra): Promise<ResultadoCierre> {
  // Lee de la cuenta que tenía abierta y escribe en la misma: si cambia entre una cosa y otra, se cancela sin escribir.
  const cuenta = generacionActual()
  const ahora = ahoraIso()
  const detalles = (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado)
  const presentaciones = new Map((await db.presentaciones.toArray()).map((p) => [p.presentacion_id, p]))
  exigirCuenta(cuenta)

  const obs: Observacion[] = []
  for (const d of detalles) {
    const p = d.presentacion_id ? presentaciones.get(d.presentacion_id) : undefined
    // Solo lo que el usuario vio en la tienda: un sugerido de internet aceptado sin mirar no se vuelve "precio de tienda".
    if (d.estado !== 'en_carrito' || !p || !(d.precio_unitario && d.precio_unitario > 0) || !d.precio_confirmado) continue
    obs.push(observacion({ presentacion: p, precio: d.precio_unitario, origen: 'tienda', fuente: 'compra', compraId: compra.compra_id, id: `compra:${d.detalle_id}` }))
  }

  let resultado!: ResultadoCierre
  await db.transaction('rw', [db.preciosActuales, db.historial, db.compras, db.resumen, db.outbox, db.productos, db.presentaciones, db.config, db.categorias], async () => {
    const previos = await db.preciosActuales.bulkGet(obs.map((o) => claveActual(o.presentacion_id, o.origen)))
    const r = aplicarObservaciones(new Map(previos.filter((x): x is PrecioActual => !!x).map((x) => [x.clave, x])), obs)
    if (r.actuales.length) await db.preciosActuales.bulkPut(r.actuales)
    if (r.historial.length) await db.historial.bulkPut(r.historial)

    const cat = await cargarCatalogo()
    exigirCuenta(cuenta)
    resultado = resumenCierre({
      compraId: compra.compra_id,
      detalles,
      productos: cat.producto,
      presentaciones: cat.presentaciones,
      actualesPorPresentacion: cat.actualesDe,
      vigencias: cat.cfg.vigencias,
      ahora,
    })
    const ref = resultado.referencia
    const cerrada: Compra = {
      ...compra,
      estado: 'cerrada',
      fecha_cierre: ahora,
      total_final: resultado.totalFinal,
      tienda_referencia: ref?.tienda ?? '',
      total_referencia: ref?.total ?? null,
      items_comparados: ref?.itemsComparados ?? null,
      items_total: ref?.itemsTotal ?? null,
      ahorro: ref?.ahorro ?? null,
      updated_at: ahora,
    }
    await db.compras.put(cerrada)
    if (resultado.filas.length) await db.resumen.bulkPut(resultado.filas)
    await encolar('cerrarCompra', {
      compra: cerrada,
      detalle: detalles,
      observaciones: obs,
      resumen: resultado.filas,
      preciosActuales: r.actuales,
      preciosHistorial: r.historial,
    })
  })
  sincronizarPronto()
  return resultado
}
