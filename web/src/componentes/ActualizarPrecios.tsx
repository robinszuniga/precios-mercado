import { useState } from 'react'
import type { Presentacion } from '@shared/esquema.ts'
import { useCatalogo } from '../datos/consultas.ts'
import { CuentaCambiada, db, exigirCuenta, generacionActual } from '../datos/db.ts'
import { observacion, registrarObservaciones, guardar } from '../datos/escritura.ts'
import { llamarVtex } from '../datos/apiVtex.ts'
import { presentacionesPorActualizar } from '../datos/actualizarPrecios.ts'
import { Boton } from './ui.tsx'

interface ResultadoPrecio {
  presentacion_id: string
  tienda: Presentacion['tienda']
  region: 'RIOHACHA' | 'DEFAULT'
  precio: number | null
  precio_lista: number | null
  disponible: boolean
  ean: string
  sku_id: string
  vtex_product_id: string
  fecha_observado: string
  error?: string
}

const LOTE = 8

/** Actualiza solo las presentaciones de esta cuenta; cada tanda se autoriza con la sesión Supabase. */
export function ActualizarPrecios() {
  const catalogo = useCatalogo()
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState('')

  async function iniciar() {
    if (!catalogo) return
    // Esta búsqueda es de la cuenta actual: si se cierra la sesión o se cambia de cuenta a mitad, se corta sin escribir.
    const cuenta = generacionActual()
    setOcupado(true)
    setMensaje('Buscando precios en las tiendas…')
    try {
      const [todas, productos, precios] = await Promise.all([db.presentaciones.toArray(), db.productos.toArray(), db.preciosActuales.toArray()])
      exigirCuenta(cuenta)
      // D1 también: su precio de internet es el nacional y sale marcado así (no atiende Riohacha).
      const pendientes = presentacionesPorActualizar(todas, productos, precios, Date.now())
      let actualizadas = 0
      let errores = 0
      // Lo que quedó sin consultar porque el servidor pidió esperar (no son errores: se pide de nuevo en un minuto).
      let faltan = 0
      for (let i = 0; i < pendientes.length; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE)
        setMensaje(`Consultando ${Math.min(i + lote.length, pendientes.length)} de ${pendientes.length} productos…`)
        const r = await llamarVtex<{ resultados: ResultadoPrecio[] }>('actualizarVinculadas', {
          presentaciones: lote.map(({ presentacion_id, tienda, sku_id, ean }) => ({ presentacion_id, tienda, sku_id, ean })),
        }, undefined, cuenta)
        exigirCuenta(cuenta)
        if (r.tipo !== 'ok') {
          if (r.tipo === 'error' && r.codigo === 'rate_limit') { faltan = pendientes.length - i; break }
          errores += lote.length
          continue
        }
        for (const resultado of r.data.resultados) {
          exigirCuenta(cuenta)
          const p = lote.find((x) => x.presentacion_id === resultado.presentacion_id)
          if (!p) continue
          // La búsqueda dura minutos: si mientras tanto esa presentación se borró (su producto se eliminó en otro celular), guardarla
          // de nuevo la repondría con su precio. Se lee otra vez y, si ya no está, se salta.
          if (!(await db.presentaciones.get(p.presentacion_id))) continue
          if (resultado.error) {
            errores++
            await guardar<Presentacion>('Presentaciones', { ...p, ultimo_error: `${new Date().toISOString().slice(0, 10)} ${resultado.error}` })
            continue
          }
          const actualizada = {
            ...p,
            sku_id: resultado.sku_id || p.sku_id,
            vtex_product_id: resultado.vtex_product_id || p.vtex_product_id,
            ultimo_error: '',
          }
          if (actualizada.sku_id !== p.sku_id || actualizada.vtex_product_id !== p.vtex_product_id || p.ultimo_error) {
            await guardar<Presentacion>('Presentaciones', actualizada)
          }
          exigirCuenta(cuenta)
          await registrarObservaciones([observacion({
            presentacion: actualizada,
            precio: resultado.precio,
            precioLista: resultado.precio_lista,
            disponible: resultado.disponible,
            origen: 'online',
            fuente: 'auto',
            region: resultado.region,
            id: `auto:${p.presentacion_id}:${resultado.fecha_observado.slice(0, 13)}`,
          })])
          actualizadas++
        }
      }
      setMensaje(faltan
        ? `Se consultaron ${actualizadas}; faltan ${faltan}${errores ? ` (y ${errores} no se pudieron actualizar)` : ''}. Espera un minuto y toca de nuevo: sigue por las que faltan.`
        : actualizadas || errores
          ? `Listo: ${actualizadas} precios consultados${errores ? `; ${errores} no se pudieron actualizar` : ''}.`
          : pendientes.length === 0 && presentacionesPorActualizar(todas, productos, precios, Infinity).length > 0
            ? 'Los precios de internet ya están al día (se consultaron hace menos de 10 minutos).'
            : 'No hay presentaciones online para actualizar todavía.')
    } catch (e) {
      setMensaje(e instanceof CuentaCambiada
        ? 'La cuenta cambió: se canceló la búsqueda de precios.'
        : 'No pude actualizar los precios. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-1">
      <Boton variante="secundario" className="w-full" onClick={() => void iniciar()} disabled={ocupado || !catalogo}>
        {ocupado ? mensaje || 'Actualizando precios online…' : '↻ Traer precios de Éxito, Olímpica y D1'}
      </Boton>
      {!ocupado && mensaje && <p className="text-center text-sm text-stone-700" role="status">{mensaje}</p>}
    </div>
  )
}
