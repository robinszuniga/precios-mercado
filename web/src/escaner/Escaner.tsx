import { useEffect, useRef, useState } from 'react'
import { eanValido, normalizarEan } from '@shared/ean.ts'
import { Boton, Campo } from '../componentes/ui.tsx'
import { obtenerDetector } from './detector.ts'

function mensajeDe(e: unknown): string {
  const nombre = e instanceof DOMException ? e.name : ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'No diste permiso para la cámara. Actívalo en el candado de la barra de direcciones (o en Ajustes del celular) y vuelve a intentar.'
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'No encontré una cámara en este celular.'
  if (nombre === 'NotReadableError') return 'Otra app está usando la cámara. Ciérrala y vuelve a intentar.'
  return 'No pude abrir el lector de códigos. Escribe el número que sale debajo de las barras.'
}

/**
 * Cámara trasera leyendo códigos de barras. Entrega el primero con dígito de control válido (la cámara a veces
 * lee mal un número) y apaga la cámara al salir. Si no hay cámara, deja escribir el código a mano.
 */
export function Escaner({ onCodigo, onCancelar }: { onCodigo: (ean: string) => void; onCancelar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'error'>('abriendo')
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const entregado = useRef(false)

  useEffect(() => {
    let vivo = true
    let flujo: MediaStream | null = null
    let reloj = 0
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('sin cámara', 'NotFoundError')
        const [detector, f] = await Promise.all([
          obtenerDetector(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }),
        ])
        flujo = f
        // Se cerró mientras abría: la cámara no puede quedar encendida.
        if (!vivo || !video.current) { f.getTracks().forEach((t) => t.stop()); return }
        video.current.srcObject = f
        await video.current.play()
        setEstado('leyendo')
        const ciclo = async () => {
          if (!vivo || entregado.current) return
          try {
            const vistos = video.current && video.current.readyState >= 2 ? await detector.detect(video.current) : []
            const bueno = vistos.map((x) => x.rawValue).find(eanValido)
            if (bueno && vivo && !entregado.current) {
              entregado.current = true
              navigator.vibrate?.(80)
              onCodigo(normalizarEan(bueno))
              return
            }
          } catch {
            // Un cuadro que no se pudo leer: se intenta con el siguiente.
          }
          reloj = window.setTimeout(ciclo, 120)
        }
        void ciclo()
      } catch (e) {
        if (!vivo) return
        setError(mensajeDe(e))
        setEstado('error')
      }
    })()
    return () => {
      vivo = false
      clearTimeout(reloj)
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const escrito = normalizarEan(manual)
  const escritoOk = eanValido(escrito)
  return (
    <div className="space-y-3">
      {estado !== 'error' && (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" aria-label="Cámara" />
          <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          <p className="absolute inset-x-0 bottom-2 text-center text-sm font-medium text-white" role="status">
            {estado === 'abriendo' ? 'Abriendo la cámara…' : 'Apunta al código de barras'}
          </p>
        </div>
      )}
      {error && <p className="text-sm font-medium text-peligro" role="alert">{error}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (escritoOk && !entregado.current) { entregado.current = true; onCodigo(escrito) }
        }}
      >
        <div className="flex-1">
          <Campo
            etiqueta="O escribe el código"
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="7702511000014"
            aviso={manual && escrito.length >= 8 && !escritoOk ? 'Ese código no es válido: revisa los números.' : undefined}
          />
        </div>
        <Boton type="submit" disabled={!escritoOk}>Listo</Boton>
      </form>
      <Boton variante="secundario" className="w-full" onClick={onCancelar}>Volver</Boton>
    </div>
  )
}
