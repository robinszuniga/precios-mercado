import type { EstadoPresupuesto } from '@shared/presupuesto.ts'
import { pesos } from './ui.tsx'

const BARRA = { verde: 'bg-ok', amarillo: 'bg-alerta', rojo: 'bg-peligro' } as const
const TEXTO = { verde: 'text-ok', amarillo: 'text-alerta', rojo: 'text-peligro' } as const

function frase(e: EstadoPresupuesto): string | null {
  if (e.alTerminar == null) return null
  if (e.motivo === 'pasado') return `Te pasaste ${pesos(-e.restante!)} del presupuesto`
  if (e.proyectado <= e.gastado) return null
  return e.alTerminar >= 0
    ? `Con lo que falta te sobrarían ≈ ${pesos(e.alTerminar)}`
    : `⚠ Con lo que falta te pasarías ≈ ${pesos(-e.alTerminar)}`
}

/** Lo que se mira en el pasillo es cuánto queda: eso va grande. Tocarla permite cambiar el presupuesto. */
export function BarraPresupuesto({ estado, onEditar, compacta = false }: { estado: EstadoPresupuesto; onEditar?: () => void; compacta?: boolean }) {
  const { gastado, presupuesto, restante, proporcion, color } = estado
  const Contenedor = onEditar ? 'button' : 'div'
  const base = 'block w-full rounded-2xl bg-white p-3 text-left ring-1 ring-stone-200'
  if (presupuesto == null) {
    return (
      <Contenedor type={onEditar ? 'button' : undefined} onClick={onEditar} className={base}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-stone-600">Llevas</span>
          <span className="text-2xl font-bold">{pesos(gastado)}</span>
        </div>
        {onEditar && <span className="text-sm text-marca">Poner presupuesto</span>}
      </Contenedor>
    )
  }
  const pct = Math.round((proporcion ?? 0) * 100)
  const pctProyectado = Math.min(100, Math.round((estado.proporcionProyectada ?? 0) * 100))
  const f = frase(estado)
  return (
    <Contenedor type={onEditar ? 'button' : undefined} onClick={onEditar} className={base} data-color={color} aria-label={onEditar ? 'Presupuesto: toca para cambiarlo' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-stone-700">{restante! < 0 ? 'Te pasaste' : 'Te quedan'}</span>
        <span className={`${compacta ? 'text-2xl' : 'text-3xl'} font-bold ${TEXTO[color!]}`}>{pesos(Math.abs(restante!))}</span>
      </div>
      <div
        className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-label="Presupuesto usado"
        aria-valuenow={Math.min(100, pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct} % usado`}
      >
        {/* Lo que falta comprar, en claro: se ve venir antes de que pase. */}
        <div className={`absolute inset-y-0 left-0 rounded-full opacity-30 ${BARRA[estado.alTerminar != null && estado.alTerminar < 0 ? 'amarillo' : color!]}`} style={{ width: `${pctProyectado}%` }} />
        <div className={`absolute inset-y-0 left-0 rounded-full transition-[width] motion-reduce:transition-none ${BARRA[color!]}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-sm text-stone-700">
        <span>Llevas {pesos(gastado)} de {pesos(presupuesto)} · {pct} %</span>
        {onEditar && <span className="text-marca">Cambiar</span>}
      </div>
      {f && <p className={`mt-1 text-sm font-medium ${estado.motivo === 'ok' ? 'text-stone-700' : TEXTO[color!]}`}>{f}</p>}
      <p className="sr-only" aria-live="polite">{restante! < 0 ? `Te pasaste ${pesos(-restante!)}` : `Te quedan ${pesos(restante!)}`}</p>
    </Contenedor>
  )
}
