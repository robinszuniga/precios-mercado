import { useState } from 'react'
import { contenidoCompatible, parseContenido } from '@shared/contenido.ts'
import type { Presentacion, Producto } from '@shared/esquema.ts'
import { INFO_TIENDAS, TIENDAS_VTEX, type TiendaVtex } from '@shared/tiendas.ts'
import { etiquetaVisible, formatoContenido, precioPorUnidad } from '@shared/unidades.ts'
import { llamar } from '../datos/api.ts'
import { crearDesdeCandidato, type Cand } from '../datos/vincularLote.ts'
import { conexion } from '../datos/sync.ts'
import { Boton, Campo, Distintivo, NombreTienda, pesos, Selector } from './ui.tsx'


function textoContenido(c: Cand['contenido']): string {
  return c ? formatoContenido(c.valor, c.unidad).replace('\u00a0', ' ') : ''
}

function FilaCandidato({ c, producto, onElegir }: { c: Cand; producto: Producto; onElegir: () => void }) {
  const compatible = contenidoCompatible(c.contenido, producto.unidad_base)
  const pu = compatible ? precioPorUnidad(c.precio, c.contenido!.valor, producto.unidad_base) : null
  return (
    <li>
      <button type="button" onClick={onElegir} className="w-full py-2 text-left">
        <div className="font-medium">{c.nombre}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-stone-700">
          <NombreTienda tienda={c.tienda} />
          <span>{c.precio != null ? pesos(c.precio) : 'sin precio'}</span>
          {c.oferta && <span className="text-ok">oferta</span>}
          {!c.disponible && <span className="text-peligro">agotado</span>}
          <span>{textoContenido(c.contenido) || 'tamaño ?'}</span>
          {pu != null && <span>· {pesos(pu)}/{etiquetaVisible(producto.unidad_base)}</span>}
          <Distintivo tipo={c.region === 'RIOHACHA' ? 'online' : 'online_nac'} />
        </div>
      </button>
    </li>
  )
}

/** Busca el producto en la tienda online, elige el SKU exacto y luego ofrece el mismo EAN en las otras tiendas. */
export function Vincular({ producto, yaVinculadas, onListo }: { producto: Producto; yaVinculadas: Presentacion[]; onListo: () => void }) {
  const [tienda, setTienda] = useState<TiendaVtex>('EXITO')
  const [q, setQ] = useState(producto.nombre)
  const [cands, setCands] = useState<Cand[] | null>(null)
  const [error, setError] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState<Cand | null>(null)
  const [tamano, setTamano] = useState('')
  const [otras, setOtras] = useState<Cand[] | null>(null)
  const [agregadas, setAgregadas] = useState<string[]>([])

  async function buscar(params: Record<string, unknown>, destino: (c: Cand[]) => void) {
    setBuscando(true)
    setError('')
    const r = await llamar<{ candidatos: Cand[]; errores: string[] }>(await conexion(), 'buscarEnTienda', params)
    setBuscando(false)
    if (r.tipo === 'ok') {
      destino(r.data.candidatos)
      if (r.data.errores.length) setError(r.data.errores.join(' · '))
    } else setError(r.tipo === 'error' ? r.mensaje : `Sin respuesta (${r.motivo}). ¿Hay señal?`)
  }

  async function confirmar() {
    if (!elegido) return
    const c = parseContenido(tamano)
    const contenido = c && c.unidad === producto.unidad_base ? c.valor : null
    await crearDesdeCandidato(producto, elegido, contenido)
    if (elegido.ean) await buscar({ tienda: '*', ean: elegido.ean }, (xs) => setOtras(xs.filter((x) => x.tienda !== elegido.tienda)))
    else onListo()
  }

  if (otras) {
    const pendientes = otras.filter((o) => !yaVinculadas.some((p) => p.tienda === o.tienda && p.sku_id === o.skuId))
    return (
      <div className="space-y-3">
        <p className="text-sm text-stone-600">Listo. Con el mismo código de barras encontré esto en las otras tiendas:</p>
        {pendientes.length === 0 && <p className="text-stone-700">No aparece en las otras tiendas online.</p>}
        <ul className="divide-y divide-stone-100">
          {pendientes.map((o) => (
            <li key={`${o.tienda}-${o.skuId}`} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <NombreTienda tienda={o.tienda} className="text-sm" />
                <div className="truncate">{o.nombre}</div>
                <div className="text-sm text-stone-700">{o.precio != null ? pesos(o.precio) : 'sin precio'}</div>
              </div>
              <Boton
                variante="secundario"
                disabled={agregadas.includes(o.tienda)}
                onClick={async () => {
                  await crearDesdeCandidato(producto, o, contenidoCompatible(o.contenido, producto.unidad_base) ? o.contenido!.valor : (elegido && parseContenido(tamano)?.valor) ?? null)
                  setAgregadas((a) => [...a, o.tienda])
                }}
              >
                {agregadas.includes(o.tienda) ? '✓' : 'Agregar'}
              </Boton>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm font-medium text-peligro">{error}</p>}
        <Boton className="w-full" onClick={onListo}>Terminar</Boton>
      </div>
    )
  }

  if (elegido) {
    const c = parseContenido(tamano)
    const ok = !!c && c.unidad === producto.unidad_base
    return (
      <div className="space-y-3">
        <div>
          <NombreTienda tienda={elegido.tienda} className="text-sm" />
          <div className="font-medium">{elegido.nombre}</div>
          <div className="text-sm text-stone-700">{elegido.precio != null ? pesos(elegido.precio) : 'sin precio'} · SKU {elegido.skuId}</div>
        </div>
        <Campo
          etiqueta="Tamaño del paquete"
          value={tamano}
          onChange={(e) => setTamano(e.target.value)}
          placeholder={producto.unidad_base === 'g' ? '500 g, 1 kg…' : producto.unidad_base === 'ml' ? '900 ml, 1,5 L…' : '30 und'}
          ayuda={ok ? `Se comparará por ${etiquetaVisible(producto.unidad_base)}.` : `Escribe el tamaño en ${producto.unidad_base === 'unidad' ? 'unidades' : producto.unidad_base === 'g' ? 'g o kg' : 'ml o L'} para comparar precios por unidad.`}
        />
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={() => setElegido(null)}>Atrás</Boton>
          <Boton className="flex-1" onClick={confirmar} disabled={buscando}>Vincular</Boton>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Selector etiqueta="Tienda" value={tienda} onChange={(e) => setTienda(e.target.value as TiendaVtex)}>
        {TIENDAS_VTEX.map((t) => <option key={t} value={t}>{INFO_TIENDAS[t].nombre}</option>)}
      </Selector>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void buscar({ tienda, q }, setCands) }}>
        <Campo etiqueta="Buscar" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
        <Boton type="submit" disabled={buscando || !q.trim()}>{buscando ? '…' : 'Buscar'}</Boton>
      </form>
      {error && <p role="alert" className="text-sm font-medium text-peligro">{error}</p>}
      {cands && cands.length === 0 && <p className="text-stone-700">Nada. Prueba con marca y tamaño (ej. “arroz diana 1000”).</p>}
      {cands && (
        <ul className="max-h-[50vh] divide-y divide-stone-100 overflow-y-auto">
          {cands.map((c) => (
            <FilaCandidato key={`${c.tienda}-${c.skuId}`} c={c} producto={producto} onElegir={() => { setElegido(c); setTamano(textoContenido(c.contenido)) }} />
          ))}
        </ul>
      )}
    </div>
  )
}
