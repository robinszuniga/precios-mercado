import { useState } from 'react'
import type { Producto } from '@shared/esquema.ts'
import { eliminarProductos } from '../datos/escritura.ts'
import { avisar, Boton, Hoja } from './ui.tsx'

const MAX_NOMBRES = 6

/**
 * Confirmación para eliminar productos para siempre. Es lo único que no se puede deshacer en toda la app, así que lo
 * dice claro, muestra cuáles son y deja "No, conservar" como salida fácil.
 */
export function EliminarProductos({ productos, abierta, onCerrar, onHecho }: {
  productos: Producto[]
  abierta: boolean
  onCerrar: () => void
  onHecho: () => void
}) {
  const [trabajando, setTrabajando] = useState(false)
  const n = productos.length
  const nombres = productos.slice(0, MAX_NOMBRES).map((p) => p.nombre)

  async function confirmar() {
    if (trabajando) return
    setTrabajando(true)
    try {
      const hechos = await eliminarProductos(productos.map((p) => p.producto_id))
      avisar(hechos === 1 ? 'Producto eliminado para siempre.' : `${hechos} productos eliminados para siempre.`)
      onHecho()
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Hoja abierta={abierta && n > 0} titulo={n === 1 ? 'Eliminar para siempre' : `Eliminar ${n} productos para siempre`} onCerrar={onCerrar}>
      <div className="space-y-3">
        <p>
          {n === 1 ? <>Vas a eliminar <strong>{nombres[0]}</strong>.</> : <>Vas a eliminar: <strong>{nombres.join(', ')}</strong>{n > MAX_NOMBRES ? ` y ${n - MAX_NOMBRES} más` : ''}.</>}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
          <li>Se borran sus marcas, tamaños, precios y el historial de sus precios, también de tus otros celulares.</li>
          <li>Tus compras pasadas se quedan, con el nombre como texto.</li>
          <li><strong>No se puede deshacer.</strong> Si solo quieres que no te estorbe, archívalo: se puede recuperar.</li>
        </ul>
        <Boton variante="peligro" className="w-full" disabled={trabajando} onClick={() => void confirmar()}>
          {trabajando ? 'Eliminando…' : 'Sí, eliminar para siempre'}
        </Boton>
        <Boton variante="secundario" className="w-full" onClick={onCerrar}>No, conservar</Boton>
      </div>
    </Hoja>
  )
}
