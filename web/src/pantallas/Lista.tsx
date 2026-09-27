import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Producto } from '@shared/esquema.ts'
import { etiquetaVisible } from '@shared/unidades.ts'
import { ir } from '../app/ruta.ts'
import { FormProducto } from '../componentes/FormProducto.tsx'
import { BotonPegarLista } from '../componentes/PegarLista.tsx'
import { avisar, Boton, Cargando, Distintivo, Hoja, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { opcionesDe, useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, compraAbierta, crearListaTipica, guardar, quitarDeLaCompra, restaurarDetalle } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'

function FilaProducto({ p, cat, ahora, enLista, onAlternar }: { p: Producto; cat: Catalogo; ahora: string; enLista: boolean; onAlternar: () => void }) {
  const { mejor } = opcionesDe(cat, p, ahora)
  const u = etiquetaVisible(p.unidad_base)
  return (
    <li className="flex items-center gap-1 py-1">
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
      <a href={`#/producto/${encodeURIComponent(p.producto_id)}`} className="min-w-0 flex-1 rounded-xl px-1 py-1.5 active:bg-stone-100">
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
      <h2 className="text-lg font-semibold">Empieza en 3 pasos</h2>
      <ol className="list-decimal space-y-2 pl-5 text-stone-700">
        <li><strong>Pasa tu lista</strong> (cópiala de WhatsApp o Notas y pégala) o crea tus productos. Los marcados con ★ entran solos en cada compra.</li>
        <li><strong>Anota precios</strong> cuando vayas a D1 o Ara (Olímpica y Éxito se pueden traer de internet).</li>
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
      <Boton variante="secundario" className="w-full" onClick={onCrear}>Crear mi primer producto</Boton>
    </Tarjeta>
  )
}

export function Lista() {
  const cat = useCatalogo()
  const [tiendasHoy] = useTiendasHoy()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'compra'>('todos')
  const [creando, setCreando] = useState(false)
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
        sub={hayProductos ? '★ = entra solo en cada compra' : undefined}
        accion={hayProductos ? <BotonPegarLista variante="fantasma" className="shrink-0 text-sm" texto="Pegar lista" /> : undefined}
      >
        Mis productos
      </Titulo>
      {!hayProductos ? (
        <PrimerUso onCrear={() => setCreando(true)} />
      ) : (
        <>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            className="mb-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-marca focus:ring-2 focus:ring-marca/30"
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
          <div className="space-y-3">
            {grupos.map((g) => (
              <Tarjeta key={g.id || 'sin'} className="px-2">
                <h2 className="px-1 text-sm font-semibold tracking-wide text-stone-600 uppercase">{g.nombre}</h2>
                <ul className="divide-y divide-stone-100">
                  {g.productos.map((p) => (
                    <FilaProducto key={p.producto_id} p={p} cat={cat} ahora={ahora} enLista={enLista.has(p.producto_id)} onAlternar={() => void alternar(p)} />
                  ))}
                </ul>
              </Tarjeta>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setCreando(true)}
        aria-label="Nuevo producto"
        className="fixed right-4 z-20 grid size-14 place-items-center rounded-full bg-marca text-3xl text-white shadow-lg active:bg-teal-800"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
      >
        +
      </button>
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
