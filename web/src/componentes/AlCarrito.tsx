import { useRef, useState } from 'react'
import { parseContenido } from '@shared/contenido.ts'
import type { Detalle, Presentacion, Producto } from '@shared/esquema.ts'
import { precioEfectivo, type PrecioEfectivo } from '@shared/precioEfectivo.ts'
import { subtotal } from '@shared/presupuesto.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible, formatoCantidadVisible } from '@shared/unidades.ts'
import type { Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { guardar, nuevaPresentacion } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { describirPresentacion, precioAtipico } from './RegistrarPrecio.tsx'
import { avisar, Boton, Campo, hace, leerNumero, Pasos, pesos, Selector } from './ui.tsx'

export interface Sugerencia {
  tienda: Tienda
  presentacion: Presentacion
  paquetes: number
}

function efectivoDe(cat: Catalogo, p: Presentacion | undefined): PrecioEfectivo | null {
  return p ? precioEfectivo(cat.actualesDe.get(p.presentacion_id) ?? [], cat.cfg.vigencias, ahoraIso()).efectivo : null
}

/** El sugerido viene de la tienda (y no es viejo): aceptarlo es confirmarlo. Si viene de internet, hay que mirarlo. */
export function sugeridoConfiable(e: PrecioEfectivo | null): boolean {
  return !!e && e.distintivo === 'tienda' && e.estado === 'vigente'
}

function OrigenSugerido({ e }: { e: PrecioEfectivo | null }) {
  if (!e) return null
  if (sugeridoConfiable(e)) return <>Precio que viste en la tienda {hace(e.edadDias)}.</>
  const origen = e.distintivo === 'online_nac' ? 'precio nacional de internet' : e.distintivo === 'online' ? 'precio online' : 'precio de tienda viejo'
  return <>Sugerido: {origen} ({hace(e.edadDias)}). Cámbialo si la etiqueta dice otro.</>
}

/** Marca un ítem como comprado con su precio real. Solo lo confirmado se vuelve precio de tienda al cerrar. */
export function AlCarrito({ d, producto, cat, sugerencia, tiendasHoy, onListo }: {
  d: Detalle
  producto: Producto
  cat: Catalogo
  sugerencia?: Sugerencia
  tiendasHoy: Tienda[]
  onListo: () => void
}) {
  const presentaciones = (cat.presentacionesDe.get(producto.producto_id) ?? []).filter((p) => p.activo)
  const primeraDe = (t: Tienda) => presentaciones.find((p) => p.tienda === t)?.presentacion_id ?? '__nueva'
  const inicialTienda = (d.tienda || sugerencia?.tienda || tiendasHoy[0] || 'EXITO') as Tienda
  const [tienda, setTienda] = useState<Tienda>(inicialTienda)
  const deTienda = presentaciones.filter((p) => p.tienda === tienda)
  const [presId, setPresId] = useState(d.presentacion_id || sugerencia?.presentacion.presentacion_id || primeraDe(inicialTienda))
  const pres = deTienda.find((p) => p.presentacion_id === presId)
  const efectivo = efectivoDe(cat, pres)
  const [cantidad, setCantidad] = useState(String(d.cantidad ?? sugerencia?.paquetes ?? 1).replace('.', ','))
  const [precio, setPrecio] = useState(d.precio_unitario != null ? String(d.precio_unitario) : efectivo ? String(efectivo.precio) : '')
  /** El usuario escribió o cambió el precio. */
  const [tocado, setTocado] = useState(d.precio_confirmado ?? false)
  const [marca, setMarca] = useState('')
  const [tamano, setTamano] = useState('')
  const [necesidad, setNecesidad] = useState(d.necesidad ?? producto.cantidad_habitual ?? 1)
  const [confirmando, setConfirmando] = useState(false)
  const ocupado = useRef(false)

  /** El ítem como está ahora en la base: la hoja se abrió con una copia y la cantidad pudo cambiar desde entonces. */
  async function actual(): Promise<Detalle> {
    return (await db.detalle.get(d.detalle_id)) ?? d
  }

  /** Un solo guardado a la vez: un doble toque no guarda dos veces. */
  async function unaVez(fn: () => Promise<void>) {
    if (ocupado.current) return
    ocupado.current = true
    try { await fn() } finally { ocupado.current = false }
  }

  function cambiarTienda(t: Tienda) {
    setTienda(t)
    const id = primeraDe(t)
    setPresId(id)
    const e = efectivoDe(cat, presentaciones.find((p) => p.presentacion_id === id))
    setPrecio(e ? String(e.precio) : '')
    setTocado(false)
    setConfirmando(false)
  }

  function cambiarPresentacion(id: string) {
    setPresId(id)
    const e = efectivoDe(cat, deTienda.find((x) => x.presentacion_id === id))
    setPrecio(e ? String(e.precio) : '')
    setTocado(false)
    setConfirmando(false)
  }

  const nCantidad = leerNumero(cantidad)
  const nPrecio = leerNumero(precio)
  const esGranel = pres?.granel ?? false
  const atipico = !!nPrecio && tocado && precioAtipico(nPrecio, efectivo?.precio)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nCantidad || !nPrecio) return
    if (atipico && !confirmando) { setConfirmando(true); return }
    await unaVez(() => alCarrito(nCantidad, nPrecio))
  }

  async function alCarrito(nCantidad: number, nPrecio: number) {
    let p = pres
    if (!p) {
      const c = parseContenido(tamano)
      ;[p] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
        producto_id: producto.producto_id, tienda, marca: marca.trim(), nombre_en_tienda: [marca.trim(), tamano.trim()].filter(Boolean).join(' '),
        contenido: c && c.unidad === producto.unidad_base ? c.valor : null,
      }))
    }
    const ahora = await actual()
    const antes = { ...ahora }
    const precioFinal = Math.round(nPrecio)
    await guardar('Compras_detalle', {
      ...ahora, necesidad, tienda, presentacion_id: p.presentacion_id, cantidad: nCantidad, precio_unitario: precioFinal,
      subtotal: subtotal(nCantidad, precioFinal), estado: 'en_carrito',
      precio_confirmado: tocado || sugeridoConfiable(efectivo),
    })
    avisar(`${producto.nombre} al carrito · ${pesos(subtotal(nCantidad, precioFinal))}`, () => guardar('Compras_detalle', antes).then(() => undefined))
    onListo()
  }

  async function cambiarNecesidad(v: number) {
    setNecesidad(v)
    await guardar('Compras_detalle', { ...(await actual()), necesidad: v })
  }

  const u = etiquetaVisible(producto.unidad_base)
  return (
    <form onSubmit={enviar} className="space-y-3">
      {d.estado === 'pendiente' && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white p-2 ring-1 ring-stone-200">
          <span className="text-sm text-stone-700">Esta vez necesito</span>
          <Pasos valor={necesidad} paso={producto.unidad_base === 'unidad' ? 1 : 0.5} minimo={0.5} etiqueta="cantidad" sufijo={u} onCambio={(v) => void cambiarNecesidad(v)} />
        </div>
      )}
      <Selector etiqueta="Tienda" value={tienda} onChange={(e) => cambiarTienda(e.target.value as Tienda)}>
        {TIENDAS.map((t) => <option key={t} value={t}>{INFO_TIENDAS[t].nombre}</option>)}
      </Selector>
      <Selector etiqueta="Lo que tomaste" value={pres ? presId : '__nueva'} onChange={(e) => cambiarPresentacion(e.target.value)}>
        {deTienda.map((p) => <option key={p.presentacion_id} value={p.presentacion_id}>{describirPresentacion(p, producto)}</option>)}
        <option value="__nueva">+ Otra marca o tamaño…</option>
      </Selector>
      {!pres && (
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
          <Campo etiqueta="Tamaño" value={tamano} onChange={(e) => setTamano(e.target.value)} placeholder={producto.unidad_base === 'g' ? 'Ej: 500 g' : producto.unidad_base === 'ml' ? 'Ej: 1 L' : 'Ej: 30 und'} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta={esGranel ? `Cantidad (${u})` : 'Paquetes'} inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Campo
          etiqueta={esGranel ? `Precio por ${u}` : 'Precio c/u'}
          inputMode="numeric"
          value={precio}
          onChange={(e) => { setPrecio(e.target.value); setTocado(true); setConfirmando(false) }}
          placeholder="Ej: 4.500"
        />
      </div>
      <p className={`text-xs ${sugeridoConfiable(efectivo) || tocado ? 'text-stone-600' : 'font-medium text-alerta'}`}>
        {tocado ? 'Precio escrito por ti: queda como precio de tienda.' : <OrigenSugerido e={efectivo} />}
      </p>
      {confirmando && atipico && <p role="alert" className="text-sm font-medium text-alerta">Antes costaba {pesos(efectivo!.precio)}. ¿Seguro que es {pesos(nPrecio)}?</p>}
      {nCantidad && nPrecio ? (
        <p className="text-right text-lg font-semibold">
          Subtotal {pesos(subtotal(nCantidad, Math.round(nPrecio)))}
          {esGranel && <span className="block text-xs font-normal text-stone-600">{formatoCantidadVisible(nCantidad, producto.unidad_base)} × {pesos(nPrecio)}/{u}</span>}
        </p>
      ) : null}
      <Boton type="submit" className="w-full" disabled={!nCantidad || !nPrecio}>{confirmando && atipico ? `Sí, es ${pesos(nPrecio)}` : 'Al carrito'}</Boton>
      <div className="flex gap-2">
        {d.estado === 'en_carrito' && (
          <Boton variante="secundario" className="flex-1" onClick={async () => {
            const ahora = await actual()
            const antes = { ...ahora }
            await guardar('Compras_detalle', { ...ahora, estado: 'pendiente', subtotal: null })
            avisar(`${producto.nombre} volvió a pendientes`, () => guardar('Compras_detalle', antes).then(() => undefined))
            onListo()
          }}>
            Sacar del carrito
          </Boton>
        )}
        <Boton variante="secundario" className="flex-1" onClick={async () => {
          const ahora = await actual()
          const antes = { ...ahora }
          await guardar('Compras_detalle', { ...ahora, estado: 'no_encontrado', subtotal: null })
          avisar(`${producto.nombre}: no lo encontraste`, () => guardar('Compras_detalle', antes).then(() => undefined))
          onListo()
        }}>
          No lo encontré
        </Boton>
      </div>
      <Boton variante="fantasma" className="w-full text-peligro" onClick={async () => {
        const ahora = await actual()
        const antes = { ...ahora }
        await guardar('Compras_detalle', { ...ahora, borrado: true })
        avisar(`${producto.nombre} quitado de esta compra`, () => guardar('Compras_detalle', antes).then(() => undefined))
        onListo()
      }}>
        Quitar de esta compra
      </Boton>
    </form>
  )
}

/** Ítem que no está en el catálogo. Sirve para crearlo y para editarlo o quitarlo. */
export function ItemLibre({ compraId, onListo, crear, existente }: {
  compraId: string
  onListo: () => void
  crear: (compraId: string, p: Partial<Detalle>) => Detalle
  existente?: Detalle
}) {
  const [nombre, setNombre] = useState(existente?.nombre_libre ?? '')
  const [precio, setPrecio] = useState(existente?.precio_unitario != null ? String(existente.precio_unitario) : '')
  const [cantidad, setCantidad] = useState(String(existente?.cantidad ?? 1).replace('.', ','))
  const nP = leerNumero(precio)
  const nC = leerNumero(cantidad)
  const ocupado = useRef(false)
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!nombre.trim() || !nP || !nC || ocupado.current) return
        ocupado.current = true
        const datos = { nombre_libre: nombre.trim(), cantidad: nC, precio_unitario: Math.round(nP), subtotal: subtotal(nC, Math.round(nP)), estado: 'en_carrito' as const, precio_confirmado: true }
        await guardar('Compras_detalle', existente ? { ...existente, ...datos } : crear(compraId, datos))
        avisar(`${nombre.trim()} al carrito · ${pesos(datos.subtotal)}`)
        onListo()
      }}
    >
      {!existente && <p className="text-sm text-stone-600">Algo que no está en tu catálogo (un antojo, algo de una vez). Cuenta para el presupuesto.</p>}
      <Campo etiqueta="Qué es" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus={!existente} />
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Campo etiqueta="Precio c/u" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 3.500" />
      </div>
      <Boton type="submit" className="w-full" disabled={!nombre.trim() || !nP || !nC}>{existente ? 'Guardar' : 'Al carrito'}</Boton>
      {existente && (
        <Boton variante="fantasma" className="w-full text-peligro" onClick={async () => {
          const antes = { ...existente }
          await guardar('Compras_detalle', { ...existente, borrado: true })
          avisar(`${existente.nombre_libre} quitado`, () => guardar('Compras_detalle', antes).then(() => undefined))
          onListo()
        }}>
          Quitar
        </Boton>
      )}
    </form>
  )
}
