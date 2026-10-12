import { useLiveQuery } from 'dexie-react-hooks'
import { Component, lazy, Suspense, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { enlaceGoogleMaps, enlaceWaze, formatoKm, MAX_SEDES, ordenarRuta, sedeMasCercana, type Punto, type Sede } from '@shared/mapa.ts'
import { planCompra } from '@shared/recomendacion.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import type { PinSede } from '../componentes/MapaLeaflet.tsx'
import { avisar, Boton, Campo, Cargando, Hoja, NombreTienda, pesos, Tarjeta, Titulo } from '../componentes/ui.tsx'
import { compartirTexto, textoRuta } from '../datos/compartir.ts'
import { itemsDelPlan, useCatalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { compraAbierta } from '../datos/escritura.ts'
import { agregarSede, agregarSedesEncontradas, buscarSedesEnLinea, quitarSede, restaurarSede } from '../datos/sedes.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'
import { ErrorUbicacion, MENSAJE_UBICACION, ubicarme, type Ubicacion } from '../datos/ubicacion.ts'

const cargarMapa = () => import('../componentes/MapaLeaflet.tsx')
/** Leaflet y sus estilos se bajan solo al abrir esta pantalla. Si la descarga falla, "Reintentar" crea otra carga. */
let MapaLeaflet = lazy(cargarMapa)

/** Si el mapa no carga (sin señal la primera vez), el resto de la pantalla sigue sirviendo y se puede reintentar. */
class LimiteMapa extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false }
  static getDerivedStateFromError() { return { fallo: true } }
  render() {
    if (this.state.fallo) {
      return (
        <div role="status" className="grid place-items-center gap-2 rounded-2xl bg-stone-100 p-4 text-center text-sm text-stone-600">
          <p>No se pudo cargar el mapa (¿sin señal?). Las tiendas y la ruta de abajo sí funcionan.</p>
          <Boton variante="secundario" onClick={() => { MapaLeaflet = lazy(cargarMapa); this.setState({ fallo: false }) }}>Reintentar</Boton>
        </div>
      )
    }
    return this.props.children
  }
}

const BOTON_ENLACE = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-4 py-2.5 font-medium'

function Enlace({ href, children, secundario = false, etiqueta }: { href: string; children: ReactNode; secundario?: boolean; etiqueta?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={etiqueta} className={`${BOTON_ENLACE} ${secundario ? 'bg-white text-stone-800 ring-1 ring-stone-300' : 'bg-marca text-white'}`}>
      {children}
    </a>
  )
}

interface Fila {
  tienda: Tienda
  /** Lo que cuesta la lista en esa tienda (solo lo que ella tiene). */
  total: number | null
  items: number
  de: number
}

const completa = (f: Fila | undefined) => !!f && f.total != null && f.items === f.de && f.de > 0
/** "$ 8.800", o "$ 5.800 (2 de 3)" si la tienda no tiene todo: un total parcial nunca se muestra como si fuera el total. */
const textoTotal = (f: Fila | undefined) => (f?.total == null ? '' : completa(f) ? pesos(f.total) : `${pesos(f.total)} (${f.items} de ${f.de})`)

export function Mapa() {
  const cat = useCatalogo()
  const [tiendasHoy] = useTiendasHoy()
  const datos = useLiveQuery(async () => {
    const compra = await compraAbierta()
    const detalles = compra ? (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado) : []
    return { compra, detalles }
  }, [])
  const [yo, setYo] = useState<Punto | null>(null)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [modoToque, setModoToque] = useState(false)
  const [nueva, setNueva] = useState<Ubicacion | null>(null)
  const [ocupado, setOcupado] = useState<'' | 'gps' | 'aqui' | 'osm'>('')
  const [mensaje, setMensaje] = useState('')
  const [sinTeselas, setSinTeselas] = useState(false)
  const zonaMapa = useRef<HTMLDivElement>(null)
  if (!cat || !datos) return <Cargando />

  const sedes = cat.cfg.sedes
  const ahora = ahoraIso()
  const hayLista = !!datos.compra && datos.detalles.some((d) => d.estado === 'pendiente' && d.producto_id)
  // Cuánto costaría tu lista completa en cada cadena (no solo en las de hoy), y el plan de hoy con las tiendas que elegiste.
  const todas = hayLista ? planCompra(itemsDelPlan(cat, datos.detalles, ahora, TIENDAS), TIENDAS, cat.cfg.ahorroMinimoTienda) : null
  const hoy = hayLista ? planCompra(itemsDelPlan(cat, datos.detalles, ahora, tiendasHoy), tiendasHoy, cat.cfg.ahorroMinimoTienda) : null
  const masBarata = todas?.mejorUnica?.tienda ?? null
  const enPlan = new Set<Tienda>(hoy?.tiendas ?? [])

  const filas: Fila[] = TIENDAS.map((t) => {
    const x = todas?.todoEn.find((e) => e.tienda === t)
    return { tienda: t, total: x && x.items > 0 ? x.total : null, items: x?.items ?? 0, de: x?.de ?? 0 }
  }).sort((a, b) => {
    if (completa(a) !== completa(b)) return completa(a) ? -1 : 1
    if (a.items !== b.items) return b.items - a.items
    return (a.total ?? Infinity) - (b.total ?? Infinity)
  })
  const filaDe = new Map(filas.map((f) => [f.tienda, f]))

  const pines: PinSede[] = sedes.map((sede) => ({ sede, etiqueta: textoTotal(filaDe.get(sede.tienda)), mejor: sede.tienda === masBarata, enPlan: enPlan.has(sede.tienda) }))
  const centro: Punto = yo ?? (sedes.length
    ? { lat: sedes.reduce((s, x) => s + x.lat, 0) / sedes.length, lng: sedes.reduce((s, x) => s + x.lng, 0) / sedes.length }
    : { lat: cat.cfg.ubicacion.lat, lng: cat.cfg.ubicacion.lon })

  // Los enlaces no llevan punto de partida: Google Maps y Waze parten de donde esté la persona en ese momento (y así el
  // enlace que se comparte no revela dónde estabas).
  const ruta = hoy && hoy.tiendas.length ? ordenarRuta(yo, sedes, hoy.tiendas) : null
  const enlaceRuta = ruta?.paradas.length ? enlaceGoogleMaps(ruta.paradas.map((p) => p.sede)) : null
  const elegida = sedes.find((s) => s.id === seleccionada)

  async function ubicar(exacta: boolean): Promise<Ubicacion | null> {
    setOcupado(exacta ? 'aqui' : 'gps')
    setMensaje('')
    try {
      const p = await ubicarme(exacta)
      setYo({ lat: p.lat, lng: p.lng })
      return p
    } catch (e) {
      setMensaje(MENSAJE_UBICACION[e instanceof ErrorUbicacion ? e.motivo : 'no_disponible'])
      return null
    } finally {
      setOcupado('')
    }
  }

  async function agregarAqui() {
    const p = await ubicar(true)
    if (p) setNueva(p)
  }

  async function buscarCerca() {
    setOcupado('osm')
    setMensaje('')
    try {
      const centroBusqueda = yo ?? { lat: cat!.cfg.ubicacion.lat, lng: cat!.cfg.ubicacion.lon }
      const r = await buscarSedesEnLinea(centroBusqueda)
      if (!r.ok) {
        setMensaje(`No pude buscar las tiendas: ${r.motivo}. Inténtalo en un rato, o agrégalas a mano.`)
        return
      }
      const n = await agregarSedesEncontradas(r.sedes)
      if (n > 0) avisar(n === 1 ? 'Encontré 1 sede nueva.' : `Encontré ${n} sedes nuevas.`)
      else setMensaje(r.sedes.length ? 'Las sedes que encontré ya estaban guardadas.' : 'No encontré tiendas de las cuatro cadenas en OpenStreetMap cerca de aquí. Agrégalas a mano.')
    } catch {
      setMensaje('No pude guardar las sedes. Inténtalo de nuevo.')
    } finally {
      setOcupado('')
    }
  }

  async function quitar(s: Sede) {
    const q = await quitarSede(s.id)
    if (seleccionada === s.id) setSeleccionada(null)
    if (q) avisar(`${q.nombre} quitada`, () => restaurarSede(q))
  }

  function verEnElMapa(id: string) {
    setSeleccionada(id)
    zonaMapa.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  function compartir() {
    if (!ruta?.paradas.length) return
    const paradas = ruta.paradas.map((p, i) => ({ tienda: p.sede.tienda, nombre: p.sede.nombre, km: yo || i > 0 ? p.km : 0 }))
    void compartirTexto(textoRuta(paradas, ruta.totalKm, enlaceRuta, hoy?.total ?? null))
  }

  return (
    <section className="space-y-3">
      <Titulo sub="Dónde queda cada tienda y cuánto cuesta tu lista en cada una.">Mapa de tiendas</Titulo>

      <div ref={zonaMapa} className="scroll-mt-4 space-y-2">
        <LimiteMapa>
          <Suspense fallback={<div className="grid h-72 place-items-center rounded-2xl bg-stone-100 text-sm text-stone-600">Cargando el mapa…</div>}>
            <MapaLeaflet
              centro={centro}
              pines={pines}
              yo={yo}
              nuevo={nueva}
              seleccionada={seleccionada}
              onSeleccionar={setSeleccionada}
              onTocarMapa={modoToque ? (p) => { setNueva(p); setModoToque(false) } : undefined}
              onSinTeselas={() => setSinTeselas(true)}
            />
          </Suspense>
        </LimiteMapa>
        {sinTeselas && <p className="text-xs text-stone-600">El dibujo del mapa no se pudo bajar (¿sin señal?). Las sedes, las distancias y los enlaces de abajo funcionan igual.</p>}
      </div>

      {/* Una sola zona de avisos, siempre presente: así los lectores de pantalla anuncian lo que aparece en ella. */}
      <div role="status" className={mensaje || modoToque ? 'space-y-2' : 'sr-only'}>
        {modoToque && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
            <span>Toca en el mapa el lugar donde está la tienda. Acércalo antes para marcarlo mejor.</span>
            <Boton variante="fantasma" onClick={() => setModoToque(false)}>Cancelar</Boton>
          </div>
        )}
        {mensaje && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{mensaje}</p>}
      </div>

      {elegida && (
        <Tarjeta className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <NombreTienda tienda={elegida.tienda} className="font-semibold" />
              <p className="text-sm text-stone-600">{elegida.nombre}</p>
              {filaDe.get(elegida.tienda)?.total != null && (
                <p className="text-sm">
                  Tu lista aquí: <strong>{pesos(filaDe.get(elegida.tienda)!.total!)}</strong>
                  {!completa(filaDe.get(elegida.tienda)) && <span className="text-stone-600"> (solo {filaDe.get(elegida.tienda)!.items} de {filaDe.get(elegida.tienda)!.de} productos)</span>}
                </p>
              )}
            </div>
            <Boton variante="fantasma" aria-label="Cerrar" onClick={() => setSeleccionada(null)}>×</Boton>
          </div>
          <div className="flex flex-wrap gap-2">
            <Enlace href={enlaceGoogleMaps([elegida])!}>Ir en Google Maps</Enlace>
            <Enlace href={enlaceWaze(elegida)} secundario>Waze</Enlace>
          </div>
        </Tarjeta>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Boton variante="secundario" disabled={ocupado !== ''} onClick={() => void ubicar(false)}>{ocupado === 'gps' ? 'Buscando…' : yo ? 'Actualizar mi ubicación' : 'Mi ubicación'}</Boton>
        <Boton variante="secundario" disabled={ocupado !== ''} onClick={() => void buscarCerca()}>{ocupado === 'osm' ? 'Buscando tiendas…' : 'Buscar sedes cerca'}</Boton>
        <Boton variante="secundario" disabled={ocupado !== ''} onClick={() => void agregarAqui()}>{ocupado === 'aqui' ? 'Ubicando…' : 'Estoy en una tienda'}</Boton>
        <Boton variante="secundario" disabled={modoToque || ocupado !== ''} onClick={() => setModoToque(true)}>Marcar en el mapa</Boton>
      </div>

      {!hayLista ? (
        <Tarjeta className="text-sm">
          <p className="font-medium">Todavía no hay una lista para comparar.</p>
          <p className="text-stone-600">Arma tu compra en <a className="text-marca underline" href="#/plan">Plan</a> y aquí verás cuánto cuesta en cada tienda y cuál te queda mejor.</p>
        </Tarjeta>
      ) : (
        <>
          {hoy && (
            <Tarjeta className="space-y-2">
              <h2 className="font-semibold">Tu ruta de hoy</h2>
              {ruta && ruta.paradas.length > 0 ? (
                <>
                  <ol className="space-y-1 text-sm">
                    {ruta.paradas.map((p, i) => {
                      const grupo = hoy.grupos.find((g) => g.tienda === p.sede.tienda)
                      return (
                        <li key={p.sede.id} className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0"><strong>{i + 1}.</strong> {INFO_TIENDAS[p.sede.tienda].nombre} <span className="text-stone-600">· {p.sede.nombre}</span></span>
                          <span className="shrink-0 text-right text-stone-600">
                            {grupo && <span className="font-medium text-tinta">{pesos(grupo.total)}</span>}
                            {(yo || i > 0) && <span className="block text-xs">{i === 0 ? '' : '+'}{formatoKm(p.km)}</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                  {hoy.ahorro != null && hoy.mejorUnica && (
                    <p className={`text-sm font-medium ${hoy.ahorro > 0 ? 'text-ok' : 'text-stone-700'}`}>
                      {hoy.ahorro > 0
                        ? `Ahorras ${pesos(hoy.ahorro)} frente a comprar todo en ${INFO_TIENDAS[hoy.mejorUnica.tienda].nombre}`
                        : `Lo más conveniente: todo en ${INFO_TIENDAS[hoy.mejorUnica.tienda].nombre}`}
                    </p>
                  )}
                  <p className="text-xs text-stone-600">
                    {ruta.paradas.length > 1 ? `Recorrido aproximado: ${formatoKm(ruta.totalKm)}. ` : ''}Son distancias estimadas, no de una ruta real.
                    {!yo && ' Pulsa «Mi ubicación» para ordenar las paradas desde donde estás.'} Al abrir la ruta, Google Maps parte de donde estés.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {enlaceRuta && <Enlace href={enlaceRuta}>Abrir ruta en Google Maps</Enlace>}
                    <Boton variante="secundario" onClick={compartir}>Compartir ruta</Boton>
                  </div>
                </>
              ) : hoy.tiendas.length === 0 ? (
                <p className="text-sm text-stone-600">Todavía no hay precios vigentes de tu lista en las tiendas de hoy, así que no hay plan que recorrer. Anota o actualiza precios en <a className="text-marca underline" href="#/plan">Plan</a>.</p>
              ) : (
                <p className="text-sm text-stone-600">Todavía no hay sedes guardadas de las tiendas del plan. Usa «Buscar sedes cerca» o «Marcar en el mapa».</p>
              )}
              {ruta && ruta.sinSede.length > 0 && ruta.paradas.length > 0 && (
                <p className="text-sm text-amber-900">Falta la sede de {ruta.sinSede.map((t) => INFO_TIENDAS[t].nombre).join(', ')}: agrégala para incluirla en la ruta.</p>
              )}
            </Tarjeta>
          )}

          <h2 className="pt-1 font-semibold">Tu lista en cada tienda</h2>
          <ul className="space-y-2">
            {filas.map((f) => {
              const propias = sedes.filter((s) => s.tienda === f.tienda)
              const cercana = yo ? sedeMasCercana(yo, sedes, f.tienda) : null
              const destino = cercana?.sede ?? propias[0]
              return (
                <li key={f.tienda}>
                  <Tarjeta className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <NombreTienda tienda={f.tienda} className="font-semibold" />
                      {f.tienda === masBarata && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Más barata con todo</span>}
                      {enPlan.has(f.tienda) && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-900">En tu plan de hoy</span>}
                    </div>
                    <p className="text-sm">
                      {f.total == null
                        ? <span className="text-stone-600">Sin precios de tu lista todavía</span>
                        : completa(f)
                          ? <>Toda tu lista: <strong>{pesos(f.total)}</strong></>
                          : <>Tiene {f.items} de {f.de} productos: <strong>{pesos(f.total)}</strong> <span className="text-stone-600">(solo lo que tiene)</span></>}
                    </p>
                    {destino ? (
                      <>
                        <p className="text-xs text-stone-600">
                          {cercana ? `Más cercana: ${cercana.sede.nombre} · ${formatoKm(cercana.km)}` : `Sede: ${destino.nombre}`}
                          {!cercana && propias.length > 1 && ` · tienes ${propias.length} sedes; pulsa «Mi ubicación» para ir a la más cercana`}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          <Enlace href={enlaceGoogleMaps([destino])!} secundario etiqueta={`Ir a ${INFO_TIENDAS[f.tienda].nombre}: ${destino.nombre}`}>Ir</Enlace>
                          <Enlace href={enlaceWaze(destino)} secundario etiqueta={`Waze a ${INFO_TIENDAS[f.tienda].nombre}: ${destino.nombre}`}>Waze</Enlace>
                          <Boton variante="fantasma" onClick={() => verEnElMapa(destino.id)}>Ver en el mapa</Boton>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-stone-600">Sin sede guardada.</p>
                    )}
                  </Tarjeta>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {sedes.length > 0 ? (
        <details className="rounded-2xl bg-white p-3 text-sm ring-1 ring-stone-200">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Mis sedes ({sedes.length})</summary>
          <ul className="divide-y divide-stone-100">
            {sedes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0"><NombreTienda tienda={s.tienda} tam={18} /> <span className="text-stone-600">· {s.nombre}</span></span>
                <Boton variante="fantasma" className="shrink-0 text-peligro" aria-label={`Quitar ${INFO_TIENDAS[s.tienda].nombre} ${s.nombre}`} onClick={() => void quitar(s)}>Quitar</Boton>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <Tarjeta className="text-sm">
          <p className="font-medium">Aún no hay sedes guardadas.</p>
          <p className="text-stone-600">Pulsa «Buscar sedes cerca» para traerlas de OpenStreetMap, o «Estoy en una tienda» cuando estés en una. Se guardan en tu cuenta y aparecen en todos tus dispositivos.</p>
        </Tarjeta>
      )}

      <p className="text-xs text-stone-600">
        Mapa © colaboradores de OpenStreetMap: al ver el mapa, tu navegador pide el dibujo a sus servidores. «Buscar sedes cerca» envía a overpass-api.de (o a un servidor de respaldo) un punto aproximado (a ~1 km) de la zona.
        Tu ubicación de ahora no se guarda; solo se guarda el lugar de una sede cuando tú la agregas.
      </p>

      <GuardarSede
        punto={nueva}
        onCerrar={() => setNueva(null)}
        onGuardada={(s) => { setNueva(null); verEnElMapa(s.id) }}
        onLleno={() => { setNueva(null); setMensaje(`Llegaste al máximo de ${MAX_SEDES} sedes. Quita alguna para agregar otra.`) }}
      />
    </section>
  )
}

/** Con una ubicación de GPS más imprecisa que esto, se avisa antes de guardar. */
const PRECISION_AVISO_M = 100

function GuardarSede({ punto, onCerrar, onGuardada, onLleno }: { punto: Ubicacion | null; onCerrar: () => void; onGuardada: (s: Sede) => void; onLleno: () => void }) {
  const [tienda, setTienda] = useState<Tienda | null>(null)
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const limpiar = () => { setTienda(null); setNombre('') }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!punto || !tienda || guardando) return
    setGuardando(true)
    try {
      const sede = await agregarSede(tienda, punto, nombre)
      limpiar()
      if (sede) {
        avisar('Sede guardada.')
        onGuardada(sede)
      } else onLleno()
    } finally {
      setGuardando(false)
    }
  }

  const impreciso = punto?.precision != null && punto.precision > PRECISION_AVISO_M

  return (
    // protegida: un toque afuera no debe cerrarla y perder el punto y lo escrito.
    <Hoja abierta={!!punto} titulo="¿Qué tienda es?" protegida onCerrar={() => { limpiar(); onCerrar() }}>
      <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tienda">
          {TIENDAS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tienda === t}
              onClick={() => setTienda(t)}
              className={`min-h-11 rounded-full border px-3 py-2 text-sm ${tienda === t ? 'border-marca bg-marca-suave font-medium text-teal-900' : 'border-stone-300 bg-white text-stone-600'}`}
            >
              {INFO_TIENDAS[t].nombre}
            </button>
          ))}
        </div>
        <Campo etiqueta="Nombre o barrio (opcional)" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Por ejemplo: Calle 15" />
        {impreciso && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">La ubicación es poco precisa (±{Math.round(punto!.precision!)} m). Si la tienda queda lejos de aquí, mejor cancela y márcala en el mapa.</p>}
        <p className="text-xs text-stone-600">Se guarda este punto en tu cuenta, en todos tus dispositivos. Si no estás en la tienda, cancela y márcala en el mapa.</p>
        <Boton type="submit" className="w-full" disabled={!tienda || guardando}>{guardando ? 'Guardando…' : 'Guardar sede'}</Boton>
        <Boton variante="secundario" className="w-full" onClick={() => { limpiar(); onCerrar() }}>Cancelar</Boton>
      </form>
    </Hoja>
  )
}
