/** Deja solo los dígitos; un UPC-A (12) se lleva a EAN-13 con un 0 adelante, que es como lo guardan las tiendas. */
export function normalizarEan(codigo: string): string {
  const d = String(codigo ?? '').replace(/\D/g, '')
  return d.length === 12 ? `0${d}` : d
}

/** Dígito de control correcto (EAN-8, UPC-A, EAN-13): la cámara a veces lee un número de más o de menos. */
export function eanValido(codigo: string): boolean {
  const d = normalizarEan(codigo)
  if (d.length !== 8 && d.length !== 13) return false
  const cifras = [...d].map(Number)
  const control = cifras.pop()!
  // De derecha a izquierda (sin el control): pesos 3, 1, 3, 1…
  const suma = cifras.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (suma % 10)) % 10 === control
}

/** En forma GTIN-14: EAN-8, UPC-A, EAN-13 y GTIN-14 son el mismo código con ceros adelante (a veces la tienda o el lector los quita o los agrega). */
const gtin14 = (codigo: string | null | undefined): string => {
  const d = String(codigo ?? '').replace(/\D/g, '')
  return d.length >= 8 && d.length <= 14 ? d.padStart(14, '0') : ''
}

export function mismoEan(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = gtin14(a)
  return x !== '' && x === gtin14(b)
}
