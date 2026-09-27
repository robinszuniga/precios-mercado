import { beforeEach, describe, expect, it } from 'vitest'
import type { Compra, Observacion } from '@shared/esquema.ts'
import { cerrarCompra } from './cierre.ts'
import { db, guardarMeta } from './db.ts'
import { guardar, nuevaPresentacion, nuevoDetalle, nuevoProducto } from './escritura.ts'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: '', token: '' })
})

describe('cerrar compra', () => {
  it('solo lo confirmado se vuelve precio de tienda; un sugerido de internet aceptado sin mirar no', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    const [aceite] = await guardar('Productos', nuevoProducto({ nombre: 'Aceite', unidad_base: 'ml' }))
    const [pArroz] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', contenido: 1000 }))
    const [pAceite] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: aceite.producto_id, tienda: 'EXITO', contenido: 1000 }))
    const compra: Compra = {
      compra_id: 'c1', estado: 'en_curso', fecha_inicio: '2026-09-27T10:00:00.000-05:00', fecha_cierre: '', presupuesto: 50000,
      tiendas_hoy: 'D1,EXITO', total_final: null, tienda_referencia: '', total_referencia: null, items_comparados: null, items_total: null,
      ahorro: null, notas: '', updated_at: '', borrado: false,
    }
    await guardar('Compras', compra)
    await guardar('Compras_detalle', [
      nuevoDetalle('c1', { producto_id: arroz.producto_id, presentacion_id: pArroz.presentacion_id, tienda: 'D1', cantidad: 1, precio_unitario: 4200, subtotal: 4200, estado: 'en_carrito', precio_confirmado: true }),
      nuevoDetalle('c1', { producto_id: aceite.producto_id, presentacion_id: pAceite.presentacion_id, tienda: 'EXITO', cantidad: 1, precio_unitario: 11900, subtotal: 11900, estado: 'en_carrito', precio_confirmado: false }),
    ])
    const r = await cerrarCompra(compra)
    expect(r.totalFinal).toBe(16100)
    expect(await db.preciosActuales.get(`${pArroz.presentacion_id}|tienda`)).toMatchObject({ precio: 4200, fuente: 'compra' })
    expect(await db.preciosActuales.get(`${pAceite.presentacion_id}|tienda`)).toBeUndefined()
    const cierre = (await db.outbox.toArray()).find((e) => e.tipo === 'cerrarCompra')!
    const obs = cierre.payload.observaciones as Observacion[]
    expect(obs.map((o) => o.presentacion_id)).toEqual([pArroz.presentacion_id])
    expect((await db.compras.get('c1'))?.estado).toBe('cerrada')
  })
})
