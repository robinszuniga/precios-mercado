/** Pesos colombianos enteros. */
export function cop(n: number): number {
  return Math.round(n)
}

/** "$ 12.345" sin depender de Intl (Apps Script y Node pueden no traer los datos de es-CO). */
export function formatoCop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  const signo = n < 0 ? '-' : ''
  const entero = String(Math.round(Math.abs(n)))
  return `${signo}$ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
