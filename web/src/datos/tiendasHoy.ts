import { useLiveQuery } from 'dexie-react-hooks'
import { esTienda, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { useMeta } from './consultas.ts'
import { guardarMeta } from './db.ts'
import { compraAbierta, guardar } from './escritura.ts'

function ordenar(ts: Tienda[]): Tienda[] {
  return TIENDAS.filter((t) => ts.includes(t))
}

/**
 * Las tiendas que se visitan hoy. Mientras hay una compra abierta, se leen y escriben en la compra, así Plan y
 * Compra muestran siempre lo mismo. Sin compra, se recuerdan en el celular.
 */
export function useTiendasHoy(): [Tienda[], (t: Tienda) => void] {
  const guardadas = useMeta<Tienda[]>('tiendasHoy', [...TIENDAS])
  const compra = useLiveQuery(() => compraAbierta(), [])
  const deCompra = compra?.tiendas_hoy ? compra.tiendas_hoy.split(',').filter(esTienda) : null
  const tiendas = ordenar(deCompra && deCompra.length ? deCompra : guardadas)
  const alternar = (t: Tienda) => {
    const nuevo = tiendas.includes(t) ? tiendas.filter((x) => x !== t) : ordenar([...tiendas, t])
    const final = nuevo.length ? nuevo : [t]
    void guardarMeta('tiendasHoy', final)
    if (compra) void guardar('Compras', { ...compra, tiendas_hoy: final.join(',') })
  }
  return [tiendas, alternar]
}
