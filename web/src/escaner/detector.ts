/**
 * Lector de códigos de barras. Chrome de Android trae uno nativo; el resto (iPhone, Firefox) usa el lector de
 * zxing en WebAssembly, que se baja de la propia app (no de otro servidor) solo la primera vez que se abre la cámara.
 */
export interface Detector {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

interface ConstructorDetector {
  new (opciones: { formats: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

let listo: Promise<Detector> | null = null

export function obtenerDetector(): Promise<Detector> {
  listo ??= (async () => {
    const nativo = (globalThis as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector
    if (nativo) {
      try {
        const soporta = (await nativo.getSupportedFormats?.()) ?? []
        if (soporta.includes('ean_13')) return new nativo({ formats: FORMATOS.filter((f) => soporta.includes(f)) })
      } catch {
        // Sigue con zxing.
      }
    }
    const [{ BarcodeDetector, setZXingModuleOverrides }, { default: wasm }] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
    setZXingModuleOverrides({ locateFile: (ruta: string, prefijo: string) => (ruta.endsWith('.wasm') ? wasm : prefijo + ruta) })
    return new BarcodeDetector({ formats: FORMATOS as never[] }) as unknown as Detector
  })()
  listo.catch(() => { listo = null })
  return listo
}
