import { useRegisterSW } from 'virtual:pwa-register/react'

/** Hay versión nueva: se avisa y el usuario elige cuándo recargar (nunca a mitad de una compra sin preguntar). */
export function AvisoVersion() {
  const {
    needRefresh: [hayNueva, setHayNueva],
    updateServiceWorker,
  } = useRegisterSW()
  if (!hayNueva) return null
  return (
    // Flota arriba (no empuja la pantalla mientras marcas productos).
    <div
      role="status"
      className="fixed inset-x-0 z-30 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-b-xl bg-marca px-4 py-2 text-sm text-white shadow-lg"
      style={{ top: 0, paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
    >
      <span>Hay una versión nueva de la app.</span>
      <span className="flex gap-2">
        <button type="button" className="underline" onClick={() => setHayNueva(false)}>Luego</button>
        <button type="button" className="rounded-lg bg-white px-2 py-1 font-semibold text-marca" onClick={() => updateServiceWorker(true)}>
          Actualizar
        </button>
      </span>
    </div>
  )
}
