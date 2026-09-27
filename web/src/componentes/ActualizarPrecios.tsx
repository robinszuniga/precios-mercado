import { useEffect, useRef, useState } from 'react'
import { llamar } from '../datos/api.ts'
import { useMeta } from '../datos/consultas.ts'
import { conexion, sincronizar } from '../datos/sync.ts'
import { Boton } from './ui.tsx'

interface JobPublico {
  id: string
  estado: 'en_cola' | 'corriendo' | 'terminado' | 'error'
  total: number
  hechos: number
  actualizados: number
  errores: string[]
}

/** Dispara la actualización en el servidor (tarda: corre en segundo plano) y consulta el avance cada 5 s. */
export function ActualizarPrecios() {
  const c = useMeta<{ url: string; token: string }>('conexion', { url: '', token: '' })
  const [job, setJob] = useState<JobPublico | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const temporizador = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (temporizador.current) clearInterval(temporizador.current) }, [])

  function seguir() {
    if (temporizador.current) clearInterval(temporizador.current)
    temporizador.current = setInterval(async () => {
      const r = await llamar<{ job: JobPublico | null }>(await conexion(), 'estadoJob')
      if (r.tipo !== 'ok' || !r.data.job) return
      setJob(r.data.job)
      if (r.data.job.estado === 'terminado' || r.data.job.estado === 'error') {
        clearInterval(temporizador.current!)
        temporizador.current = null
        setOcupado(false)
        setMensaje(r.data.job.estado === 'terminado'
          ? `Listo: ${r.data.job.actualizados} precios cambiaron${r.data.job.errores.length ? `, ${r.data.job.errores.length} con problemas (ver Ajustes)` : ''}.`
          : 'La actualización falló. Revisa el diagnóstico en Ajustes.')
        void sincronizar()
      }
    }, 5000)
  }

  async function iniciar() {
    setOcupado(true)
    setMensaje('')
    const r = await llamar<{ job: JobPublico }>(await conexion(), 'actualizarPrecios')
    if (r.tipo === 'ok') {
      setJob(r.data.job)
      seguir()
      return
    }
    setOcupado(false)
    if (r.tipo === 'error' && r.codigo === 'rate_limit') {
      setMensaje('Los precios se actualizaron hace muy poco.')
      void sincronizar()
    } else setMensaje(r.tipo === 'error' ? r.mensaje : 'Sin señal: los precios online se actualizan cuando haya conexión.')
  }

  const avance = job && job.total ? Math.round((job.hechos / job.total) * 100) : 0
  if (!c.url || !c.token) {
    return (
      <a href="#/ajustes" className="block min-h-11 rounded-xl border border-dashed border-stone-300 px-3 py-2.5 text-sm text-stone-700">
        Para traer precios de Éxito y Olímpica, conecta la copia en Google <span className="text-marca">→ Ajustes</span>
      </a>
    )
  }
  return (
    <div className="space-y-1">
      <Boton variante="secundario" className="w-full" onClick={iniciar} disabled={ocupado}>
        {ocupado ? `Actualizando precios online… ${job?.total ? `${avance} %` : ''}` : '↻ Traer precios de Éxito y Olímpica'}
      </Boton>
      {mensaje && <p className="text-center text-sm text-stone-700" role="status">{mensaje}</p>}
    </div>
  )
}
