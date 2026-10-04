export function mensajeErrorVtex(valor: string | undefined): string {
  if (!valor) return 'No se pudo consultar la tienda.'
  if (valor === 'rate_limit') return 'Has consultado muchos precios. Espera un minuto y vuelve a intentarlo.'
  if (valor === 'sin_conexion') return 'Inicia sesión para consultar precios.'
  return valor
}
