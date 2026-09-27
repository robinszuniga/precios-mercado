// Los pone apps-script/build.mjs al empaquetar (la etiqueta gas-vN del release y los permisos del manifiesto).
declare const __VERSION_GAS__: string | undefined
declare const __PERMISOS_GAS__: string[] | undefined

/** Versión del código de este script ("dev" si no salió de un release). */
export const VERSION_CODIGO: string = typeof __VERSION_GAS__ === 'string' ? __VERSION_GAS__ : 'dev'

/** Permisos (oauthScopes) con los que se armó este código: si una versión nueva pide otros, no se instala sola. */
export const PERMISOS_CODIGO: string[] = typeof __PERMISOS_GAS__ !== 'undefined' && Array.isArray(__PERMISOS_GAS__) ? __PERMISOS_GAS__ : []
