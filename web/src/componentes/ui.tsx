import { useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { formatoCop } from '@shared/dinero.ts'
import type { Distintivo as TipoDistintivo } from '@shared/precioEfectivo.ts'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'

export const pesos = formatoCop

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma'

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-marca text-white active:bg-teal-800 disabled:bg-stone-200 disabled:text-stone-600',
  secundario: 'bg-white text-tinta border border-stone-300 active:bg-stone-100 disabled:bg-stone-100 disabled:text-stone-500',
  peligro: 'bg-white text-peligro border border-red-200 active:bg-red-50',
  fantasma: 'text-marca active:bg-marca-suave disabled:text-stone-500',
}

export function Boton({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <button type="button" className={`min-h-11 rounded-xl px-4 py-2.5 font-medium transition-colors ${VARIANTES[variante]} ${className}`} {...p} />
}

/** Botón de solo ícono: siempre 44 × 44 px, lo mínimo para el pulgar. */
export function BotonIcono({ etiqueta, className = '', children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { etiqueta: string }) {
  return (
    <button type="button" aria-label={etiqueta} title={etiqueta} className={`grid size-11 shrink-0 place-items-center rounded-full active:bg-stone-200 ${className}`} {...p}>
      {children}
    </button>
  )
}

const CLASE_CAMPO = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-marca focus:ring-2 focus:ring-marca/30'

export function Campo({ etiqueta, ayuda, aviso, className = '', ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: ReactNode; aviso?: ReactNode }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-700">{etiqueta}</label>
      <input id={id} aria-describedby={ayuda || aviso ? `${id}-ayuda` : undefined} className={CLASE_CAMPO} {...p} />
      {(ayuda || aviso) && (
        <span id={`${id}-ayuda`} className={`mt-1 block text-xs ${aviso ? 'font-medium text-alerta' : 'text-stone-600'}`}>{aviso ?? ayuda}</span>
      )}
    </div>
  )
}

export function Selector({ etiqueta, children, className = '', ...p }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-700">{etiqueta}</label>
      <select id={id} className={CLASE_CAMPO} {...p}>
        {children}
      </select>
    </div>
  )
}

export function Casilla({ etiqueta, checked, onChange }: { etiqueta: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input type="checkbox" className="size-5 accent-marca" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  )
}

/** − 5 kg + : para ajustar cantidades con el pulgar. */
export function Pasos({ valor, paso, minimo = 0, etiqueta, sufijo, onCambio }: {
  valor: number; paso: number; minimo?: number; etiqueta: string; sufijo?: string; onCambio: (v: number) => void
}) {
  const redondear = (v: number) => Math.round(v * 1000) / 1000
  return (
    <div className="flex items-center gap-1" role="group" aria-label={etiqueta}>
      <BotonIcono etiqueta={`Menos ${etiqueta}`} className="border border-stone-300 bg-white text-xl" onClick={() => onCambio(Math.max(minimo, redondear(valor - paso)))} disabled={valor <= minimo}>−</BotonIcono>
      <span className="min-w-20 text-center font-semibold" aria-live="polite">{String(valor).replace('.', ',')}{sufijo ? ` ${sufijo}` : ''}</span>
      <BotonIcono etiqueta={`Más ${etiqueta}`} className="border border-stone-300 bg-white text-xl" onClick={() => onCambio(redondear(valor + paso))}>+</BotonIcono>
    </div>
  )
}

let contadorHojas = 0

/**
 * Hoja que sube desde abajo, cómoda con una mano. El botón Atrás de Android la cierra (en vez de salir de la
 * pantalla). Con `protegida`, tocar afuera no la cierra (para no perder lo escrito).
 */
export function Hoja({ abierta, titulo, onCerrar, children, protegida = false }: {
  abierta: boolean; titulo: string; onCerrar: () => void; children: ReactNode; protegida?: boolean
}) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  const cerrarRef = useRef(onCerrar)
  cerrarRef.current = onCerrar

  useEffect(() => {
    if (!abierta) return
    const id = ++contadorHojas
    const previo = document.activeElement as HTMLElement | null
    history.pushState({ ...(history.state ?? {}), hoja: id }, '')
    const atras = () => { if (history.state?.hoja !== id) cerrarRef.current() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarRef.current() }
    window.addEventListener('popstate', atras)
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    const primero = caja.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button:not([data-cerrar])')
    primero?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('popstate', atras)
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
      if (history.state?.hoja === id) history.back()
      previo?.focus?.({ preventScroll: true })
    }
  }, [abierta])

  if (!abierta) return null
  return (
    <div className="fixed inset-0 z-40 flex animate-aparecer items-end justify-center bg-black/40 motion-reduce:animate-none" onClick={() => { if (!protegida) onCerrar() }}>
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="abajo-seguro max-h-[90dvh] w-full max-w-lg animate-subir overflow-y-auto rounded-t-3xl bg-fondo px-4 pt-2 motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-stone-300" />
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={idTitulo} className="text-lg font-semibold">{titulo}</h2>
          <BotonIcono etiqueta="Cerrar" data-cerrar className="text-2xl text-stone-600" onClick={onCerrar}>×</BotonIcono>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200 ${className}`}>{children}</div>
}

export function Titulo({ children, accion, sub }: { children: ReactNode; accion?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-xl font-bold">{children}</h1>
        {sub && <p className="text-sm text-stone-600">{sub}</p>}
      </div>
      {accion}
    </div>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-stone-600">{children}</div>
}

/** Mientras se abre la base local: bloques grises en vez de pantalla en blanco. */
export function Cargando() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-200 motion-reduce:animate-none" />)}
    </div>
  )
}

export function ErrorTexto({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-sm font-medium text-peligro">{children}</p>
}

// ---------- Tiendas: logo con la letra de respaldo ----------

/**
 * Ícono de cada tienda, tal como lo publica su propia página (no se copia al repo). El service worker lo guarda
 * para verlo sin señal; si no carga, se muestra la letra.
 */
export const LOGO_TIENDA: Record<Tienda, string> = {
  EXITO: 'https://www.exito.com/arquivos/favicon.ico',
  OLIMPICA: 'https://www.olimpica.com/arquivos/olimpica-favicon1.png',
  D1: 'https://d1tiendas.vteximg.com.br/arquivos/d1tiendas-favicon.ico',
  ARA: 'https://sitemedia.aratiendas.com/wp-content/uploads/2021/03/cropped-icon-192x192.png',
}

const MONOGRAMA: Record<Tienda, { letra: string; clase: string }> = {
  EXITO: { letra: 'É', clase: 'bg-exito text-tinta' },
  OLIMPICA: { letra: 'O', clase: 'bg-olimpica text-white' },
  D1: { letra: 'D1', clase: 'bg-d1 text-white' },
  ARA: { letra: 'A', clase: 'bg-ara text-white' },
}

const logosQueFallaron = new Set<Tienda>()

export function LogoTienda({ tienda, tam = 20 }: { tienda: Tienda; tam?: number }) {
  const [fallo, setFallo] = useState(() => logosQueFallaron.has(tienda))
  const m = MONOGRAMA[tienda]
  if (fallo) {
    return (
      <span
        aria-hidden
        style={{ width: tam, height: tam, fontSize: m.letra.length > 1 ? tam * 0.42 : tam * 0.58 }}
        className={`inline-grid shrink-0 place-items-center rounded-full font-bold leading-none ${m.clase}`}
      >
        {m.letra}
      </span>
    )
  }
  return (
    <img
      src={LOGO_TIENDA[tienda]}
      alt=""
      aria-hidden
      width={tam}
      height={tam}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="inline-block shrink-0 rounded-md bg-white object-contain ring-1 ring-stone-200"
      style={{ width: tam, height: tam }}
      onError={() => { logosQueFallaron.add(tienda); setFallo(true) }}
    />
  )
}

export function NombreTienda({ tienda, className = '', tam }: { tienda: Tienda; className?: string; tam?: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <LogoTienda tienda={tienda} tam={tam} />
      {INFO_TIENDAS[tienda].nombre}
    </span>
  )
}

export function ChipTienda({ tienda, activo, onClick }: { tienda: Tienda; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-3 py-2 text-sm ${activo ? 'border-marca bg-marca-suave font-medium text-teal-900' : 'border-stone-300 bg-white text-stone-600'}`}
    >
      <NombreTienda tienda={tienda} />
      {activo && <span className="sr-only"> (seleccionada)</span>}
    </button>
  )
}

// ---------- Distintivo de confianza del precio ----------

const TEXTO_DISTINTIVO: Record<TipoDistintivo, string> = {
  tienda: 'en tienda',
  online: 'online Riohacha',
  online_nac: 'precio nacional',
}

/** El texto lleva toda la información (no solo el color): "en tienda · 45 d" cuando el precio es viejo. */
export function Distintivo({ tipo, amarillo, dias }: { tipo: TipoDistintivo; amarillo?: boolean; dias?: number }) {
  const color = amarillo
    ? 'bg-yellow-100 text-yellow-900'
    : tipo === 'tienda'
      ? 'bg-green-100 text-green-800'
      : tipo === 'online'
        ? 'bg-sky-100 text-sky-800'
        : 'bg-stone-200 text-stone-700'
  const texto = amarillo && dias != null ? `${TEXTO_DISTINTIVO[tipo]} · ${dias} d` : TEXTO_DISTINTIVO[tipo]
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs ${color}`}>{texto}</span>
}

export function LeyendaDistintivos() {
  return (
    <details className="text-sm text-stone-700">
      <summary className="min-h-11 cursor-pointer py-2 text-marca">¿Qué significan las etiquetas?</summary>
      <ul className="space-y-1.5 pb-2">
        <li><Distintivo tipo="tienda" /> lo anotaste o pagaste tú en la tienda. Es el que manda.</li>
        <li><Distintivo tipo="online" /> precio de la tienda online para Riohacha.</li>
        <li><Distintivo tipo="online_nac" /> la tienda online no atiende Riohacha: es el precio nacional (Bogotá). Puede no ser el de la góndola.</li>
        <li><Distintivo tipo="tienda" amarillo dias={45} /> precio de tienda de hace más de un mes: confírmalo.</li>
      </ul>
    </details>
  )
}

// ---------- Avisos (confirmación de acciones, con Deshacer) ----------

interface Aviso {
  id: number
  texto: string
  deshacer?: () => void | Promise<void>
}

let avisos: Aviso[] = []
const oyentes = new Set<() => void>()
let siguiente = 1
const emitir = () => oyentes.forEach((f) => f())

export function avisar(texto: string, deshacer?: () => void | Promise<void>) {
  const aviso = { id: siguiente++, texto, deshacer }
  avisos = [...avisos.slice(-1), aviso]
  emitir()
  setTimeout(() => { avisos = avisos.filter((a) => a.id !== aviso.id); emitir() }, deshacer ? 6000 : 3000)
}

export function Avisos() {
  const lista = useSyncExternalStore((f) => { oyentes.add(f); return () => oyentes.delete(f) }, () => avisos)
  return (
    <div className="pointer-events-none fixed inset-x-0 z-50 mx-auto flex max-w-lg flex-col gap-2 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.75rem)' }} role="status" aria-live="polite">
      {lista.map((a) => (
        <div key={a.id} className="pointer-events-auto flex animate-subir items-center justify-between gap-3 rounded-xl bg-tinta px-4 py-2 text-sm text-white shadow-lg motion-reduce:animate-none">
          <span>{a.texto}</span>
          {a.deshacer && (
            <button
              type="button"
              className="min-h-11 shrink-0 px-2 font-semibold text-teal-300"
              onClick={async () => { avisos = avisos.filter((x) => x.id !== a.id); emitir(); await a.deshacer!() }}
            >
              Deshacer
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function hace(dias: number): string {
  return dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} d`
}

/** Número desde un input: acepta "4.500", "4500" y "1,5". */
export function leerNumero(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const n = Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
