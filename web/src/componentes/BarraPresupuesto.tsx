import type { EstadoPresupuesto } from '@shared/presupuesto.ts'
import { pesos } from './ui.tsx'

const COLOR = { verde: 'bg-ok', amarillo: 'bg-alerta', rojo: 'bg-peligro' } as const

export function BarraPresupuesto({ estado }: { estado: EstadoPresupuesto }) {
  const { gastado, presupuesto, restante, proporcion, color, proyectado } = estado
  if (presupuesto == null) {
    return (
      <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
        <div className="text-sm text-stone-500">Gastado</div>
        <div className="text-2xl font-bold">{pesos(gastado)}</div>
      </div>
    )
  }
  const ancho = Math.min(100, Math.round((proporcion ?? 0) * 100))
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-color={color}>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm text-stone-500">Gastado</div>
          <div className="text-2xl font-bold">{pesos(gastado)}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-stone-500">{restante! < 0 ? 'Te pasaste' : 'Te quedan'}</div>
          <div className={`text-lg font-semibold ${restante! < 0 ? 'text-peligro' : ''}`}>{pesos(Math.abs(restante!))}</div>
        </div>
      </div>
      <div
        className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-label="Presupuesto usado"
        aria-valuenow={Math.round((proporcion ?? 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full transition-all ${COLOR[color!]}`} style={{ width: `${ancho}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-stone-500">
        <span>de {pesos(presupuesto)}</span>
        {proyectado > gastado && <span>con lo que falta ≈ {pesos(proyectado)}</span>}
      </div>
    </div>
  )
}
