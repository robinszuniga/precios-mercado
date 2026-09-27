import { useState } from 'react'
import type { Presentacion } from '@shared/esquema.ts'
import { diasEntre } from '@shared/fechas.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible, formatoCantidadVisible, precioPorUnidad } from '@shared/unidades.ts'
import { ir } from '../app/ruta.ts'
import { FormProducto } from '../componentes/FormProducto.tsx'
import { describirPresentacion, RegistrarPrecio } from '../componentes/RegistrarPrecio.tsx'
import { avisar, Boton, Cargando, Distintivo, hace, Hoja, LeyendaDistintivos, LogoTienda, NombreTienda, pesos, Tarjeta, Vacio } from '../componentes/ui.tsx'
import { Vincular } from '../componentes/Vincular.tsx'
import { opcionesDe, useCatalogo, useMeta } from '../datos/consultas.ts'
import { guardar } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'

type Dialogo = null | 'editar' | 'vincular' | { precio: { tienda?: Tienda; presentacion?: string } } | { quitar: Presentacion }

export function DetalleProducto({ id }: { id: string }) {
  const cat = useCatalogo()
  const conexion = useMeta<{ url: string; token: string }>('conexion', { url: '', token: '' })
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  if (!cat) return <Cargando />
  const producto = cat.producto.get(id)
  if (!producto) return <Vacio>Ese producto no existe. <a className="text-marca underline" href="#/lista">Volver</a></Vacio>
  const ahora = ahoraIso()
  const ops = opcionesDe(cat, producto, ahora)
  const presentaciones = (cat.presentacionesDe.get(id) ?? []).filter((p) => p.activo)
  const u = etiquetaVisible(producto.unidad_base)
  const cerrar = () => setDialogo(null)
  const conBackend = !!conexion.url && !!conexion.token
  const segunda = ops.mejor
    ? Object.values(ops.porTienda).filter((o) => o.tienda !== ops.mejor!.tienda && o.precioUnidad != null).sort((a, b) => a.precioUnidad! - b.precioUnidad!)[0]
    : undefined

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href="#/lista" className="inline-flex min-h-11 items-center text-marca">← Productos</a>
          <h1 className="text-2xl font-bold">{producto.nombre}</h1>
          <p className="text-sm text-stone-700">Se compara por {u} · sueles llevar {formatoCantidadVisible(producto.cantidad_habitual, producto.unidad_base)}</p>
        </div>
        <Boton variante="secundario" onClick={() => setDialogo('editar')}>Editar</Boton>
      </div>

      {ops.mejor && ops.mejor.precioUnidad != null && (
        <Tarjeta className="ring-2 ring-ok">
          <p className="text-sm text-stone-700">Más barato</p>
          <p className="flex items-center gap-2 text-2xl font-bold">
            <LogoTienda tienda={ops.mejor.tienda} tam={28} /> {INFO_TIENDAS[ops.mejor.tienda].nombre} · {pesos(ops.mejor.precioUnidad)}/{u}
          </p>
          {segunda && <p className="text-sm text-stone-700">{pesos(segunda.precioUnidad! - ops.mejor.precioUnidad)}/{u} menos que en {INFO_TIENDAS[segunda.tienda].nombre}</p>}
        </Tarjeta>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
        {TIENDAS.map((t) => {
          const op = ops.porTienda[t]
          const sin = ops.sinVigente[t]
          const mejor = ops.mejor?.tienda === t
          const presVieja = sin?.ultimo ? presentaciones.find((p) => p.presentacion_id === sin.ultimo!.presentacion_id) : undefined
          const puViejo = sin?.ultimo && presVieja ? precioPorUnidad(sin.ultimo.precio, presVieja.contenido, producto.unidad_base) : null
          return (
            <button
              key={t}
              type="button"
              onClick={() => setDialogo({ precio: { tienda: t, presentacion: op?.presentacion.presentacion_id } })}
              className={`rounded-2xl bg-white p-3 text-left ring-1 active:bg-stone-50 ${mejor ? 'ring-2 ring-ok' : 'ring-stone-200'}`}
              aria-label={`${INFO_TIENDAS[t].nombre}: anotar precio`}
            >
              <NombreTienda tienda={t} className="text-sm font-medium" />
              {op ? (
                <>
                  <div className="mt-1 text-xl font-bold">
                    {op.precioUnidad != null ? pesos(op.precioUnidad) : pesos(op.efectivo.precio)}
                    <span className="text-sm font-normal text-stone-600">{op.precioUnidad != null ? `/${u}` : ''}</span>
                  </div>
                  <div className="text-xs text-stone-700">{pesos(op.efectivo.precio)} · {describirPresentacion(op.presentacion, producto)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-stone-700">
                    <Distintivo tipo={op.efectivo.distintivo} amarillo={op.efectivo.estado === 'amarillo'} dias={op.efectivo.edadDias} />
                    {op.efectivo.oferta && <span className="font-medium text-ok">oferta</span>}
                    {op.efectivo.estado !== 'amarillo' && <span>{hace(op.efectivo.edadDias)}</span>}
                  </div>
                </>
              ) : sin?.ultimo ? (
                <div className="mt-1 text-stone-700">
                  <div className="text-lg">{puViejo != null ? `${pesos(puViejo)}/${u}` : pesos(sin.ultimo.precio)}</div>
                  <div className="text-xs">{sin.agotadoOnline ? 'Agotado online' : `Vencido (${hace(diasEntre(sin.ultimo.fecha_verificado, ahora))}) · toca para actualizar`}</div>
                </div>
              ) : (
                <div className="mt-1 text-sm text-stone-600">Sin precio · toca para anotar</div>
              )}
            </button>
          )
        })}
      </div>
      <LeyendaDistintivos />

      <div className="grid grid-cols-2 gap-2">
        <Boton onClick={() => setDialogo({ precio: {} })}>Anotar precio</Boton>
        <Boton variante="secundario" onClick={() => (conBackend ? setDialogo('vincular') : ir('ajustes'))}>Buscar online</Boton>
      </div>
      {!conBackend && <p className="text-xs text-stone-600">Para buscar en Éxito, Olímpica y D1 hace falta conectar la copia en Google (Ajustes).</p>}

      <Tarjeta>
        <h2 className="mb-1 font-semibold">Marcas y tamaños</h2>
        {presentaciones.length === 0 && <p className="text-sm text-stone-600">Ninguno todavía. Anota un precio o búscalo online.</p>}
        <ul className="divide-y divide-stone-100">
          {[...presentaciones].sort((a, b) => TIENDAS.indexOf(a.tienda) - TIENDAS.indexOf(b.tienda)).map((p) => (
            <li key={p.presentacion_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <div className="min-w-0">
                <NombreTienda tienda={p.tienda} tam={16} />
                <div className="truncate">{describirPresentacion(p, producto)}</div>
                <div className="text-xs text-stone-600">
                  {p.auto ? (p.tienda === 'D1' ? 'automático si D1 atiende Riohacha' : 'se actualiza solo desde internet') : 'lo anotas tú'}
                  {p.ultimo_error && <span className="text-peligro"> · {p.ultimo_error}</span>}
                </div>
              </div>
              <Boton variante="fantasma" className="shrink-0 text-stone-700" onClick={() => setDialogo({ quitar: p })} aria-label={`Quitar ${describirPresentacion(p, producto)} de ${INFO_TIENDAS[p.tienda].nombre}`}>
                Quitar
              </Boton>
            </li>
          ))}
        </ul>
      </Tarjeta>

      <a href={`#/historico/producto/${encodeURIComponent(id)}`} className="flex min-h-11 items-center justify-center text-marca">Ver cómo ha cambiado el precio →</a>

      <Hoja abierta={dialogo === 'editar'} titulo="Editar producto" onCerrar={cerrar} protegida>
        <FormProducto inicial={producto} categorias={cat.categorias} onListo={cerrar} />
        <Boton
          variante="peligro"
          className="mt-6 w-full"
          onClick={async () => {
            await guardar('Productos', { ...producto, activo: false, recurrente: false })
            avisar(`${producto.nombre} archivado`, () => guardar('Productos', producto).then(() => ir(`producto/${encodeURIComponent(id)}`)))
            ir('lista')
          }}
        >
          Archivar producto
        </Boton>
        <p className="mt-1 text-center text-xs text-stone-600">Sale de la lista y del plan. Se puede recuperar en Ajustes → Archivados.</p>
      </Hoja>
      <Hoja abierta={dialogo === 'vincular'} titulo="Buscar en la tienda online" onCerrar={cerrar}>
        <Vincular producto={producto} yaVinculadas={presentaciones} onListo={cerrar} />
      </Hoja>
      <Hoja abierta={typeof dialogo === 'object' && dialogo !== null && 'precio' in dialogo} titulo={`Anotar precio de ${producto.nombre}`} onCerrar={cerrar} protegida>
        {typeof dialogo === 'object' && dialogo !== null && 'precio' in dialogo && (
          <RegistrarPrecio
            producto={producto}
            presentaciones={presentaciones}
            actualesDe={cat.actualesDe}
            tiendaInicial={dialogo.precio.tienda}
            presentacionInicial={dialogo.precio.presentacion}
            onListo={cerrar}
          />
        )}
      </Hoja>
      <Hoja abierta={typeof dialogo === 'object' && dialogo !== null && 'quitar' in dialogo} titulo="¿Quitar esta marca y tamaño?" onCerrar={cerrar}>
        {typeof dialogo === 'object' && dialogo !== null && 'quitar' in dialogo && (
          <div className="space-y-3">
            <p>
              <strong>{describirPresentacion(dialogo.quitar, producto)}</strong> de {INFO_TIENDAS[dialogo.quitar.tienda].nombre}. Sus precios dejan de
              compararse.
            </p>
            <Boton
              variante="peligro"
              className="w-full"
              onClick={async () => {
                const p = dialogo.quitar
                await guardar('Presentaciones', { ...p, activo: false })
                avisar('Quitado', () => guardar('Presentaciones', p).then(() => undefined))
                cerrar()
              }}
            >
              Sí, quitar
            </Boton>
            <Boton variante="secundario" className="w-full" onClick={cerrar}>Cancelar</Boton>
          </div>
        )}
      </Hoja>
    </section>
  )
}
