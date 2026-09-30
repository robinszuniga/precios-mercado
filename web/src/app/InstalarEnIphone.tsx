import { useMeta } from '../datos/consultas.ts'
import { guardarMeta } from '../datos/db.ts'

const ES_IOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const ES_APP_INSTALADA = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches

/**
 * En iPhone la app instalada y Safari no comparten datos: lo que se guarda en Safari no aparece en el ícono.
 * Se avisa antes de que alguien pegue su lista en el lugar equivocado.
 */
export function InstalarEnIphone() {
  const cerrado = useMeta<boolean>('avisoInstalarCerrado', false)
  if (cerrado || !ES_IOS() || ES_APP_INSTALADA()) return null
  return (
    <div role="status" className="flex items-start gap-2 bg-teal-50 px-4 py-2 text-sm text-teal-950">
      <p className="flex-1 py-1">
        <strong>Instálala primero:</strong> Compartir → <strong>“Añadir a pantalla de inicio”</strong>. Lo que guardes en Safari no pasa a la app.
      </p>
      <button type="button" aria-label="Cerrar aviso" className="grid size-11 shrink-0 place-items-center text-lg" onClick={() => void guardarMeta('avisoInstalarCerrado', true)}>×</button>
    </div>
  )
}
