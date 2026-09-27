import { useState } from 'react'
import { parseContenido } from '@shared/contenido.ts'
import type { Detalle, Presentacion, Producto } from '@shared/esquema.ts'
import { precioEfectivo } from '@shared/precioEfectivo.ts'
import { subtotal } from '@shared/presupuesto.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible, factorVisible } from '@shared/unidades.ts'
import type { Catalogo } from '../datos/consultas.ts'
import { guardar, nuevaPresentacion } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { describirPresentacion } from './RegistrarPrecio.tsx'
import { Boton, Campo, leerNumero, pesos, Selector } from './ui.tsx'

export interface Sugerencia {
  tienda: Tienda
  presentacion: Presentacion
  paquetes: number
}

/** Marca un ítem como comprado con su precio real. El precio pagado se vuelve precio de tienda al cerrar. */
export function AlCarrito({ d, producto, cat, sugerencia, tiendasHoy, onListo }: {
  d: Detalle
  producto: Producto
  cat: Catalogo
  sugerencia?: Sugerencia
  tiendasHoy: Tienda[]
  onListo: () => void
}) {
  const presentaciones = (cat.presentacionesDe.get(producto.producto_id) ?? []).filter((p) => p.activo)
  const inicialTienda = (d.tienda || sugerencia?.tienda || tiendasHoy[0] || 'EXITO') as Tienda
  const [tienda, setTienda] = useState<Tienda>(inicialTienda)
  const deTienda = presentaciones.filter((p) => p.tienda === tienda)
  const [presId, setPresId] = useState(d.presentacion_id || sugerencia?.presentacion.presentacion_id || deTienda[0]?.presentacion_id || '__nueva')
  const pres = deTienda.find((p) => p.presentacion_id === presId)
  const precioConocido = pres ? precioEfectivo(cat.actualesDe.get(pres.presentacion_id) ?? [], cat.cfg.vigencias, ahoraIso()).efectivo?.precio : undefined
  const [cantidad, setCantidad] = useState(String(d.cantidad ?? sugerencia?.paquetes ?? 1).replace('.', ','))
  const [precio, setPrecio] = useState(d.precio_unitario != null ? String(d.precio_unitario) : precioConocido != null ? String(precioConocido) : '')
  const [marca, setMarca] = useState('')
  const [tamano, setTamano] = useState('')

  function cambiarPresentacion(id: string) {
    setPresId(id)
    const p = deTienda.find((x) => x.presentacion_id === id)
    const e = p ? precioEfectivo(cat.actualesDe.get(p.presentacion_id) ?? [], cat.cfg.vigencias, ahoraIso()).efectivo : null
    if (e) setPrecio(String(e.precio))
  }

  const nCantidad = leerNumero(cantidad)
  const nPrecio = leerNumero(precio)
  const esGranel = pres?.granel ?? false

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nCantidad || !nPrecio) return
    let p = pres
    if (!p) {
      const c = parseContenido(tamano)
      ;[p] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
        producto_id: producto.producto_id, tienda, marca: marca.trim(), nombre_en_tienda: [marca.trim(), tamano.trim()].filter(Boolean).join(' '),
        contenido: c && c.unidad === producto.unidad_base ? c.valor : null,
      }))
    }
    await guardar('Compras_detalle', {
      ...d, tienda, presentacion_id: p.presentacion_id, cantidad: nCantidad, precio_unitario: Math.round(nPrecio),
      subtotal: subtotal(nCantidad, Math.round(nPrecio)), estado: 'en_carrito',
    })
    onListo()
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Selector etiqueta="Tienda" value={tienda} onChange={(e) => { setTienda(e.target.value as Tienda); setPresId('__nueva'); setPrecio('') }}>
        {TIENDAS.map((t) => <option key={t} value={t}>{INFO_TIENDAS[t].nombre}</option>)}
      </Selector>
      <Selector etiqueta="Lo que tomaste" value={pres ? presId : '__nueva'} onChange={(e) => cambiarPresentacion(e.target.value)}>
        {deTienda.map((p) => <option key={p.presentacion_id} value={p.presentacion_id}>{describirPresentacion(p, producto)}</option>)}
        <option value="__nueva">+ Otra marca o tamaño…</option>
      </Selector>
      {!pres && (
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
          <Campo etiqueta="Tamaño" value={tamano} onChange={(e) => setTamano(e.target.value)} placeholder={producto.unidad_base === 'g' ? '500 g' : producto.unidad_base === 'ml' ? '1 L' : '30 und'} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta={esGranel ? `Cantidad (${etiquetaVisible(producto.unidad_base)})` : 'Paquetes'} inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Campo etiqueta={esGranel ? `Precio por ${etiquetaVisible(producto.unidad_base)}` : 'Precio c/u'} inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="4.500" />
      </div>
      {nCantidad && nPrecio ? <p className="text-right text-lg font-semibold">Subtotal {pesos(subtotal(nCantidad, Math.round(nPrecio)))}</p> : null}
      {esGranel && pres && <p className="text-xs text-stone-500">Granel: la cantidad va en {etiquetaVisible(producto.unidad_base)} (ej. 1,37). Contenido base {factorVisible(producto.unidad_base)}.</p>}
      <Boton type="submit" className="w-full" disabled={!nCantidad || !nPrecio}>Al carrito</Boton>
      <div className="flex gap-2">
        {d.estado === 'en_carrito' && (
          <Boton variante="secundario" className="flex-1" onClick={async () => { await guardar('Compras_detalle', { ...d, estado: 'pendiente', subtotal: null }); onListo() }}>
            Sacar del carrito
          </Boton>
        )}
        <Boton variante="secundario" className="flex-1" onClick={async () => { await guardar('Compras_detalle', { ...d, estado: 'no_encontrado', subtotal: null }); onListo() }}>
          No lo encontré
        </Boton>
      </div>
    </form>
  )
}

export function ItemLibre({ compraId, onListo, crear }: { compraId: string; onListo: () => void; crear: (compraId: string, p: Partial<Detalle>) => Detalle }) {
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const nP = leerNumero(precio)
  const nC = leerNumero(cantidad)
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!nombre.trim() || !nP || !nC) return
        await guardar('Compras_detalle', crear(compraId, {
          nombre_libre: nombre.trim(), cantidad: nC, precio_unitario: Math.round(nP), subtotal: subtotal(nC, Math.round(nP)), estado: 'en_carrito',
        }))
        onListo()
      }}
    >
      <p className="text-sm text-stone-500">Algo que no está en tu catálogo (un antojo, algo de una vez). Cuenta para el presupuesto.</p>
      <Campo etiqueta="Qué es" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Campo etiqueta="Precio c/u" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} />
      </div>
      <Boton type="submit" className="w-full" disabled={!nombre.trim() || !nP || !nC}>Al carrito</Boton>
    </form>
  )
}
