import { useState } from 'react'
import type { Presentacion } from '@shared/esquema.ts'
import { useCatalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { observacion, registrarObservaciones, guardar } from '../datos/escritura.ts'
import { llamarVtex } from '../datos/apiVtex.ts'
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
    setOcupado(true)
    setMensaje('Buscando precios en las tiendas…')
    try {
      const todas = await db.presentaciones.toArray()
      const pendientes = todas.filter((p) => p.activo && p.auto && (p.sku_id || p.ean)
        && (p.tienda === 'EXITO' || p.tienda === 'OLIMPICA' || (p.tienda === 'D1' && catalogo.cfg.autoD1)))
      let actualizadas = 0
      let errores = 0
      for (let i = 0; i < pendientes.length; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE)
        setMensaje(`Consultando ${Math.min(i + lote.length, pendientes.length)} de ${pendientes.length} productos…`)
        const r = await llamarVtex<{ resultados: ResultadoPrecio[] }>('actualizarVinculadas', {
          presentaciones: lote.map(({ presentacion_id, tienda, sku_id, ean }) => ({ presentacion_id, tienda, sku_id, ean })),
        })
        if (r.tipo !== 'ok') {
          errores += lote.length
          if (r.tipo === 'error' && r.codigo === 'rate_limit') break
          continue
        }
        for (const resultado of r.data.resultados) {
          const p = lote.find((x) => x.presentacion_id === resultado.presentacion_id)
          if (!p) continue
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
      setMensaje(actualizadas || errores
        ? `Listo: ${actualizadas} precios consultados${errores ? `; ${errores} no se pudieron actualizar` : ''}.`
        : 'No hay presentaciones online para actualizar todavía.')
    } catch {
      setMensaje('No pude actualizar los precios. Revisa tu conexión e inténtalo de nuevo.')
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
