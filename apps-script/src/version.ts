// Lo pone apps-script/build.mjs al empaquetar (la etiqueta gas-vN del release).
declare const __VERSION_GAS__: string | undefined

/** Versión del código de este script ("dev" si no salió de un release). */
export const VERSION_CODIGO: string = typeof __VERSION_GAS__ === 'string' ? __VERSION_GAS__ : 'dev'

