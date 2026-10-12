import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Producto } from '@shared/esquema.ts'
import { INFO_TIENDAS } from '@shared/tiendas.ts'
import { etiquetaVisible } from '@shared/unidades.ts'
import { ir } from '../app/ruta.ts'
import { EliminarProductos } from '../componentes/EliminarProductos.tsx'
import { EmpezarDeCero } from '../componentes/EmpezarDeCero.tsx'
import { FormProducto } from '../componentes/FormProducto.tsx'
import { BotonPegarLista } from '../componentes/PegarLista.tsx'
import { Novedades } from '../componentes/Novedades.tsx'
import { BotonModoTienda } from '../escaner/ModoTienda.tsx'
import { AvisoSinVincular } from '../componentes/VincularTodos.tsx'
import { avisar, Boton, Cargando, Distintivo, Hoja, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { opcionesDe, useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, archivarProductos, compraAbierta, crearListaTipica, deshacerReemplazo, guardar, quitarDeLaCompra, restaurarDetalle } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'

function FilaProducto({ p, cat, ahora, enLista, onAlternar, marcado }: {
  p: Producto; cat: Catalogo; ahora: string; enLista: boolean; onAlternar: () => void
  /** undefined = fuera del modo selección; true/false = casilla marcada o no. */
  marcado?: boolean
}) {
  const { mejor } = opcionesDe(cat, p, ahora)
  const u = etiquetaVisible(p.unidad_base)
  if (marcado !== undefined) {
    // Modo selección: toda la fila es una casilla (ni estrella, ni "+ Agregar", ni enlace al detalle).
    return (
      <li>
        <button
          type="button"
          role="checkbox"
          aria-checked={marcado}
          onClick={onAlternar}
          className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left active:bg-stone-100 ${marcado ? 'bg-marca-suave/60' : ''}`}
        >
          <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-md border-2 text-lg font-bold ${marcado ? 'border-marca bg-marca text-white' : 'border-stone-400 bg-white text-transparent'}`}>✓</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{p.nombre}</span>
            <span className="block text-sm text-stone-600">
              {mejor ? (mejor.precioUnidad != null ? `${pesos(mejor.precioUnidad)}/${u} · ${INFO_TIENDAS[mejor.tienda].nombre}` : `${pesos(mejor.efectivo.precio)} · ${INFO_TIENDAS[mejor.tienda].nombre}`) : 'Sin precios'}
            </span>
          </span>
        </button>
      </li>
    )
  }
  return (
    <li className="flex flex-wrap items-center gap-x-1 py-1">
      <button
        type="button"
        aria-label={p.recurrente ? `${p.nombre}: quitar de recurrentes` : `${p.nombre}: marcar como recurrente`}
        aria-pressed={p.recurrente}
        className={`grid size-11 shrink-0 place-items-center rounded-full text-2xl active:bg-stone-100 ${p.recurrente ? 'text-amber-700' : 'text-stone-500'}`}
        onClick={() => {
          void guardar('Productos', { ...p, recurrente: !p.recurrente })
          avisar(p.recurrente ? `${p.nombre} ya no entra solo en cada compra` : `${p.nombre} entra solo en cada compra`, () => guardar('Productos', p).then(() => undefined))
        }}
      >
        {p.recurrente ? '★' : '☆'}
      </button>
      <a href={`#/producto/${encodeURIComponent(p.producto_id)}`} className="min-w-[8.5rem] flex-1 rounded-xl px-1 py-1.5 active:bg-stone-100">
        <div className="truncate font-medium">{p.nombre}</div>
        {mejor ? (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
            <span className="font-semibold text-tinta">
              {mejor.precioUnidad != null ? `${pesos(mejor.precioUnidad)}/${u}` : pesos(mejor.efectivo.precio)}
            </span>
            <NombreTienda tienda={mejor.tienda} tam={16} className="text-stone-700" />
            <Distintivo tipo={mejor.efectivo.distintivo} amarillo={mejor.efectivo.estado === 'amarillo'} dias={mejor.efectivo.edadDias} />
          </div>
        ) : (
          <div className="text-sm text-stone-600">Sin precios · toca para anotar</div>
        )}
      </a>
      <button
        type="button"
        aria-pressed={enLista}
        aria-label={enLista ? `${p.nombre} está en la compra: quitar` : `Agregar ${p.nombre} a la compra`}
        onClick={onAlternar}
        className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold ${enLista ? 'text-ok active:bg-green-50' : 'bg-marca text-white active:bg-teal-800'}`}
      >
        {enLista ? '✓ En la compra' : '+ Agregar'}
      </button>
    </li>
  )
}

function PrimerUso({ onCrear }: { onCrear: () => void }) {
  const [creando, setCreando] = useState(false)
  return (
    <Tarjeta className="space-y-3">
      <h2 className="text-lg font-semibold">Empieza aquí</h2>
      <p className="text-stone-700">
        Compara cuánto cuesta tu mercado en <strong>Éxito, Olímpica, D1 y Ara</strong> y te dice dónde comprar cada cosa más barato.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-stone-700">
        <li><strong>Pasa tu lista</strong> (cópiala de WhatsApp o Notas y pégala) o crea tus productos. Los marcados con ★ entran solos en cada compra.</li>
        <li><strong>Anota precios</strong> cuando estés en la tienda: toca el producto y escribe lo que ves en la góndola.</li>
        <li><strong>Antes de salir, mira el Plan</strong>: te dice dónde comprar cada cosa.</li>
      </ol>
      <BotonPegarLista variante="primario" className="w-full" texto="Pegar mi lista (WhatsApp, Notas…)" />
      <Boton
        variante="secundario"
        className="w-full"
        disabled={creando}
        onClick={async () => {
          setCreando(true)
          const n = await crearListaTipica()
          avisar(`Listo: ${n} productos típicos. Quita o cambia los que no uses.`)
          setCreando(false)
        }}
      >
        Empezar con una lista típica
      </Boton>
      <button type="button" className="min-h-11 w-full text-center text-marca underline" onClick={onCrear}>o crea tu primer producto a mano</button>
    </Tarjeta>
  )
}

export function Lista() {
  const cat = useCatalogo()
  const [tiendasHoy] = useTiendasHoy()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'compra'>('todos')
  const [creando, setCreando] = useState(false)
  // null = lista normal; un conjunto = modo "Seleccionar" con los productos marcados.
  const [seleccion, setSeleccion] = useState<Set<string> | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)
  const seleccionando = seleccion !== null
  // Al salir de «Seleccionar» tras archivar o eliminar, el botón que se tocó desaparece y el foco caería en el <body>
  // (quien usa teclado o lector de pantalla volvería al inicio): se lleva al botón «Seleccionar», que sigue ahí.
  const botonSeleccionar = useRef<HTMLButtonElement>(null)
  const estabaSeleccionando = useRef(false)
  useEffect(() => {
    if (estabaSeleccionando.current && !seleccionando) {
      const activo = document.activeElement
      if (!activo || activo === document.body) botonSeleccionar.current?.focus({ preventScroll: true })
    }
    estabaSeleccionando.current = seleccionando
  }, [seleccionando])
  // La barra de acciones fija tapa el borde de abajo: los avisos y la pastilla de señal suben por encima.
  useEffect(() => {
    if (!seleccionando) return
    document.documentElement.style.setProperty('--barra-acciones', '4.25rem')
    return () => { document.documentElement.style.removeProperty('--barra-acciones') }
  }, [seleccionando])
  const enLista = useLiveQuery(async () => {
    const c = await compraAbierta()
    if (!c) return new Set<string>()
    const ds = await db.detalle.where('compra_id').equals(c.compra_id).toArray()
    return new Set(ds.filter((d) => !d.borrado).map((d) => d.producto_id))
  }, []) ?? new Set<string>()
  const ahora = ahoraIso()

  const grupos = useMemo(() => {
    if (!cat) return []
    const nq = normalizar(q)
    const visibles = cat.productos.filter((p) => p.activo && (!nq || normalizar(p.nombre).includes(nq)) && (filtro === 'todos' || enLista.has(p.producto_id)))
    const orden = [...cat.categorias.map((c) => ({ id: c.categoria_id, nombre: c.nombre })), { id: '', nombre: 'Sin pasillo' }]
    return orden
      .map((g) => ({ ...g, productos: visibles.filter((p) => (cat.categorias.some((c) => c.categoria_id === p.categoria_id) ? p.categoria_id : '') === g.id) }))
      .filter((g) => g.productos.length)
  }, [cat, q, filtro, enLista])

  if (!cat) return <Cargando />
  const hayProductos = cat.productos.some((p) => p.activo)
  const hayPrecios = [...cat.actualesDe.values()].some((xs) => xs.some((a) => a.precio != null && a.precio > 0))

  const idsVisibles = grupos.flatMap((g) => g.productos.map((p) => p.producto_id))
  // Solo cuentan los marcados que siguen existiendo (si otro celular los cambia, no se arrastran ids viejos).
  const marcados = seleccion ? cat.productos.filter((p) => p.activo && seleccion.has(p.producto_id)) : []
  const todosMarcados = idsVisibles.length > 0 && idsVisibles.every((id) => seleccion?.has(id))
  const marcar = (ids: readonly string[], valor: boolean) => setSeleccion((s) => {
    const n = new Set(s ?? [])
    for (const id of ids) valor ? n.add(id) : n.delete(id)
    return n
  })
  const salirSeleccion = () => { setSeleccion(null); setEliminando(false) }

  async function archivarMarcados() {
    const ids = marcados.map((p) => p.producto_id)
    const { archivados, quitados } = await archivarProductos(ids)
    salirSeleccion()
    if (archivados.length) {
      avisar(archivados.length === 1 ? `${archivados[0].nombre} archivado` : `${archivados.length} productos archivados`, () => deshacerReemplazo(archivados, quitados))
    }
  }

  async function alternar(p: Producto) {
    if (enLista.has(p.producto_id)) {
      const quitado = await quitarDeLaCompra(p.producto_id)
      if (quitado) avisar(`${p.nombre} quitado de la compra`, () => restaurarDetalle(quitado))
    } else {
      await agregarALaCompra(p, tiendasHoy)
      avisar(`${p.nombre} agregado a la compra`)
    }
  }

  return (
    <section>
      <Titulo
        sub={hayProductos ? (seleccionando ? 'Marca los productos que quieres archivar o eliminar' : '★ = entra solo en cada compra') : undefined}
        accion={hayProductos ? (
          <div className="flex shrink-0 items-center">
            <Boton ref={botonSeleccionar} variante="fantasma" className="text-sm" onClick={() => (seleccionando ? salirSeleccion() : setSeleccion(new Set()))}>{seleccionando ? 'Cancelar' : 'Seleccionar'}</Boton>
            {!seleccionando && <BotonPegarLista variante="fantasma" className="shrink-0 text-sm" texto="Pegar lista" />}
          </div>
        ) : undefined}
      >
        Mis productos
      </Titulo>
      {!hayProductos ? (
        <PrimerUso onCrear={() => setCreando(true)} />
      ) : (
        <>
          {!hayPrecios && (
            <Tarjeta className="mb-3 space-y-2">
              <h2 className="font-semibold">Siguiente paso: los precios</h2>
              <p className="text-sm text-stone-700">Ya tienes tu lista. Cuando estés en la tienda, anota lo que cuesta cada cosa: así la app te dice dónde comprar más barato.</p>
              <BotonModoTienda className="w-full" variante="primario" />
            </Tarjeta>
          )}
          <Novedades className="mb-3" />
          <AvisoSinVincular className="mb-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            className="mb-2 min-h-11 w-full rounded-xl border border-stone-400 bg-white px-3 py-2.5 outline-none focus:border-marca focus:ring-2 focus:ring-marca/30"
          />
          <div className="mb-3 flex gap-2" role="group" aria-label="Filtrar">
            {(['todos', 'compra'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filtro === f}
                onClick={() => setFiltro(f)}
                className={`min-h-11 rounded-full border px-4 text-sm ${filtro === f ? 'border-marca bg-marca-suave font-semibold text-teal-900' : 'border-stone-300 bg-white text-stone-700'}`}
              >
                {f === 'todos' ? 'Todos' : `En esta compra (${enLista.size})`}
              </button>
            ))}
          </div>
          {q && grupos.length === 0 && <Boton variante="secundario" className="w-full" onClick={() => setCreando(true)}>Crear “{q}”</Boton>}
          {!q && filtro === 'compra' && grupos.length === 0 && <Vacio>No hay nada en la compra. Toca “+ Agregar” en los productos.</Vacio>}
          {seleccionando && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium" aria-live="polite">{marcados.length === 0 ? 'Nada marcado' : marcados.length === 1 ? '1 marcado' : `${marcados.length} marcados`}</span>
              <Boton variante="fantasma" className="text-sm" onClick={() => marcar(idsVisibles, !todosMarcados)}>{todosMarcados ? 'Quitar marcas' : 'Marcar todos'}</Boton>
            </div>
          )}
          <div className="space-y-3">
            {grupos.map((g) => {
              const enGrupo = g.productos.map((p) => p.producto_id)
              const grupoMarcado = seleccionando && enGrupo.every((id) => seleccion?.has(id))
              return (
                <Tarjeta key={g.id || 'sin'} className="px-2">
                  {(g.id || grupos.length > 1 || seleccionando) && (
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="px-1 text-sm font-semibold tracking-wide text-stone-600 uppercase">{g.nombre}</h2>
                      {seleccionando && (
                        <button
                          type="button"
                          className="min-h-11 px-2 text-sm font-medium text-marca"
                          aria-label={`${grupoMarcado ? 'Quitar las marcas de' : 'Marcar todos los de'} ${g.nombre}`}
                          onClick={() => marcar(enGrupo, !grupoMarcado)}
                        >
                          {grupoMarcado ? 'Quitar marcas' : 'Marcar todos'}
                        </button>
                      )}
                    </div>
                  )}
                  <ul className="divide-y divide-stone-100">
                    {g.productos.map((p) => (
                      <FilaProducto
                        key={p.producto_id}
                        p={p}
                        cat={cat}
                        ahora={ahora}
                        enLista={enLista.has(p.producto_id)}
                        onAlternar={() => (seleccionando ? marcar([p.producto_id], !seleccion?.has(p.producto_id)) : void alternar(p))}
                        marcado={seleccionando ? seleccion?.has(p.producto_id) === true : undefined}
                      />
                    ))}
                  </ul>
                </Tarjeta>
              )
            })}
          </div>
          {!seleccionando && (
            <div className="pt-4 text-center">
              <Boton variante="fantasma" className="text-sm text-stone-600" onClick={() => setReiniciando(true)}>¿Quieres armar tu lista desde cero? Empezar de cero…</Boton>
            </div>
          )}
          {seleccionando && <div className="h-16" aria-hidden />}
        </>
      )}
      {/* Con la lista vacía ya hay un botón para crear el primero: este taparía el de pegar la lista. */}
      {hayProductos && !seleccionando && (
        <button
          type="button"
          onClick={() => setCreando(true)}
          aria-label="Nuevo producto"
          className="fixed right-4 z-20 grid size-14 place-items-center rounded-full bg-marca text-3xl text-white shadow-lg active:bg-teal-800"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
        >
          +
        </button>
      )}
      {seleccionando && (
        <div
          role="region"
          aria-label="Acciones sobre los productos marcados"
          className="fixed inset-x-0 z-30 border-t border-stone-200 bg-white/95 px-3 py-2 backdrop-blur"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 3.5rem)' }}
        >
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
            <Boton variante="secundario" disabled={marcados.length === 0} onClick={() => void archivarMarcados()}>Archivar{marcados.length > 0 ? ` (${marcados.length})` : ''}</Boton>
            <Boton variante="peligro" disabled={marcados.length === 0} onClick={() => setEliminando(true)}>Eliminar{marcados.length > 0 ? ` (${marcados.length})` : ''}…</Boton>
          </div>
        </div>
      )}
      <EliminarProductos productos={marcados} abierta={eliminando} onCerrar={() => setEliminando(false)} onHecho={salirSeleccion} />
      <EmpezarDeCero abierta={reiniciando} onCerrar={() => setReiniciando(false)} onHecho={() => { setReiniciando(false); salirSeleccion() }} />
      <Hoja abierta={creando} titulo="Nuevo producto" onCerrar={() => setCreando(false)} protegida>
        <FormProducto
          nombreInicial={q}
          categorias={cat.categorias}
          onListo={(p) => { setCreando(false); setQ(''); ir(`producto/${encodeURIComponent(p.producto_id)}`) }}
        />
      </Hoja>
    </section>
  )
}
