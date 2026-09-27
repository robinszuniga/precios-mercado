import { useState } from 'react'
import type { Presentacion } from '@shared/esquema.ts'
import { TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible } from '@shared/unidades.ts'
import { ir } from '../app/ruta.ts'
import { FormProducto } from '../componentes/FormProducto.tsx'
import { describirPresentacion, RegistrarPrecio } from '../componentes/RegistrarPrecio.tsx'
import { Boton, Distintivo, hace, Hoja, NombreTienda, pesos, Tarjeta, Vacio } from '../componentes/ui.tsx'
import { Vincular } from '../componentes/Vincular.tsx'
import { opcionesDe, useCatalogo } from '../datos/consultas.ts'
import { guardar } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { diasEntre } from '@shared/fechas.ts'

type Dialogo = null | 'editar' | 'vincular' | { precio: { tienda?: Tienda; presentacion?: string } }

export function DetalleProducto({ id }: { id: string }) {
  const cat = useCatalogo()
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  if (!cat) return null
  const producto = cat.producto.get(id)
  if (!producto) return <Vacio>Ese producto no existe. <a className="text-marca underline" href="#/lista">Volver</a></Vacio>
  const ahora = ahoraIso()
  const ops = opcionesDe(cat, producto, ahora)
  const presentaciones = (cat.presentacionesDe.get(id) ?? []).filter((p) => p.activo)
  const u = etiquetaVisible(producto.unidad_base)
  const cerrar = () => setDialogo(null)

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <a href="#/lista" className="text-sm text-marca">← Lista</a>
          <h1 className="text-2xl font-bold">{producto.nombre}</h1>
          <p className="text-sm text-stone-500">Se compara por {u} · habitual {String(producto.cantidad_habitual).replace('.', ',')} {u}</p>
        </div>
        <Boton variante="secundario" onClick={() => setDialogo('editar')}>Editar</Boton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TIENDAS.map((t) => {
          const op = ops.porTienda[t]
          const sin = ops.sinVigente[t]
          const mejor = ops.mejor?.tienda === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setDialogo({ precio: { tienda: t, presentacion: op?.presentacion.presentacion_id } })}
              className={`rounded-2xl bg-white p-3 text-left ring-1 ${mejor ? 'ring-2 ring-ok' : 'ring-stone-200'}`}
            >
              <div className="flex items-center justify-between">
                <NombreTienda tienda={t} className="text-sm font-medium" />
                {mejor && <span className="text-xs font-semibold text-ok">más barato</span>}
              </div>
              {op ? (
                <>
                  <div className="mt-1 text-xl font-bold">{op.precioUnidad != null ? pesos(op.precioUnidad) : pesos(op.efectivo.precio)}<span className="text-sm font-normal text-stone-500">{op.precioUnidad != null ? `/${u}` : ''}</span></div>
                  <div className="text-xs text-stone-500">{pesos(op.efectivo.precio)} · {describirPresentacion(op.presentacion, producto)}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-stone-500">
                    <Distintivo tipo={op.efectivo.distintivo} amarillo={op.efectivo.estado === 'amarillo'} />
                    {op.efectivo.oferta && <span className="text-ok">oferta</span>}
                    <span>{hace(op.efectivo.edadDias)}</span>
                  </div>
                </>
              ) : sin?.ultimo ? (
                <div className="mt-1 text-stone-400">
                  <div className="text-lg line-through">{pesos(sin.ultimo.precio)}</div>
                  <div className="text-xs">{sin.agotadoOnline ? 'agotado online' : `vencido, ${hace(diasEntre(sin.ultimo.fecha_verificado, ahora))}`}</div>
                </div>
              ) : (
                <div className="mt-1 text-sm text-stone-400">Sin precio · toca para anotar</div>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2">
        <Boton className="flex-1" onClick={() => setDialogo({ precio: {} })}>Anotar precio</Boton>
        <Boton variante="secundario" className="flex-1" onClick={() => setDialogo('vincular')}>Buscar online</Boton>
      </div>

      <Tarjeta>
        <h2 className="mb-1 font-semibold">Presentaciones</h2>
        {presentaciones.length === 0 && <p className="text-sm text-stone-500">Ninguna todavía. Anota un precio o búscalo online.</p>}
        <ul className="divide-y divide-stone-100">
          {presentaciones.sort((a, b) => a.tienda.localeCompare(b.tienda)).map((p) => (
            <FilaPresentacion key={p.presentacion_id} p={p} texto={describirPresentacion(p, producto)} />
          ))}
        </ul>
      </Tarjeta>

      <a href={`#/historico/producto/${encodeURIComponent(id)}`} className="block text-center text-marca">Ver cómo ha cambiado el precio →</a>

      <Hoja abierta={dialogo === 'editar'} titulo="Editar producto" onCerrar={cerrar}>
        <FormProducto inicial={producto} categorias={cat.categorias} onListo={cerrar} />
        <Boton
          variante="peligro"
          className="mt-3 w-full"
          onClick={async () => { await guardar('Productos', { ...producto, activo: false, recurrente: false }); ir('lista') }}
        >
          Archivar producto
        </Boton>
      </Hoja>
      <Hoja abierta={dialogo === 'vincular'} titulo="Buscar en la tienda online" onCerrar={cerrar}>
        <Vincular producto={producto} yaVinculadas={presentaciones} onListo={cerrar} />
      </Hoja>
      <Hoja abierta={typeof dialogo === 'object' && dialogo !== null} titulo="Anotar precio" onCerrar={cerrar}>
        {typeof dialogo === 'object' && dialogo !== null && (
          <RegistrarPrecio
            producto={producto}
            presentaciones={presentaciones}
            tiendaInicial={dialogo.precio.tienda}
            presentacionInicial={dialogo.precio.presentacion}
            onListo={cerrar}
          />
        )}
      </Hoja>
    </section>
  )
}

function FilaPresentacion({ p, texto }: { p: Presentacion; texto: string }) {
  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <NombreTienda tienda={p.tienda} />
        <div className="truncate">{texto}</div>
        <div className="text-xs text-stone-500">
          {p.auto ? (p.tienda === 'D1' ? 'automático si D1 atiende Riohacha' : 'se actualiza solo') : 'manual'}
          {p.ultimo_error && <span className="text-peligro"> · {p.ultimo_error}</span>}
        </div>
      </div>
      <button type="button" className="text-stone-400" aria-label="Quitar presentación" onClick={() => void guardar('Presentaciones', { ...p, activo: false })}>
        Quitar
      </button>
    </li>
  )
}
