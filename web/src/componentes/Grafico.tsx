import { useEffect, useRef } from 'react'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { formatoCop } from '@shared/dinero.ts'

export interface Serie {
  tienda: Tienda
  puntos: { t: number; v: number }[]
}

const COLORES: Record<Tienda, string> = { EXITO: '#ca8a04', OLIMPICA: '#dc2626', D1: '#1d4ed8', ARA: '#ea580c' }

/** Línea escalonada por tienda. uPlot se carga solo al abrir el histórico (~22 KB). */
export function Grafico({ series, etiqueta }: { series: Serie[]; etiqueta: string }) {
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
          scales: { x: { time: true } },
          axes: [{}, { values: (_u: unknown, vs: number[]) => vs.map((v) => formatoCop(v)), size: 70 }],
          series: [
            {},
            ...series.map((s) => ({
              label: INFO_TIENDAS[s.tienda].nombre,
              stroke: COLORES[s.tienda],
              width: 2,
              spanGaps: true,
              paths: uPlot.paths.stepped!({ align: 1 }),
              value: (_u: unknown, v: number | null) => (v == null ? '—' : `${formatoCop(v)} ${etiqueta}`),
            })),
          ],
        },
        datos as uPlot.AlignedData,
        caja.current,
      )
      destruir = () => grafico.destroy()
    })()
    return () => { vivo = false; destruir() }
  }, [series, etiqueta])
  return <div ref={caja} className="w-full overflow-hidden" />
}
