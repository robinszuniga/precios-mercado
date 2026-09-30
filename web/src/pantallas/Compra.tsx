import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
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
import { avisar, Boton, Campo, Cargando, ChipTienda, hace, Hoja, leerNumero, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { cerrarCompra } from '../datos/cierre.ts'
import { comparadorPasillo, itemsDelPlan, useCatalogo, useMeta, type Catalogo } from '../datos/consultas.ts'
import { db, guardarMeta } from '../datos/db.ts'
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

function Agregar({ cat, tiendasHoy, onElegido, onAlgoMas }: { cat: Catalogo; tiendasHoy: Tienda[]; onElegido: (d: Detalle) => void; onAlgoMas: () => void }) {
  const [q, setQ] = useState('')
  const nq = normalizar(q)
  const xs = cat.productos.filter((p) => p.activo && (!nq || normalizar(p.nombre).includes(nq))).slice(0, 30)
  return (
    <div className="space-y-2">
      <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tus productos…" aria-label="Buscar en tus productos" className="min-h-11 w-full rounded-xl border border-stone-400 bg-white px-3 py-2.5" />
      {/* Con el teclado abierto caben pocas filas: mejor pocas y buscar que una lista larga tapada. */}
      <ul className="max-h-[35dvh] divide-y divide-stone-100 overflow-y-auto">
        {xs.map((p) => (
          <li key={p.producto_id}>
            <button type="button" className="min-h-11 w-full py-2 text-left active:bg-stone-100" onClick={async () => onElegido(await agregarALaCompra(p, tiendasHoy))}>{p.nombre}</button>
          </li>
        ))}
      </ul>
      <Boton variante="secundario" className="w-full" onClick={onAlgoMas}>+ Algo que no está en mis productos{q.trim() ? `: “${q.trim()}”` : ''}</Boton>
    </div>
  )
}

type Dialogo = null | { detalle: Detalle } | { libre: Detalle | null } | 'agregar' | 'cerrar' | 'descartar' | 'presupuesto'

export function Compra() {
  const cat = useCatalogo()
  const [tiendasHoy, alternar] = useTiendasHoy()
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [cerrando, setCerrando] = useState(false)
  /** En qué tienda estoy ahora: esa va arriba y abierta; las otras, plegadas. Vacío = todas. */
  const aqui = useMeta<Tienda | ''>('estoyEn', '')
  const ultimaMarca = useRef(0)
  /** Los que se marcaron hace un instante: se quedan tachados en su lugar un segundo antes de bajar al carrito. */
  const [recien, setRecien] = useState<ReadonlySet<string>>(new Set())
  /** Producto recién agregado: su hoja se abre cuando ya aparece en la compra (y cuando cerró la de agregar). */
  const [porAbrir, setPorAbrir] = useState<string | 'libre' | null>(null)
  const barraRef = useRef<HTMLDivElement>(null)
  const [mini, setMini] = useState(false)
  const datos = useLiveQuery(async () => {
    const compra = await compraAbierta()
    const detalles = compra ? (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado) : []
    return { compra, detalles }
  }, [])
  // La barra de presupuesto grande se sale al bajar: entonces aparece una de una línea, fija arriba (sin mover la lista).
  useEffect(() => {
    const ver = () => { const r = barraRef.current?.getBoundingClientRect(); setMini(!!r && r.height > 0 && r.bottom < 8) }
    ver()
    window.addEventListener('scroll', ver, { passive: true })
    return () => window.removeEventListener('scroll', ver)
  }, [])
  // La barra de acciones fija tapa el borde de abajo: los avisos y la pastilla de señal suben por encima.
  useEffect(() => {
    document.documentElement.style.setProperty('--barra-acciones', '4.25rem')
    return () => { document.documentElement.style.removeProperty('--barra-acciones') }
  }, [])
  useEffect(() => {
    if (!porAbrir) return
    const listo = porAbrir === 'libre' || datos?.detalles.some((x) => x.detalle_id === porAbrir)
    if (!listo) return
    // Un momento después: primero se cierra la hoja de agregar (y su entrada del historial), luego se abre la siguiente.
    const t = setTimeout(() => {
      setPorAbrir(null)
      if (porAbrir === 'libre') setDialogo({ libre: null })
      else {
        const d = datos?.detalles.find((x) => x.detalle_id === porAbrir)
        if (d) setDialogo({ detalle: d })
      }
    }, 300)
    return () => clearTimeout(t)
  }, [porAbrir, datos])
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
  // En la lista siguen, tachados, los que se acaban de marcar; en la tarjeta del carrito todavía no.
  const enLista = detalles.filter((d) => d.estado === 'pendiente' || (d.estado === 'en_carrito' && recien.has(d.detalle_id))).sort((a, b) => orden(a.producto_id, b.producto_id))
  const enCarritoVisible = enCarrito.filter((d) => !recien.has(d.detalle_id))
  const noEncontrados = detalles.filter((d) => d.estado === 'no_encontrado')
  const cerrar = () => setDialogo(null)
  const total = pendientes.length + enCarrito.length + noEncontrados.length
  const pasilloDe = (d: Detalle) => cat.categorias.find((c) => c.categoria_id === cat.producto.get(d.producto_id)?.categoria_id)?.nombre ?? ''

  const porTienda = new Map<string, Detalle[]>()
  for (const d of enLista) {
    const t = d.tienda || sugerencias.get(d.detalle_id)?.tienda || ''
    porTienda.set(t, [...(porTienda.get(t) ?? []), d])
  }
  const ordenGrupos = [...tiendasHoy.filter((t) => porTienda.has(t)), ...TIENDAS.filter((t) => !tiendasHoy.includes(t) && porTienda.has(t)), ...(porTienda.has('') ? [''] : [])]
  const nombre = (d: Detalle) => (d.producto_id ? cat.producto.get(d.producto_id)?.nombre ?? '?' : d.nombre_libre)
  const estoyEn = ordenGrupos.filter((t): t is Tienda => t !== '')
  const estaAqui = aqui && estoyEn.includes(aqui) ? aqui : ''
  const vista = estaAqui ? [estaAqui, ...ordenGrupos.filter((t) => t !== estaAqui)] : ordenGrupos
  /** Hace cuánto se vio el precio sugerido, si ya es viejo: un toque lo daría por bueno sin mirar la góndola. */
  const edadViejaDe = (d: Detalle): number | null => {
    const s = sugerencias.get(d.detalle_id)
    const e = s ? precioEfectivo(cat.actualesDe.get(s.presentacion.presentacion_id) ?? [], cat.cfg.vigencias, ahora).efectivo : null
    return e && e.edadDias >= 7 ? e.edadDias : null
  }

  /** Si el precio sugerido ya es de tienda y reciente, un toque en el círculo basta. */
  async function marcarRapido(d: Detalle) {
    // Al marcar, el siguiente producto sube a ese mismo lugar: un segundo toque enseguida marcaría el que no era.
    if (Date.now() - ultimaMarca.current < 400) return
    const s = sugerencias.get(d.detalle_id)
    const e = s ? precioEfectivo(cat!.actualesDe.get(s.presentacion.presentacion_id) ?? [], cat!.cfg.vigencias, ahora).efectivo : null
    // Un precio de más de una semana no se da por bueno con un toque: se abre la hoja para verlo y confirmarlo.
    if (!s || !e || !sugeridoConfiable(e) || e.edadDias >= 7) { setDialogo({ detalle: d }); return }
    const antes = { ...d }
    ultimaMarca.current = Date.now()
    navigator.vibrate?.(15)
    setRecien((r) => new Set(r).add(d.detalle_id))
    setTimeout(() => setRecien((r) => { const n = new Set(r); n.delete(d.detalle_id); return n }), 1100)
    await guardar('Compras_detalle', {
      ...d, tienda: s.tienda, presentacion_id: s.presentacion.presentacion_id, cantidad: s.paquetes, precio_unitario: e.precio,
      subtotal: subtotal(s.paquetes, e.precio), estado: 'en_carrito', precio_confirmado: true,
    })
    avisar(`${nombre(d)} al carrito · ${pesos(subtotal(s.paquetes, e.precio))}`, () => guardar('Compras_detalle', antes).then(() => undefined))
  }

  /** Tocar de nuevo el círculo de uno recién marcado lo desmarca (sin esperar el aviso de Deshacer). */
  async function desmarcar(d: Detalle) {
    if (Date.now() - ultimaMarca.current < 400) return
    setRecien((r) => { const n = new Set(r); n.delete(d.detalle_id); return n })
    await guardar('Compras_detalle', { ...d, estado: 'pendiente', subtotal: null })
  }

  const detalleDialogo = dialogo && typeof dialogo === 'object' && 'detalle' in dialogo ? dialogo.detalle : null
  const productoDialogo = detalleDialogo?.producto_id ? cat.producto.get(detalleDialogo.producto_id) : undefined
  const libreDialogo = dialogo && typeof dialogo === 'object' && 'libre' in dialogo ? dialogo : null

  return (
    <section className="space-y-3 pb-20">
      <Titulo sub={`${enCarrito.length} de ${total} en el carrito`}>Tu compra de hoy</Titulo>
      <div ref={barraRef}>
        <BarraPresupuesto estado={estado} onEditar={() => setDialogo('presupuesto')} compacta />
      </div>
      {/* Al bajar por la lista, el saldo sigue a la vista en una sola línea (fija: no empuja nada). */}
      {mini && (
        <div className="fixed inset-x-0 top-0 z-20 mx-auto max-w-lg px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)' }}>
          <BarraPresupuesto estado={estado} mini />
        </div>
      )}
      {estoyEn.length > 1 && (
        <div>
          <p className="mb-1 text-sm text-stone-700">¿En qué tienda estás?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!estaAqui} onClick={() => void guardarMeta('estoyEn', '')} className={`min-h-11 rounded-full border px-3 py-2 text-sm ${!estaAqui ? 'border-marca bg-marca-suave font-medium text-teal-900' : 'border-stone-300 bg-white text-stone-600'}`}>Todas</button>
            {estoyEn.map((t) => <ChipTienda key={t} tienda={t} activo={estaAqui === t} onClick={() => void guardarMeta('estoyEn', estaAqui === t ? '' : t)} />)}
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-marca">Cambiar tiendas de hoy</summary>
        <div className="flex flex-wrap gap-2 pb-2">{TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tiendasHoy.includes(t)} onClick={() => alternar(t)} />)}</div>
      </details>

      {detalles.length === 0 && <Vacio>La compra está vacía. Agrega productos abajo o desde la pestaña Productos.</Vacio>}

      {vista.map((t) => {
        let pasilloPrevio = ''
        const plegado = !!estaAqui && t !== estaAqui
        const titulo = t ? <NombreTienda tienda={t as Tienda} tam={22} /> : 'Sin precio conocido'
        const lista = (
          <ul>
              {porTienda.get(t)!.map((d) => {
                const s = sugerencias.get(d.detalle_id)
                const p = cat.producto.get(d.producto_id)
                const pasillo = pasilloDe(d)
                const mostrarPasillo = pasillo !== pasilloPrevio
                pasilloPrevio = pasillo
                const marcado = d.estado === 'en_carrito'
                return (
                  <li key={d.detalle_id}>
                    {mostrarPasillo && pasillo && <p className="px-1 pt-2 text-xs font-semibold tracking-wide text-stone-600 uppercase">{pasillo}</p>}
                    <div className={`flex items-center gap-1 border-b border-stone-100 ${marcado ? 'bg-green-50' : ''}`}>
                      <button
                        type="button"
                        aria-label={marcado ? `Desmarcar ${nombre(d)}` : `Marcar ${nombre(d)} como comprado`}
                        aria-pressed={marcado}
                        className="grid size-11 shrink-0 place-items-center rounded-full active:bg-stone-100"
                        onClick={() => void (marcado ? desmarcar(d) : marcarRapido(d))}
                      >
                        {marcado
                          ? <span aria-hidden className="grid size-7 place-items-center rounded-full bg-ok text-sm text-white">✓</span>
                          : <span aria-hidden className="size-7 rounded-full border-2 border-stone-500" />}
                      </button>
                      <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center gap-2 py-2 text-left active:bg-stone-100" onClick={() => setDialogo({ detalle: d })}>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-medium ${marcado ? 'text-stone-500 line-through' : ''}`}>{nombre(d)}</span>
                          {marcado
                            ? <span className="block text-sm text-stone-600">{formatoNumero(d.cantidad ?? 0)} × {pesos(d.precio_unitario)}</span>
                            : s && p && <span className="block truncate text-sm text-stone-700">{s.presentacion.granel ? formatoCantidadVisible(s.paquetes, p.unidad_base) : `${s.paquetes} ×`} {describirPresentacion(s.presentacion, p)}</span>}
                          {!marcado && edadViejaDe(d) != null && <span className="block text-xs font-medium text-alerta">Precio visto {hace(edadViejaDe(d)!)}: confírmalo</span>}
                        </span>
                        {marcado
                          ? <span className="shrink-0 text-base font-semibold text-ok">{pesos(d.subtotal)}</span>
                          : s && <span className="shrink-0 text-base font-semibold text-stone-800"><abbr title="aproximadamente" className="no-underline">≈</abbr> {pesos(s.costo)}</span>}
                      </button>
                    </div>
                  </li>
                )
              })}
          </ul>
        )
        // Las tiendas donde no estoy se pliegan en un renglón con su cuenta (el resumen va directo dentro de <details>).
        if (plegado) {
          return (
            <details key={t || 'sin'} className="rounded-2xl bg-white ring-1 ring-stone-200">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-semibold">
                <span>{titulo}</span>
                <span className="font-normal text-stone-600">{porTienda.get(t)!.length} pendientes ▸</span>
              </summary>
              <div className="px-2 pb-2">{lista}</div>
            </details>
          )
        }
        return (
          <Tarjeta key={t || 'sin'} className="px-2">
            <h2 className="mb-1 px-1 text-sm font-semibold">{titulo}</h2>
            {lista}
          </Tarjeta>
        )
      })}

      {enCarrito.length > 0 && (
        <Tarjeta className="px-2">
          <h2 className="mb-1 px-1 text-sm font-semibold text-ok">En el carrito ({enCarrito.length})</h2>
          <ul>
            {enCarritoVisible.map((d) => (
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

      {enCarrito.length === 0 && <p className="text-center text-xs text-stone-600">Marca al menos un producto para poder cerrar la compra.</p>}
      <div className="pt-4 text-center">
        <button type="button" className="min-h-11 px-3 text-sm text-stone-600 underline" onClick={() => setDialogo('descartar')}>Descartar esta compra…</button>
      </div>

      {/* Siempre a la vista, encima de la barra de navegación: agregar, anotar precios o terminar sin recorrer la lista. */}
      <div
        className="fixed inset-x-0 z-30 border-t border-stone-200 bg-white/95 px-3 py-2 backdrop-blur"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 3.5rem)' }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <BotonModoTienda compacto />
          {/* Con letra grande del sistema los textos no se parten ni se salen de la pantalla: se achican un poco. */}
          <Boton variante="secundario" className="min-w-0 flex-1 px-2 text-[0.9375rem] whitespace-nowrap" onClick={() => setDialogo('agregar')}>+ Agregar</Boton>
          <Boton className="min-w-0 flex-[1.4] px-2 text-[0.9375rem] whitespace-nowrap" onClick={() => setDialogo('cerrar')} disabled={enCarrito.length === 0}>
            Terminar{enCarrito.length > 0 ? ` (${enCarrito.length})` : ''}
          </Boton>
        </div>
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
        <Agregar cat={cat} tiendasHoy={tiendasHoy} onElegido={(d) => { cerrar(); setPorAbrir(d.detalle_id) }} onAlgoMas={() => { cerrar(); setPorAbrir('libre') }} />
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
