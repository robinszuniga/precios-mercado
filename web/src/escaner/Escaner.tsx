import { useEffect, useRef, useState } from 'react'
import { eanValido, normalizarEan } from '@shared/ean.ts'
import { Boton, Campo } from '../componentes/ui.tsx'
import { obtenerDetector } from './detector.ts'

function mensajeDe(e: unknown): string {
  const nombre = e instanceof DOMException ? e.name : ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'No diste permiso para la cámara. Actívalo en el candado de la barra de direcciones (o en Ajustes del celular) y vuelve a intentar.'
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'No encontré una cámara en este celular.'
  if (nombre === 'NotReadableError') return 'Otra app está usando la cámara. Ciérrala y vuelve a intentar.'
  return 'No pude abrir la cámara.'
}

const AYUDA_MANUAL = 'Escribe el número que sale debajo de las barras.'
/** Cuadros seguidos que fallan al leer antes de rendirse y ofrecer escribir el código. */
const MAX_FALLOS = 25
/** Justo después de guardar, la cámara sigue apuntando al mismo producto: no se vuelve a leer el mismo código. */
const IGNORAR_MISMO_MS = 4000

/**
 * Cámara trasera leyendo códigos de barras. Entrega el primero con dígito de control válido (la cámara a veces
 * lee mal un número) y apaga la cámara al salir, pase lo que pase. Si no hay cámara o el lector no carga, deja
 * escribir el código a mano.
 */
export function Escaner({ onCodigo, onCancelar, ignorar }: { onCodigo: (ean: string) => void; onCancelar: () => void; ignorar?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'error'>('abriendo')
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const entregado = useRef(false)
  const inicio = useRef(Date.now())

  useEffect(() => {
    let vivo = true
    let flujo: MediaStream | null = null
    let reloj = 0
    const fallar = (texto: string) => {
      if (!vivo) return
      setError(texto)
      setEstado('error')
    }
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('sin cámara', 'NotFoundError')
        // Primero la cámara y se guarda ya: si lo demás falla, el cleanup la apaga.
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
        if (!vivo) { flujo.getTracks().forEach((t) => t.stop()); return }
        let detector: Awaited<ReturnType<typeof obtenerDetector>>
        try {
          detector = await obtenerDetector()
        } catch {
          flujo.getTracks().forEach((t) => t.stop())
          fallar(`No pude cargar el lector de códigos (la primera vez necesita señal). ${AYUDA_MANUAL}`)
          return
        }
        if (!vivo || !video.current) return
        video.current.srcObject = flujo
        try {
          await video.current.play()
        } catch {
          flujo.getTracks().forEach((t) => t.stop())
          fallar(`No pude mostrar la cámara. ${AYUDA_MANUAL}`)
          return
        }
        setEstado('leyendo')
        let fallos = 0
        const ciclo = async () => {
          if (!vivo || entregado.current) return
          try {
            const vistos = video.current && video.current.readyState >= 2 ? await detector.detect(video.current) : []
            fallos = 0
            const bueno = vistos.map((x) => normalizarEan(x.rawValue)).find(eanValido)
            const repetido = !!bueno && bueno === ignorar && Date.now() - inicio.current < IGNORAR_MISMO_MS
            if (bueno && !repetido && vivo && !entregado.current) {
              entregado.current = true
              navigator.vibrate?.(80)
              onCodigo(bueno)
              return
            }
          } catch {
            // Un cuadro que no se pudo leer: se intenta con el siguiente; si fallan todos, se ofrece escribirlo.
            if (++fallos >= MAX_FALLOS) {
              flujo?.getTracks().forEach((t) => t.stop())
              fallar(`El lector de códigos no está funcionando. ${AYUDA_MANUAL}`)
              return
            }
          }
          reloj = window.setTimeout(ciclo, 120)
        }
        void ciclo()
      } catch (e) {
        fallar(`${mensajeDe(e)} ${e instanceof DOMException && e.name === 'NotAllowedError' ? '' : AYUDA_MANUAL}`.trim())
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
            aviso={escrito.length >= 12 && !escritoOk ? 'Ese código no es válido: revisa los números.' : undefined}
          />
        </div>
        <Boton type="submit" disabled={!escritoOk}>Listo</Boton>
      </form>
      <Boton variante="secundario" className="w-full" onClick={onCancelar}>Volver</Boton>
    </div>
  )
}
