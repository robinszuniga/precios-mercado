/** Recarga la página. Aparte para que las pruebas puedan sustituirla (jsdom no deja redefinir `location.reload`). */
export const pagina = { recargar: () => window.location.reload() }
