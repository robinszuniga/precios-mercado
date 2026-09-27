/** Espacio que no se parte: "$ 12.345" y "1,5 kg" nunca quedan en dos líneas. */
export const NBSP = ' '

/** Pesos colombianos enteros. */
export function cop(n: number): number {
  return Math.round(n)
}

/** "$ 12.345" sin depender de Intl (Apps Script y Node pueden no traer los datos de es-CO). */
export function formatoCop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  const entero = String(Math.round(Math.abs(n)))
  // Un resto de redondeo (-0,4) no es plata negativa: se muestra "$ 0", nunca "-$ 0".
  const signo = n < 0 && entero !== '0' ? '-' : ''
  return `${signo}$${NBSP}${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** Número con coma decimal y punto de miles, como se escribe en Colombia: 1,5 · 2.500 · 0,75. */
export function formatoNumero(n: number, decimales = 2): string {
  const redondeado = Math.round(n * 10 ** decimales) / 10 ** decimales
  const [entero, dec] = String(Math.abs(redondeado)).split('.')
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${redondeado < 0 ? '-' : ''}${miles}${dec ? `,${dec}` : ''}`
}
