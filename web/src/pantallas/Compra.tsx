import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Compra as TCompra, Detalle } from '@shared/esquema.ts'
import { formatoNumero } from '@shared/dinero.ts'
import { precioEfectivo } from '@shared/precioEfectivo.ts'
import { estadoPresupuesto, subtotal } from '@shared/presupuesto.ts'
import { planCompra } from '@shared/recomendacion.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { formatoCantidadVisible } from '@shared/unidades.ts'
import { ir } from '../app/ruta.ts'
import { AlCarrito, ItemLibre, sugeridoConfiable, type Sugerencia } from '../componentes/AlCarrito.tsx'
import { BarraPresupuesto } from '../componentes/BarraPresupuesto.tsx'
import { describirPresentacion } from '../componentes/RegistrarPrecio.tsx'
import { avisar, Boton, Campo, Cargando, ChipTienda, Hoja, leerNumero, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { cerrarCompra } from '../datos/cierre.ts'
import { comparadorPasillo, itemsDelPlan, useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, asegurarCompra, compraAbierta, guardar, nuevoDetalle } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'
import { BotonModoTienda } from '../escaner/ModoTienda.tsx'
import { EditarPresupuesto } from './Plan.tsx'

function Empezar({ compra, tiendasHoy, alternar }: { compra?: TCompra; tiendasHoy: Tienda[]; alternar: (t: Tienda) => void }) {
  const [presupuesto, setPresupuesto] = useState(compra?.presupuesto ? String(compra.presupuesto) : '')
  const n = leerNumero(presupuesto)
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const c = compra ?? (await asegurarCompra(tiendasHoy))
        await guardar('Compras', { ...c, estado: 'en_curso', presupuesto: n && n > 0 ? Math.round(n) : null, tiendas_hoy: tiendasHoy.join(','), fecha_inicio: ahoraIso() })
      }}
    >
      <Titulo>Empezar a comprar</Titulo>
      <Campo etiqueta="Presupuesto de hoy" inputMode="numeric" placeholder="Ej: 300.000" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value)} ayuda={n ? pesos(n) : 'Opcional. Sin presupuesto solo verás cuánto llevas.'} />
      <div>
        <p className="mb-1 text-sm text-stone-700">Tiendas que visitas hoy</p>
        <div className="flex flex-wrap gap-2">{TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tiendasHoy.includes(t)} onClick={() => alternar(t)} />)}</div>
      </div>
      <Boton type="submit" className="w-full">Empezar compra</Boton>
      {!compra && <p className="text-center text-sm text-stone-600">Se arma con tus productos ★. Puedes quitar o cambiar cantidades después.</p>}
    </form>
  )
}

function Agregar({ cat, tiendasHoy, onListo }: { cat: Catalogo; tiendasHoy: Tienda[]; onListo: () => void }) {
  const [q, setQ] = useState('')
  const nq = normalizar(q)
  const xs = cat.productos.filter((p) => p.activo && (!nq || normalizar(p.nombre).includes(nq))).slice(0, 30)
  return (
    <div className="space-y-2">
      <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tus productos…" aria-label="Buscar en tus productos" className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5" />
      <ul className="max-h-[50dvh] divide-y divide-stone-100 overflow-y-auto">
        {xs.map((p) => (
          <li key={p.producto_id}>
            <button type="button" className="min-h-11 w-full py-2 text-left active:bg-stone-100" onClick={async () => { await agregarALaCompra(p, tiendasHoy); avisar(`${p.nombre} agregado`); onListo() }}>{p.nombre}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Dialogo = null | { detalle: Detalle } | { libre: Detalle | null } | 'agregar' | 'cerrar' | 'descartar' | 'presupuesto'

export function Compra() {
  const cat = useCatalogo()
  const [tiendasHoy, alternar] = useTiendasHoy()
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [cerrando, setCerrando] = useState(false)
  const datos = useLiveQuery(async () => {
    const compra = await compraAbierta()
    const detalles = compra ? (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado) : []
    return { compra, detalles }
  }, [])
  if (!cat || !datos) return <Cargando />
  const { compra, detalles } = datos
  if (!compra || compra.estado === 'borrador') return <Empezar compra={compra} tiendasHoy={tiendasHoy} alternar={alternar} />

  const ahora = ahoraIso()
  const plan = planCompra(itemsDelPlan(cat, detalles, ahora, tiendasHoy), tiendasHoy, cat.cfg.ahorroMinimoTienda)
  const sugerencias = new Map<string, Sugerencia & { costo: number }>()
  for (const g of plan.grupos) for (const it of g.items) sugerencias.set(it.id, { tienda: g.tienda, presentacion: it.costo.opcion.presentacion, paquetes: it.costo.paquetes, costo: it.costo.costoReal })
  const estado = estadoPresupuesto(detalles, compra.presupuesto, cat.cfg.alertaPresupuesto, plan.total)
  const orden = comparadorPasillo(cat)
  const pendientes = detalles.filter((d) => d.estado === 'pendiente').sort((a, b) => orden(a.producto_id, b.producto_id))
  const enCarrito = detalles.filter((d) => d.estado === 'en_carrito')
  const noEncontrados = detalles.filter((d) => d.estado === 'no_encontrado')
  const cerrar = () => setDialogo(null)
  const total = pendientes.length + enCarrito.length + noEncontrados.length
  const pasilloDe = (d: Detalle) => cat.categorias.find((c) => c.categoria_id === cat.producto.get(d.producto_id)?.categoria_id)?.nombre ?? ''

  const porTienda = new Map<string, Detalle[]>()
  for (const d of pendientes) {
    const t = d.tienda || sugerencias.get(d.detalle_id)?.tienda || ''
    porTienda.set(t, [...(porTienda.get(t) ?? []), d])
  }
  const ordenGrupos = [...tiendasHoy.filter((t) => porTienda.has(t)), ...TIENDAS.filter((t) => !tiendasHoy.includes(t) && porTienda.has(t)), ...(porTienda.has('') ? [''] : [])]
  const nombre = (d: Detalle) => (d.producto_id ? cat.producto.get(d.producto_id)?.nombre ?? '?' : d.nombre_libre)

  /** Si el precio sugerido ya es de tienda y reciente, un toque en el círculo basta. */
  async function marcarRapido(d: Detalle) {
    const s = sugerencias.get(d.detalle_id)
    const e = s ? precioEfectivo(cat!.actualesDe.get(s.presentacion.presentacion_id) ?? [], cat!.cfg.vigencias, ahora).efectivo : null
    if (!s || !e || !sugeridoConfiable(e)) { setDialogo({ detalle: d }); return }
    const antes = { ...d }
    await guardar('Compras_detalle', {
      ...d, tienda: s.tienda, presentacion_id: s.presentacion.presentacion_id, cantidad: s.paquetes, precio_unitario: e.precio,
      subtotal: subtotal(s.paquetes, e.precio), estado: 'en_carrito', precio_confirmado: true,
    })
    avisar(`${nombre(d)} al carrito · ${pesos(subtotal(s.paquetes, e.precio))}`, () => guardar('Compras_detalle', antes).then(() => undefined))
  }

  const detalleDialogo = dialogo && typeof dialogo === 'object' && 'detalle' in dialogo ? dialogo.detalle : null
  const productoDialogo = detalleDialogo?.producto_id ? cat.producto.get(detalleDialogo.producto_id) : undefined
  const libreDialogo = dialogo && typeof dialogo === 'object' && 'libre' in dialogo ? dialogo : null

  return (
    <section className="space-y-3">
      <Titulo sub={`${enCarrito.length} de ${total} en el carrito`}>
        Comprando en {tiendasHoy.map((t) => INFO_TIENDAS[t].nombre).join(' y ')}
      </Titulo>
      <div className="sticky top-0 z-20 -mx-4 bg-fondo/95 px-4 pt-1 pb-2 backdrop-blur">
        <BarraPresupuesto estado={estado} onEditar={() => setDialogo('presupuesto')} compacta />
      </div>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-marca">Cambiar tiendas de hoy</summary>
        <div className="flex flex-wrap gap-2 pb-2">{TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tiendasHoy.includes(t)} onClick={() => alternar(t)} />)}</div>
      </details>

      {detalles.length === 0 && <Vacio>La compra está vacía. Agrega productos abajo o desde la pestaña Productos.</Vacio>}

      {ordenGrupos.map((t) => {
        let pasilloPrevio = ''
        return (
          <Tarjeta key={t || 'sin'} className="px-2">
            <h2 className="mb-1 px-1 text-sm font-semibold">{t ? <NombreTienda tienda={t as Tienda} tam={22} /> : 'Sin precio conocido'}</h2>
            <ul>
              {porTienda.get(t)!.map((d) => {
                const s = sugerencias.get(d.detalle_id)
                const p = cat.producto.get(d.producto_id)
                const pasillo = pasilloDe(d)
                const mostrarPasillo = pasillo !== pasilloPrevio
                pasilloPrevio = pasillo
                return (
                  <li key={d.detalle_id}>
                    {mostrarPasillo && pasillo && <p className="px-1 pt-2 text-xs font-semibold tracking-wide text-stone-600 uppercase">{pasillo}</p>}
                    <div className="flex items-center gap-1 border-b border-stone-100">
                      <button
                        type="button"
                        aria-label={`Marcar ${nombre(d)} como comprado`}
                        className="grid size-11 shrink-0 place-items-center rounded-full active:bg-stone-100"
                        onClick={() => void marcarRapido(d)}
                      >
                        <span aria-hidden className="size-6 rounded-full border-2 border-stone-400" />
                      </button>
                      <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center gap-2 py-2 text-left active:bg-stone-100" onClick={() => setDialogo({ detalle: d })}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{nombre(d)}</span>
                          {s && p && <span className="block truncate text-sm text-stone-700">{s.presentacion.granel ? formatoCantidadVisible(s.paquetes, p.unidad_base) : `${s.paquetes} ×`} {describirPresentacion(s.presentacion, p)}</span>}
                        </span>
                        {s && <span className="shrink-0 text-sm text-stone-700"><abbr title="aproximadamente" className="no-underline">≈</abbr> {pesos(s.costo)}</span>}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Tarjeta>
        )
      })}

      {enCarrito.length > 0 && (
        <Tarjeta className="px-2">
          <h2 className="mb-1 px-1 text-sm font-semibold text-ok">En el carrito ({enCarrito.length})</h2>
          <ul>
            {enCarrito.map((d) => (
              <li key={d.detalle_id} className="border-b border-stone-100 last:border-0">
                <button type="button" className="flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left active:bg-stone-100" onClick={() => setDialogo(d.producto_id ? { detalle: d } : { libre: d })}>
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-ok text-sm text-white">✓</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-stone-700 line-through">{nombre(d)}</span>
                    <span className="block text-xs text-stone-700">
                      {formatoNumero(d.cantidad ?? 0)} × {pesos(d.precio_unitario)}{d.tienda && ` · ${INFO_TIENDAS[d.tienda].nombre}`}
                      {d.producto_id && !d.precio_confirmado && <span className="text-alerta"> · precio sin confirmar</span>}
                    </span>
                  </span>
                  <span className="font-medium">{pesos(d.subtotal)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {noEncontrados.length > 0 && (
        <Tarjeta>
          <h2 className="mb-1 text-sm font-semibold text-stone-700">No los encontraste</h2>
          <ul className="text-sm">
            {noEncontrados.map((d) => (
              <li key={d.detalle_id}>
                <button type="button" className="min-h-11 py-1 text-left text-marca underline" onClick={() => void guardar('Compras_detalle', { ...d, estado: 'pendiente' })}>{nombre(d)} · volver a buscar</button>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <BotonModoTienda className="w-full" />
      <div className="grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={() => setDialogo('agregar')}>+ Producto</Boton>
        <Boton variante="secundario" onClick={() => setDialogo({ libre: null })}>+ Algo más</Boton>
      </div>
      <Boton className="w-full" onClick={() => setDialogo('cerrar')} disabled={enCarrito.length === 0}>Terminar y cerrar compra</Boton>
      {enCarrito.length === 0 && <p className="text-center text-xs text-stone-600">Marca al menos un producto para poder cerrar.</p>}
      <div className="pt-4 text-center">
        <button type="button" className="min-h-11 px-3 text-sm text-stone-600 underline" onClick={() => setDialogo('descartar')}>Descartar esta compra…</button>
      </div>

      <Hoja abierta={!!detalleDialogo && !!productoDialogo} titulo={productoDialogo?.nombre ?? ''} onCerrar={cerrar} protegida>
        {detalleDialogo && productoDialogo && (
          <AlCarrito d={detalleDialogo} producto={productoDialogo} cat={cat} sugerencia={sugerencias.get(detalleDialogo.detalle_id)} tiendasHoy={tiendasHoy} onListo={cerrar} />
        )}
      </Hoja>
      <Hoja abierta={!!libreDialogo} titulo={libreDialogo?.libre ? libreDialogo.libre.nombre_libre : 'Algo que no está en tus productos'} onCerrar={cerrar} protegida>
        {libreDialogo && <ItemLibre compraId={compra.compra_id} crear={nuevoDetalle} existente={libreDialogo.libre ?? undefined} onListo={cerrar} />}
      </Hoja>
      <Hoja abierta={dialogo === 'agregar'} titulo="Agregar a la compra" onCerrar={cerrar}>
        <Agregar cat={cat} tiendasHoy={tiendasHoy} onListo={cerrar} />
      </Hoja>
      <Hoja abierta={dialogo === 'presupuesto'} titulo="Presupuesto de esta compra" onCerrar={cerrar} protegida>
        <EditarPresupuesto valor={compra.presupuesto} onGuardar={async (v) => { await guardar('Compras', { ...compra, presupuesto: v }); cerrar() }} />
      </Hoja>
      <Hoja abierta={dialogo === 'cerrar'} titulo="¿Terminaste?" onCerrar={cerrar}>
        <div className="space-y-3">
          <p>Llevas <strong>{pesos(estado.gastado)}</strong> en {enCarrito.length} productos.{pendientes.length > 0 && ` Quedan ${pendientes.length} sin comprar: no se cuentan.`}</p>
          <p className="text-sm text-stone-700">Los precios que confirmaste quedan como precios de tienda y mandan en las próximas comparaciones.</p>
          <Boton
            className="w-full"
            disabled={cerrando}
            onClick={async () => {
              setCerrando(true)
              try {
                await cerrarCompra(compra)
                ir(`historico/compra/${encodeURIComponent(compra.compra_id)}`)
              } finally {
                setCerrando(false)
              }
            }}
          >
            Sí, cerrar compra
          </Boton>
          <Boton variante="secundario" className="w-full" onClick={cerrar}>Seguir comprando</Boton>
        </div>
      </Hoja>
      <Hoja abierta={dialogo === 'descartar'} titulo="¿Descartar esta compra?" onCerrar={cerrar}>
        <div className="space-y-3">
          <p>Se pierden los {enCarrito.length} productos del carrito y lo que anotaste en esta compra. No cuenta para el historial.</p>
          <Boton
            variante="peligro"
            className="w-full"
            onClick={async () => {
              await guardar('Compras', { ...compra, estado: 'cancelada' })
              avisar('Compra descartada', () => guardar('Compras', compra).then(() => undefined))
              cerrar()
            }}
          >
            Sí, descartar
          </Boton>
          <Boton variante="secundario" className="w-full" onClick={cerrar}>No, seguir</Boton>
        </div>
      </Hoja>
    </section>
  )
}
