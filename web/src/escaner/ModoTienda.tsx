import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Producto } from '@shared/esquema.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible, formatoContenido } from '@shared/unidades.ts'
import { FormProducto } from '../componentes/FormProducto.tsx'
import { RegistrarPrecio } from '../componentes/RegistrarPrecio.tsx'
import { Boton, Cargando, ChipTienda, Hoja, pesos } from '../componentes/ui.tsx'
import { comparadorPasillo, opcionesDe, useCatalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { compraAbierta } from '../datos/escritura.ts'
import { asignarCodigo, ordenarPorParecido, resolverCodigo, type Sugerencia } from '../datos/modoTienda.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'
import { Escaner } from './Escaner.tsx'

type Fase =
  | { tipo: 'lista' }
  | { tipo: 'escanear' }
  | { tipo: 'buscando' }
  | { tipo: 'elegir'; ean: string; sugerencia: Sugerencia | null }
  | { tipo: 'crear'; ean: string; sugerencia: Sugerencia | null }
  | { tipo: 'precio'; producto: Producto; presentacionId?: string; ean?: string; escaneado: boolean }

/** Nombre sin tamaño para proponer un producto nuevo: "Arroz Diana 1000 g" → "Arroz Diana". */
const sinTamano = (nombre: string) => nombre.replace(/\s+(x\s*)?\d+([.,]\d+)?\s*(g|gr|kg|ml|l|lt|cc|und|un)\b.*$/i, '').trim()

/**
 * En la tienda: eliges dónde estás, escaneas el código de barras (o tocas el producto) y escribes el precio.
 * Pensado para D1 y Ara, que no tienen precios por internet para Riohacha.
 */
export function ModoTienda({ onListo }: { onListo: () => void }) {
  const cat = useCatalogo()
  const [tiendasHoy] = useTiendasHoy()
  const [tienda, setTienda] = useState<Tienda>(() => tiendasHoy.find((t) => t === 'D1' || t === 'ARA') ?? 'D1')
  const [fase, setFase] = useState<Fase>({ tipo: 'lista' })
  const [q, setQ] = useState('')
  const [anotados, setAnotados] = useState(0)
  const enCompra = useLiveQuery(async () => {
    const c = await compraAbierta()
    const ds = c ? await db.detalle.where('compra_id').equals(c.compra_id).toArray() : []
    return new Set(ds.filter((d) => !d.borrado && d.producto_id).map((d) => d.producto_id))
  }, [])
  if (!cat || !enCompra) return <Cargando />

  const activos = cat.productos.filter((p) => p.activo)
  const ahora = ahoraIso()

  async function alLeer(ean: string) {
    setFase({ tipo: 'buscando' })
    const r = await resolverCodigo(ean, tienda)
    if (r.tipo === 'conocido') setFase({ tipo: 'precio', producto: r.producto, presentacionId: r.presentacion.presentacion_id, escaneado: true })
    else setFase({ tipo: 'elegir', ean: r.ean, sugerencia: r.sugerencia })
  }

  async function elegido(p: Producto, ean: string, sugerencia: Sugerencia | null) {
    setFase({ tipo: 'buscando' })
    const pres = await asignarCodigo(p, tienda, ean, sugerencia)
    setFase({ tipo: 'precio', producto: p, presentacionId: pres?.presentacion_id, ean, escaneado: true })
  }

  if (fase.tipo === 'escanear') return <Escaner onCodigo={(ean) => void alLeer(ean)} onCancelar={() => setFase({ tipo: 'lista' })} />
  if (fase.tipo === 'buscando') return <div className="py-8"><Cargando /></div>

  if (fase.tipo === 'precio') {
    const volver = () => { setAnotados((n) => n + 1); setFase(fase.escaneado ? { tipo: 'escanear' } : { tipo: 'lista' }) }
    return (
      <div className="space-y-3">
        <p className="text-lg font-semibold">{fase.producto.nombre}</p>
        <RegistrarPrecio
          producto={fase.producto}
          presentaciones={cat.presentacionesDe.get(fase.producto.producto_id) ?? []}
          actualesDe={cat.actualesDe}
          tiendaInicial={tienda}
          presentacionInicial={fase.presentacionId}
          ean={fase.ean}
          onListo={volver}
        />
        <Boton variante="fantasma" className="w-full" onClick={() => setFase({ tipo: 'lista' })}>Cancelar</Boton>
      </div>
    )
  }

  if (fase.tipo === 'crear') {
    return (
      <FormProducto
        nombreInicial={fase.sugerencia ? sinTamano(fase.sugerencia.nombre) : ''}
        categorias={cat.categorias}
        onListo={(p) => void elegido(p, fase.ean, fase.sugerencia)}
      />
    )
  }

  if (fase.tipo === 'elegir') {
    const s = fase.sugerencia
    const c = s?.candidatos.find((x) => x.contenido)?.contenido
    const nq = normalizar(q)
    const opciones = ordenarPorParecido(activos, s?.nombre ?? '').filter((p) => !nq || normalizar(p.nombre).includes(nq))
    return (
      <div className="space-y-3">
        {s ? (
          <p className="rounded-xl bg-stone-100 p-3 text-sm">
            Es <strong>{s.nombre}</strong>{c ? ` (${formatoContenido(c.valor, c.unidad)})` : ''}. ¿Cuál de tus productos es?
          </p>
        ) : (
          <p className="rounded-xl bg-stone-100 p-3 text-sm">No conozco el código {fase.ean}. ¿Cuál de tus productos es? Lo recordaré la próxima vez.</p>
        )}
        <input
          className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5"
          placeholder="Buscar en tus productos…"
          aria-label="Buscar en tus productos"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-[45dvh] divide-y divide-stone-100 overflow-y-auto">
          {opciones.map((p) => (
            <li key={p.producto_id}>
              <button type="button" className="flex min-h-12 w-full items-center justify-between py-2 text-left active:bg-stone-100" onClick={() => void elegido(p, fase.ean, s)}>
                <span className="font-medium">{p.nombre}</span>
                <span className="text-xs text-stone-600">por {etiquetaVisible(p.unidad_base)}</span>
              </button>
            </li>
          ))}
        </ul>
        <Boton variante="secundario" className="w-full" onClick={() => setFase({ tipo: 'crear', ean: fase.ean, sugerencia: s })}>+ Es un producto nuevo</Boton>
        <Boton variante="fantasma" className="w-full" onClick={() => setFase({ tipo: 'escanear' })}>Escanear otro</Boton>
      </div>
    )
  }

  // Lista: lo de tu compra (o todos tus productos), primero lo que no tiene precio vigente en esta tienda.
  const base = enCompra.size ? activos.filter((p) => enCompra.has(p.producto_id)) : activos
  const orden = comparadorPasillo(cat)
  const nq = normalizar(q)
  const filas = base
    .filter((p) => !nq || normalizar(p.nombre).includes(nq))
    .map((p) => ({ p, op: opcionesDe(cat, p, ahora, [tienda]).porTienda[tienda] }))
    .sort((a, b) => Number(!!a.op) - Number(!!b.op) || orden(a.p.producto_id, b.p.producto_id))
  const faltan = filas.filter((f) => !f.op).length

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-sm text-stone-700">¿En qué tienda estás?</p>
        <div className="flex flex-wrap gap-2">
          {TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tienda === t} onClick={() => setTienda(t)} />)}
        </div>
      </div>
      <Boton className="w-full text-lg" onClick={() => setFase({ tipo: 'escanear' })}>📷 Escanear código de barras</Boton>
      <p className="text-sm text-stone-700">
        {enCompra.size ? 'Tu compra' : 'Tus productos'} en {INFO_TIENDAS[tienda].nombre}: {faltan ? <strong>{faltan} sin precio</strong> : 'todos con precio'}.
        {anotados > 0 && ` Anotaste ${anotados}.`} Toca uno para anotar su precio.
      </p>
      <input
        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5"
        placeholder="Buscar…"
        aria-label="Buscar producto"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="divide-y divide-stone-100">
        {filas.map(({ p, op }) => (
          <li key={p.producto_id}>
            <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-left active:bg-stone-100" onClick={() => setFase({ tipo: 'precio', producto: p, escaneado: false })}>
              <span className="font-medium">{p.nombre}</span>
              {op ? (
                <span className="shrink-0 text-sm text-ok">✔ {pesos(op.efectivo.precio)}</span>
              ) : (
                <span className="shrink-0 text-sm font-medium text-alerta">anotar</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Boton variante="secundario" className="w-full" onClick={onListo}>Terminar</Boton>
    </div>
  )
}

/** Botón que abre el modo tienda. */
export function BotonModoTienda({ className = '', variante = 'secundario' }: { className?: string; variante?: 'primario' | 'secundario' | 'fantasma' }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <Boton variante={variante} className={className} onClick={() => setAbierto(true)}>📷 Anotar precios en la tienda</Boton>
      <Hoja abierta={abierto} titulo="Precios en la tienda" onCerrar={() => setAbierto(false)} protegida>
        {abierto && <ModoTienda onListo={() => setAbierto(false)} />}
      </Hoja>
    </>
  )
}
