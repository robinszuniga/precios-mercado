import type { Detalle, Producto } from '@shared/esquema.ts'
import type { ItemPlan } from '@shared/recomendacion.ts'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible } from '@shared/unidades.ts'
import { guardar } from '../datos/escritura.ts'
import { describirPresentacion } from './RegistrarPrecio.tsx'
import { avisar, Boton, LogoTienda, Pasos, pesos } from './ui.tsx'

/** Hoja de un ítem del plan: dónde comprarlo (con el precio de cada tienda), cuánto esta vez, o quitarlo. */
export function HojaItemPlan({ d, producto, item, tiendas, elegida, onListo }: {
  d: Detalle
  producto: Producto
  item: ItemPlan | undefined
  tiendas: Tienda[]
  /** La tienda que el plan eligió (o la fijada). */
  elegida: Tienda | undefined
  onListo: () => void
}) {
  const u = etiquetaVisible(producto.unidad_base)
  const fijar = async (t: Tienda | '') => {
    await guardar('Compras_detalle', { ...d, tienda: t })
    onListo()
  }
  const opciones = tiendas
    .map((t) => ({ t, c: item?.costos[t] }))
    .sort((a, b) => (a.c?.costoEquivalente ?? Infinity) - (b.c?.costoEquivalente ?? Infinity))
  const masBarata = opciones[0]?.c
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 rounded-xl bg-white p-2 ring-1 ring-stone-200">
        <span className="text-sm text-stone-700">Esta vez necesito</span>
        <Pasos
          valor={d.necesidad ?? producto.cantidad_habitual}
          paso={producto.unidad_base === 'unidad' ? 1 : 0.5}
          minimo={0.5}
          etiqueta="cantidad"
          sufijo={u}
          onCambio={(v) => void guardar('Compras_detalle', { ...d, necesidad: v })}
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm text-stone-700">Comprar en</legend>
        <div className="space-y-2">
          <button
            type="button"
            aria-pressed={!d.tienda}
            onClick={() => void fijar('')}
            className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${!d.tienda ? 'border-marca bg-marca-suave' : 'border-stone-300 bg-white'}`}
          >
            <span>Donde sea más barato {elegida && !d.tienda && <span className="text-sm text-stone-700">(hoy: {INFO_TIENDAS[elegida].nombre})</span>}</span>
            {!d.tienda && <span aria-hidden>✓</span>}
          </button>
          {opciones.map(({ t, c }) => (
            <button
              key={t}
              type="button"
              aria-pressed={d.tienda === t}
              disabled={!c}
              onClick={() => void fijar(t)}
              className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${d.tienda === t ? 'border-marca bg-marca-suave' : 'border-stone-300 bg-white'}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <LogoTienda tienda={t} />
                <span className="min-w-0">
                  <span className="block">{INFO_TIENDAS[t].nombre}</span>
                  {c && <span className="block truncate text-xs text-stone-600">{c.paquetes} × {describirPresentacion(c.opcion.presentacion, producto)}</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {c ? (
                  <>
                    <span className="block font-semibold">{pesos(c.costoReal)}</span>
                    {masBarata && c !== masBarata && <span className="block text-xs text-stone-600">+{pesos(c.costoEquivalente - masBarata.costoEquivalente)}</span>}
                  </>
                ) : (
                  <span className="text-sm text-stone-600">sin precio</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <Boton
        variante="fantasma"
        className="w-full text-peligro"
        onClick={async () => {
          const antes = { ...d }
          await guardar('Compras_detalle', { ...d, borrado: true })
          avisar(`${producto.nombre} quitado de esta compra`, () => guardar('Compras_detalle', antes).then(() => undefined))
          onListo()
        }}
      >
        Quitar de esta compra
      </Boton>
    </div>
  )
}
