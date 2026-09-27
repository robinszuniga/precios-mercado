import { TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { useMeta } from './consultas.ts'
import { guardarMeta } from './db.ts'

export function useTiendasHoy(): [Tienda[], (t: Tienda) => void] {
  const tiendas = useMeta<Tienda[]>('tiendasHoy', [...TIENDAS])
  const alternar = (t: Tienda) => {
    const nuevo = tiendas.includes(t) ? tiendas.filter((x) => x !== t) : TIENDAS.filter((x) => x === t || tiendas.includes(x))
    void guardarMeta('tiendasHoy', nuevo.length ? nuevo : [t])
  }
  return [tiendas, alternar]
}
