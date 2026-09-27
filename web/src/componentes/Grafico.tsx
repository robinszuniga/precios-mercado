import { useEffect, useRef } from 'react'
import type { Tienda } from '@shared/tiendas.ts'
import { formatoCop } from '@shared/dinero.ts'

export interface Serie {
  tienda: Tienda
  puntos: { t: number; v: number }[]
}

/** Mismos colores que en toda la app. D1 punteado para que no se confunda con Olímpica (las dos son rojas). */
export const ESTILO_SERIE: Record<Tienda, { color: string; guiones?: number[] }> = {
  EXITO: { color: '#a16207' },
  OLIMPICA: { color: '#be123c' },
  D1: { color: '#7f1d1d', guiones: [6, 4] },
  ARA: { color: '#c2410c', guiones: [2, 3] },
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function fechaCorta(ms: number): string {
  const d = new Date(ms - 5 * 3600000) // hora de Bogotá
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

/** Muestra de línea para la lista que acompaña al gráfico. */
export function MuestraLinea({ tienda }: { tienda: Tienda }) {
  const e = ESTILO_SERIE[tienda]
  return (
    <svg aria-hidden width="22" height="8" className="shrink-0">
      <line x1="1" y1="4" x2="21" y2="4" stroke={e.color} strokeWidth="3" strokeDasharray={e.guiones?.join(' ')} strokeLinecap="round" />
    </svg>
  )
}

/** Línea escalonada por tienda. uPlot se carga solo al abrir el historial (~22 KB). */
export function Grafico({ series }: { series: Serie[] }) {
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!caja.current || !series.length) return
    let destruir = () => {}
    let vivo = true
    void (async () => {
      const [{ default: uPlot }] = await Promise.all([import('uplot'), import('uplot/dist/uPlot.min.css')])
      if (!vivo || !caja.current) return
      const tiempos = [...new Set(series.flatMap((s) => s.puntos.map((p) => p.t)))].sort((a, b) => a - b)
      const datos: (number | null)[][] = [tiempos.map((t) => t / 1000)]
      for (const s of series) {
        const m = new Map(s.puntos.map((p) => [p.t, p.v]))
        datos.push(tiempos.map((t) => m.get(t) ?? null))
      }
      const grafico = new uPlot(
        {
          width: caja.current.clientWidth,
          height: 220,
          legend: { show: false },
          cursor: { points: { size: 8 } },
          scales: { x: { time: true } },
          axes: [
            { values: (_u: unknown, vs: number[]) => vs.map((v) => fechaCorta(v * 1000)), stroke: '#44403c' },
            { values: (_u: unknown, vs: number[]) => vs.map((v) => formatoCop(v)), size: 76, stroke: '#44403c' },
          ],
          series: [
            {},
            ...series.map((s) => ({
              label: s.tienda,
              stroke: ESTILO_SERIE[s.tienda].color,
              dash: ESTILO_SERIE[s.tienda].guiones,
              width: 2.5,
              spanGaps: true,
              points: { show: false },
              paths: uPlot.paths.stepped!({ align: 1 }),
            })),
          ],
        },
        datos as uPlot.AlignedData,
        caja.current,
      )
      destruir = () => grafico.destroy()
    })()
    return () => { vivo = false; destruir() }
  }, [series])
  return <div ref={caja} className="w-full overflow-hidden" aria-hidden />
}
