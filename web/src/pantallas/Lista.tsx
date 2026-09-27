import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Producto } from '@shared/esquema.ts'
import { etiquetaPorUnidad } from '@shared/unidades.ts'
import { ir } from '../app/ruta.ts'
import { FormProducto } from '../componentes/FormProducto.tsx'
import { Boton, Distintivo, Hoja, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { opcionesDe, useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, compraAbierta, guardar } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'

function FilaProducto({ p, cat, ahora, enLista, onAgregar }: { p: Producto; cat: Catalogo; ahora: string; enLista: boolean; onAgregar: () => void }) {
  const { mejor } = opcionesDe(cat, p, ahora)
  return (
    <li className="flex items-center gap-2 py-2">
      <button
        type="button"
        aria-label={p.recurrente ? 'Quitar de recurrentes' : 'Marcar como recurrente'}
        title="Recurrente"
        className={`text-xl ${p.recurrente ? 'text-alerta' : 'text-stone-300'}`}
        onClick={() => void guardar('Productos', { ...p, recurrente: !p.recurrente })}
      >
        ★
      </button>
      <a href={`#/producto/${encodeURIComponent(p.producto_id)}`} className="min-w-0 flex-1">
        <div className="truncate font-medium">{p.nombre}</div>
        <div className="flex items-center gap-1.5 text-xs text-stone-500">
          {mejor ? (
            <>
              <NombreTienda tienda={mejor.tienda} />
              <span>{mejor.precioUnidad != null ? `${pesos(mejor.precioUnidad)} ${etiquetaPorUnidad(p.unidad_base).slice(1)}` : pesos(mejor.efectivo.precio)}</span>
              <Distintivo tipo={mejor.efectivo.distintivo} amarillo={mejor.efectivo.estado === 'amarillo'} />
            </>
          ) : (
            <span>Sin precios vigentes</span>
          )}
        </div>
      </a>
      <button
        type="button"
        aria-label={enLista ? 'Ya está en la lista' : `Agregar ${p.nombre} a la lista`}
        disabled={enLista}
        onClick={onAgregar}
        className={`size-9 rounded-full text-xl ${enLista ? 'bg-marca-suave text-marca' : 'bg-marca text-white'}`}
      >
        {enLista ? '✓' : '+'}
      </button>
    </li>
  )
}

export function Lista() {
  const cat = useCatalogo()
  const [tiendasHoy] = useTiendasHoy()
  const [q, setQ] = useState('')
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
    const visibles = cat.productos.filter((p) => p.activo && (!nq || normalizar(p.nombre).includes(nq)))
    const orden = [...cat.categorias.map((c) => ({ id: c.categoria_id, nombre: c.nombre })), { id: '', nombre: 'Sin categoría' }]
    return orden
      .map((g) => ({ ...g, productos: visibles.filter((p) => (cat.categorias.some((c) => c.categoria_id === p.categoria_id) ? p.categoria_id : '') === g.id) }))
      .filter((g) => g.productos.length)
  }, [cat, q])

  if (!cat) return null
  const hayProductos = cat.productos.some((p) => p.activo)

  return (
    <section>
      <Titulo accion={<Boton onClick={() => setCreando(true)}>+ Producto</Boton>}>Mi lista</Titulo>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar producto…"
        aria-label="Buscar producto"
        className="mb-3 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-marca"
      />
      {!hayProductos && <Vacio>Todavía no hay productos. Crea los de tu mercado habitual y márcalos como recurrentes (★).</Vacio>}
      {q && grupos.length === 0 && hayProductos && (
        <Boton variante="secundario" className="w-full" onClick={() => setCreando(true)}>Crear “{q}”</Boton>
      )}
      <div className="space-y-3">
        {grupos.map((g) => (
          <Tarjeta key={g.id || 'sin'}>
            <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">{g.nombre}</h2>
            <ul className="divide-y divide-stone-100">
              {g.productos.map((p) => (
                <FilaProducto key={p.producto_id} p={p} cat={cat} ahora={ahora} enLista={enLista.has(p.producto_id)} onAgregar={() => void agregarALaCompra(p, tiendasHoy)} />
              ))}
            </ul>
          </Tarjeta>
        ))}
      </div>
      <Hoja abierta={creando} titulo="Nuevo producto" onCerrar={() => setCreando(false)}>
        <FormProducto
          nombreInicial={q}
          categorias={cat.categorias}
          onListo={(p) => { setCreando(false); setQ(''); ir(`producto/${encodeURIComponent(p.producto_id)}`) }}
        />
      </Hoja>
    </section>
  )
}
