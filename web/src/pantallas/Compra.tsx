import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Compra as TCompra, Detalle } from '@shared/esquema.ts'
import { estadoPresupuesto } from '@shared/presupuesto.ts'
import { planCompra } from '@shared/recomendacion.ts'
import { esTienda, INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { ir } from '../app/ruta.ts'
import { AlCarrito, ItemLibre, type Sugerencia } from '../componentes/AlCarrito.tsx'
import { BarraPresupuesto } from '../componentes/BarraPresupuesto.tsx'
import { describirPresentacion } from '../componentes/RegistrarPrecio.tsx'
import { Boton, Campo, ChipTienda, Hoja, leerNumero, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { cerrarCompra } from '../datos/cierre.ts'
import { itemsDelPlan, useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, asegurarCompra, compraAbierta, guardar, nuevoDetalle } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'

function Empezar({ compra, tiendasHoy, alternar }: { compra?: TCompra; tiendasHoy: Tienda[]; alternar: (t: Tienda) => void }) {
  const [presupuesto, setPresupuesto] = useState(compra?.presupuesto ? String(compra.presupuesto) : '')
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const c = compra ?? (await asegurarCompra(tiendasHoy))
        await guardar('Compras', { ...c, estado: 'en_curso', presupuesto: leerNumero(presupuesto), tiendas_hoy: tiendasHoy.join(','), fecha_inicio: ahoraIso() })
      }}
    >
      <Titulo>Empezar a comprar</Titulo>
      <Campo etiqueta="Presupuesto de hoy" inputMode="numeric" placeholder="300.000" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value)} ayuda="Opcional. Sin presupuesto solo verás el total." />
      <div>
        <p className="mb-1 text-sm text-stone-600">Tiendas que visitas hoy</p>
        <div className="flex flex-wrap gap-2">{TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tiendasHoy.includes(t)} onClick={() => alternar(t)} />)}</div>
      </div>
      <Boton type="submit" className="w-full">Empezar compra</Boton>
      {!compra && <p className="text-center text-sm text-stone-500">Se arma la lista con tus productos recurrentes.</p>}
    </form>
  )
}

function Agregar({ cat, tiendasHoy, onListo }: { cat: Catalogo; tiendasHoy: Tienda[]; onListo: () => void }) {
  const [q, setQ] = useState('')
  const nq = normalizar(q)
  const xs = cat.productos.filter((p) => p.activo && (!nq || normalizar(p.nombre).includes(nq))).slice(0, 30)
  return (
    <div className="space-y-2">
      <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tu catálogo…" aria-label="Buscar en tu catálogo" className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5" />
      <ul className="max-h-[50vh] divide-y divide-stone-100 overflow-y-auto">
        {xs.map((p) => (
          <li key={p.producto_id}>
            <button type="button" className="w-full py-2 text-left" onClick={async () => { await agregarALaCompra(p, tiendasHoy); onListo() }}>{p.nombre}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Dialogo = null | { detalle: Detalle } | 'libre' | 'agregar' | 'cerrar'

export function Compra() {
  const cat = useCatalogo()
  const [tiendasGuardadas, alternar] = useTiendasHoy()
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [cerrando, setCerrando] = useState(false)
  const datos = useLiveQuery(async () => {
    const compra = await compraAbierta()
    const detalles = compra ? (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado) : []
    return { compra, detalles: detalles.sort((a, b) => a.orden - b.orden) }
  }, [])
  if (!cat || !datos) return null
  const { compra, detalles } = datos
  if (!compra || compra.estado === 'borrador') return <Empezar compra={compra} tiendasHoy={tiendasGuardadas} alternar={alternar} />

  const tiendasHoy = compra.tiendas_hoy ? compra.tiendas_hoy.split(',').filter(esTienda) : tiendasGuardadas
  const ahora = ahoraIso()
  const plan = planCompra(itemsDelPlan(cat, detalles, ahora, tiendasHoy), tiendasHoy, cat.cfg.ahorroMinimoTienda)
  const sugerencias = new Map<string, Sugerencia>()
  for (const g of plan.grupos) for (const it of g.items) sugerencias.set(it.id, { tienda: g.tienda, presentacion: it.costo.opcion.presentacion, paquetes: it.costo.paquetes })
  const estado = estadoPresupuesto(detalles, compra.presupuesto, cat.cfg.alertaPresupuesto, plan.total)
  const pendientes = detalles.filter((d) => d.estado === 'pendiente')
  const enCarrito = detalles.filter((d) => d.estado === 'en_carrito')
  const noEncontrados = detalles.filter((d) => d.estado === 'no_encontrado')
  const cerrar = () => setDialogo(null)

  const porTienda = new Map<string, Detalle[]>()
  for (const d of pendientes) {
    const t = d.tienda || sugerencias.get(d.detalle_id)?.tienda || ''
    porTienda.set(t, [...(porTienda.get(t) ?? []), d])
  }
  const ordenGrupos = [...TIENDAS.filter((t) => porTienda.has(t)), ...(porTienda.has('') ? [''] : [])]

  const nombre = (d: Detalle) => (d.producto_id ? cat.producto.get(d.producto_id)?.nombre ?? '?' : d.nombre_libre)
  const detalleDialogo = dialogo && typeof dialogo === 'object' ? dialogo.detalle : null
  const productoDialogo = detalleDialogo?.producto_id ? cat.producto.get(detalleDialogo.producto_id) : undefined

  return (
    <section className="space-y-3">
      <div className="sticky top-0 z-20 -mx-4 bg-fondo/95 px-4 pt-1 pb-2 backdrop-blur">
        <BarraPresupuesto estado={estado} />
      </div>

      {detalles.length === 0 && <Vacio>La lista está vacía. Agrega productos abajo o desde la pestaña Lista.</Vacio>}

      {ordenGrupos.map((t) => (
        <Tarjeta key={t || 'sin'}>
          <h2 className="mb-1 text-sm font-semibold">{t ? <NombreTienda tienda={t as Tienda} /> : 'Sin precio conocido'}</h2>
          <ul className="divide-y divide-stone-100">
            {porTienda.get(t)!.map((d) => {
              const s = sugerencias.get(d.detalle_id)
              const p = cat.producto.get(d.producto_id)
              return (
                <li key={d.detalle_id}>
                  <button type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => (d.producto_id ? setDialogo({ detalle: d }) : undefined)}>
                    <span aria-hidden className="size-6 shrink-0 rounded-full border-2 border-stone-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{nombre(d)}</span>
                      {s && p && <span className="block truncate text-xs text-stone-500">{s.paquetes} × {describirPresentacion(s.presentacion, p)}</span>}
                    </span>
                    {s && <span className="text-sm text-stone-500">≈ {pesos(plan.grupos.flatMap((g) => g.items).find((i) => i.id === d.detalle_id)?.costo.costoReal ?? 0)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      ))}

      {enCarrito.length > 0 && (
        <Tarjeta>
          <h2 className="mb-1 text-sm font-semibold text-ok">En el carrito ({enCarrito.length})</h2>
          <ul className="divide-y divide-stone-100">
            {enCarrito.map((d) => (
              <li key={d.detalle_id}>
                <button type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => (d.producto_id ? setDialogo({ detalle: d }) : void guardar('Compras_detalle', { ...d, borrado: true }))}>
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-ok text-sm text-white">✓</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-stone-500 line-through">{nombre(d)}</span>
                    <span className="block text-xs text-stone-500">{String(d.cantidad).replace('.', ',')} × {pesos(d.precio_unitario)}{d.tienda && ` · ${INFO_TIENDAS[d.tienda].nombre}`}{!d.producto_id && ' · toca para quitar'}</span>
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
          <h2 className="mb-1 text-sm font-semibold text-stone-500">No los encontré</h2>
          <ul className="text-sm text-stone-500">
            {noEncontrados.map((d) => (
              <li key={d.detalle_id}>
                <button type="button" className="py-1 underline" onClick={() => void guardar('Compras_detalle', { ...d, estado: 'pendiente' })}>{nombre(d)}</button>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={() => setDialogo('agregar')}>+ Producto</Boton>
        <Boton variante="secundario" onClick={() => setDialogo('libre')}>+ Ítem libre</Boton>
      </div>
      <Boton className="w-full" onClick={() => setDialogo('cerrar')} disabled={enCarrito.length === 0}>Cerrar compra</Boton>

      <Hoja abierta={!!detalleDialogo && !!productoDialogo} titulo={productoDialogo?.nombre ?? ''} onCerrar={cerrar}>
        {detalleDialogo && productoDialogo && (
          <AlCarrito d={detalleDialogo} producto={productoDialogo} cat={cat} sugerencia={sugerencias.get(detalleDialogo.detalle_id)} tiendasHoy={tiendasHoy} onListo={cerrar} />
        )}
      </Hoja>
      <Hoja abierta={dialogo === 'libre'} titulo="Ítem libre" onCerrar={cerrar}>
        <ItemLibre compraId={compra.compra_id} crear={nuevoDetalle} onListo={cerrar} />
      </Hoja>
      <Hoja abierta={dialogo === 'agregar'} titulo="Agregar a la compra" onCerrar={cerrar}>
        <Agregar cat={cat} tiendasHoy={tiendasHoy} onListo={cerrar} />
      </Hoja>
      <Hoja abierta={dialogo === 'cerrar'} titulo="¿Cerrar la compra?" onCerrar={cerrar}>
        <div className="space-y-3">
          <p>Total: <strong>{pesos(estado.gastado)}</strong> en {enCarrito.length} ítems.{pendientes.length > 0 && ` Quedan ${pendientes.length} sin comprar; no se cuentan.`}</p>
          <p className="text-sm text-stone-500">Los precios que pagaste quedan como precios de tienda y mandan en las próximas comparaciones.</p>
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
            Sí, cerrar
          </Boton>
          <Boton variante="peligro" className="w-full" onClick={async () => { await guardar('Compras', { ...compra, estado: 'cancelada' }); cerrar() }}>
            Descartar esta compra
          </Boton>
        </div>
      </Hoja>
    </section>
  )
}
