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
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [])

  /**
   * Pregunta cada 5 s cómo va, una pregunta a la vez (la siguiente se programa al llegar la respuesta) y solo
   * mientras la pantalla está abierta. Tras 10 min deja de preguntar: el trabajo sigue en el servidor.
   */
  function seguir(vueltas = 0) {
    if (!montado.current) return
    temporizador.current = setTimeout(async () => {
      const r = await llamar<{ job: JobPublico | null }>(await conexion(), 'estadoJob')
      if (!montado.current) return
      const j = r.tipo === 'ok' ? r.data.job : null
      if (j) setJob(j)
      if (j && (j.estado === 'terminado' || j.estado === 'error')) {
        setOcupado(false)
        setMensaje(j.estado === 'terminado'
          ? `Listo: ${j.actualizados} precios cambiaron${j.errores.length ? `, ${j.errores.length} con problemas (ver Ajustes)` : ''}.`
          : 'La actualización falló. Revisa el diagnóstico en Ajustes.')
        void sincronizar()
        return
      }
      if (vueltas >= 120) {
        setOcupado(false)
        setMensaje('Sigue trabajando en Google: los precios llegarán solos.')
        return
      }
      seguir(vueltas + 1)
    }, 5000)
  }

  async function iniciar() {
    setOcupado(true)
    setMensaje('')
    const r = await llamar<{ job: JobPublico }>(await conexion(), 'actualizarPrecios')
    if (!montado.current) return
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
        Opcional: para traer solos los precios de Éxito y Olímpica hay que conectar una copia en Google <span className="text-marca">→ Ajustes</span>
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
