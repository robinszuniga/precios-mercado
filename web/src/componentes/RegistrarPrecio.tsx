import { useEffect, useRef, useState } from 'react'
import { parseContenido } from '@shared/contenido.ts'
import type { PrecioActual, Presentacion, Producto } from '@shared/esquema.ts'
import { diasEntre } from '@shared/fechas.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible, factorVisible, formatoContenido, precioPorUnidad } from '@shared/unidades.ts'
import { useMeta } from '../datos/consultas.ts'
import { guardarMeta } from '../datos/db.ts'
import { guardar, nuevaPresentacion, registrarPrecioManual } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { avisar, Boton, Campo, Casilla, hace, leerNumero, pesos, Selector } from './ui.tsx'

export function describirPresentacion(p: Presentacion, producto: Producto): string {
  const nombre = p.marca || p.nombre_en_tienda || 'Sin marca'
  if (p.granel) return `${nombre} (a granel, por ${etiquetaVisible(producto.unidad_base)})`
  if (!p.contenido) return `${nombre} (sin tamaño)`
  return `${nombre} ${formatoContenido(p.contenido, producto.unidad_base)}`
}

/** Último precio de tienda (o el más reciente) de una presentación, para comparar lo que se escribe. */
export function precioAnterior(actuales: readonly PrecioActual[] | undefined): PrecioActual | undefined {
  const xs = (actuales ?? []).filter((a) => a.precio != null && a.precio > 0)
  return xs.find((a) => a.origen === 'tienda') ?? xs.sort((a, b) => (a.fecha_verificado < b.fecha_verificado ? 1 : -1))[0]
}

/** El precio escrito se aleja más del 50 % del anterior: probablemente un cero de más o de menos. */
export function precioAtipico(nuevo: number, anterior: number | null | undefined): boolean {
  if (!anterior || !nuevo) return false
  return nuevo > anterior * 1.5 || nuevo < anterior * 0.5
}

function primeraDe(presentaciones: Presentacion[], t: Tienda): string {
  return presentaciones.find((p) => p.activo && p.tienda === t)?.presentacion_id ?? '__nueva'
}

/** Precio visto en la tienda (manual). Si la presentación no existe, se crea con marca y tamaño. */
export function RegistrarPrecio({
  producto, presentaciones, actualesDe, tiendaInicial, presentacionInicial, ean = '', onListo,
}: {
  producto: Producto
  presentaciones: Presentacion[]
  actualesDe: ReadonlyMap<string, PrecioActual[]>
  tiendaInicial?: Tienda
  presentacionInicial?: string
  /** Código de barras escaneado: queda en la marca/tamaño nuevo para reconocerlo la próxima vez. */
  ean?: string
  onListo: () => void
}) {
  const ultima = useMeta<Tienda | null>('ultimaTienda', null)
  const [tienda, setTienda] = useState<Tienda>(tiendaInicial ?? ultima ?? 'D1')
  const deTienda = presentaciones.filter((p) => p.activo && p.tienda === tienda)
  const [presId, setPresId] = useState(presentacionInicial ?? primeraDe(presentaciones, tiendaInicial ?? ultima ?? 'D1'))
  const [marca, setMarca] = useState('')
  const [tamano, setTamano] = useState('')
  const [granel, setGranel] = useState(false)
  const [precio, setPrecio] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const pres = deTienda.find((p) => p.presentacion_id === presId)
  const nueva = !pres
  const c = parseContenido(tamano)
  const tamanoOk = granel || (!!c && c.unidad === producto.unidad_base)
  const contenido = pres ? pres.contenido : granel ? factorVisible(producto.unidad_base) : tamanoOk ? c!.valor : null
  const valor = leerNumero(precio)
  const anterior = pres ? precioAnterior(actualesDe.get(pres.presentacion_id)) : undefined
  const porUnidad = valor ? precioPorUnidad(valor, contenido, producto.unidad_base) : null
  const atipico = !!valor && precioAtipico(valor, anterior?.precio)
  const sinTamano = nueva && !tamanoOk
  const pideConfirmar = atipico || sinTamano

  // La última tienda llega un instante después (base local): si el usuario no ha elegido otra, se usa esa.
  const eligio = useRef(false)
  const guardando = useRef(false)
  useEffect(() => {
    if (tiendaInicial || eligio.current || !ultima || ultima === tienda) return
    setTienda(ultima)
    if (!presentacionInicial) setPresId(primeraDe(presentaciones, ultima))
  }, [ultima])

  function cambiarTienda(t: Tienda) {
    eligio.current = true
    setTienda(t)
    setPresId(primeraDe(presentaciones, t))
    setConfirmando(false)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!valor || valor <= 0) return
    if (pideConfirmar && !confirmando) { setConfirmando(true); return }
    // Un doble toque no crea dos veces la misma marca/tamaño ni anota dos veces el precio.
    if (guardando.current) return
    guardando.current = true
    let p = pres
    if (!p) {
      ;[p] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
        producto_id: producto.producto_id,
        tienda,
        marca: marca.trim(),
        nombre_en_tienda: [marca.trim(), tamano.trim()].filter(Boolean).join(' '),
        granel,
        contenido,
        ean,
      }))
    }
    await registrarPrecioManual(p!, valor)
    await guardarMeta('ultimaTienda', tienda)
    avisar(`Precio guardado: ${INFO_TIENDAS[tienda].nombre} ${pesos(valor)}`)
    onListo()
  }

  let aviso: string | undefined
  if (confirmando && atipico) aviso = `Antes costaba ${pesos(anterior!.precio)}. ¿Seguro que es ${pesos(valor)}?`
  else if (confirmando && sinTamano) aviso = `Sin tamaño no puedo comparar por ${etiquetaVisible(producto.unidad_base)}. ¿Guardar igual?`

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Selector etiqueta="Tienda" value={tienda} onChange={(e) => cambiarTienda(e.target.value as Tienda)}>
        {TIENDAS.map((t) => <option key={t} value={t}>{INFO_TIENDAS[t].nombre}</option>)}
      </Selector>
      <Selector etiqueta="Marca y tamaño" value={pres ? presId : '__nueva'} onChange={(e) => { setPresId(e.target.value); setConfirmando(false) }}>
        {deTienda.map((p) => <option key={p.presentacion_id} value={p.presentacion_id}>{describirPresentacion(p, producto)}</option>)}
        <option value="__nueva">+ Otra marca o tamaño…</option>
      </Selector>
      {nueva && (
        <>
          <Campo etiqueta="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Diana, marca propia…" />
          <Casilla etiqueta={`Se vende a granel (precio por ${etiquetaVisible(producto.unidad_base)})`} checked={granel} onChange={setGranel} />
          {!granel && (
            <Campo
              etiqueta="Tamaño del paquete"
              value={tamano}
              onChange={(e) => { setTamano(e.target.value); setConfirmando(false) }}
              placeholder={producto.unidad_base === 'g' ? 'Ej: 500 g, 1 kg' : producto.unidad_base === 'ml' ? 'Ej: 1 L, 900 ml' : 'Ej: 30 und'}
              ayuda={tamano ? (tamanoOk ? `= ${formatoContenido(c!.valor, producto.unidad_base)}` : 'No entiendo ese tamaño. Escríbelo como 500 g, 1 kg, 1 L o 30 und.') : undefined}
            />
          )}
        </>
      )}
      <Campo
        etiqueta={granel || pres?.granel ? `Precio por ${etiquetaVisible(producto.unidad_base)}` : 'Precio del paquete'}
        inputMode="numeric"
        value={precio}
        onChange={(e) => { setPrecio(e.target.value); setConfirmando(false) }}
        placeholder="Ej: 4.500"
        required
        data-autofocus={nueva ? undefined : true}
        aviso={aviso}
        ayuda={
          valor || anterior ? (
            <>
              {porUnidad != null && <>= {pesos(porUnidad)}/{etiquetaVisible(producto.unidad_base)}</>}
              {anterior && <>{porUnidad != null ? ' · ' : ''}antes {pesos(anterior.precio)} ({hace(diasEntre(anterior.fecha_verificado, ahoraIso()))})</>}
            </>
          ) : undefined
        }
      />
      <Boton type="submit" className="w-full" disabled={!valor}>
        {confirmando && atipico ? `Sí, es ${pesos(valor)}` : confirmando && sinTamano ? 'Guardar sin tamaño' : 'Guardar precio'}
      </Boton>
    </form>
  )
}
