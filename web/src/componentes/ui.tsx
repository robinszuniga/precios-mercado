import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { formatoCop } from '@shared/dinero.ts'
import type { Distintivo as TipoDistintivo } from '@shared/precioEfectivo.ts'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'

export const pesos = formatoCop

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma'

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-marca text-white active:bg-teal-800 disabled:bg-stone-300',
  secundario: 'bg-white text-tinta border border-stone-300 active:bg-stone-100 disabled:text-stone-400',
  peligro: 'bg-white text-peligro border border-red-200 active:bg-red-50',
  fantasma: 'text-marca active:bg-marca-suave',
}

export function Boton({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <button type="button" className={`rounded-xl px-4 py-2.5 font-medium transition-colors ${VARIANTES[variante]} ${className}`} {...p} />
}

export function Campo({ etiqueta, ayuda, className = '', ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-600">{etiqueta}</label>
      <input id={id} aria-describedby={ayuda ? `${id}-ayuda` : undefined} className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-marca" {...p} />
      {ayuda && <span id={`${id}-ayuda`} className="mt-1 block text-xs text-stone-500">{ayuda}</span>}
    </div>
  )
}

export function Selector({ etiqueta, children, className = '', ...p }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-600">{etiqueta}</label>
      <select id={id} className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-marca" {...p}>
        {children}
      </select>
    </div>
  )
}

export function Casilla({ etiqueta, checked, onChange }: { etiqueta: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 py-1">
      <input type="checkbox" className="size-5 accent-marca" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  )
}

/** Hoja que sube desde abajo, cómoda con una mano. */
export function Hoja({ abierta, titulo, onCerrar, children }: { abierta: boolean; titulo: string; onCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!abierta) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [abierta, onCerrar])
  if (!abierta) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onCerrar}>
      <div
        role="dialog"
        aria-label={titulo}
        className="abajo-seguro max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-fondo p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button type="button" aria-label="Cerrar" className="rounded-full px-3 py-1 text-2xl leading-none text-stone-500" onClick={onCerrar}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200 ${className}`}>{children}</div>
}

export function Titulo({ children, accion }: { children: ReactNode; accion?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h1 className="text-xl font-bold">{children}</h1>
      {accion}
    </div>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-stone-500">{children}</p>
}

const PUNTO_TIENDA: Record<Tienda, string> = {
  EXITO: 'bg-exito',
  OLIMPICA: 'bg-olimpica',
  D1: 'bg-d1',
  ARA: 'bg-ara',
}

export function NombreTienda({ tienda, className = '' }: { tienda: Tienda; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`size-2.5 rounded-full ${PUNTO_TIENDA[tienda]}`} />
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
      className={`rounded-full border px-3 py-1.5 text-sm ${activo ? 'border-marca bg-marca-suave text-teal-900' : 'border-stone-300 bg-white text-stone-500'}`}
    >
      <NombreTienda tienda={tienda} />
    </button>
  )
}

const TEXTO_DISTINTIVO: Record<TipoDistintivo, string> = {
  tienda: 'en tienda',
  online: 'online',
  online_nac: 'online·nac',
}

export function Distintivo({ tipo, amarillo }: { tipo: TipoDistintivo; amarillo?: boolean }) {
  const color = amarillo
    ? 'bg-yellow-100 text-yellow-800'
    : tipo === 'tienda'
      ? 'bg-green-100 text-green-800'
      : tipo === 'online'
        ? 'bg-sky-100 text-sky-800'
        : 'bg-stone-200 text-stone-700'
  const titulo = tipo === 'online_nac' ? 'Precio online nacional: la tienda no publica precio para Riohacha' : undefined
  return <span title={titulo} className={`rounded-md px-1.5 py-0.5 text-xs ${color}`}>{TEXTO_DISTINTIVO[tipo]}</span>
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
