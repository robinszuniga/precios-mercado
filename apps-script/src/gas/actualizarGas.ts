import { isoBogota } from '../../../shared/src/fechas.ts'
import { API, type PuertosActualizar } from '../actualizar.ts'

/** El actualizador en Apps Script: descarga con UrlFetchApp y habla con la API de Apps Script con el token del script. */
export function puertosActualizarGas(): PuertosActualizar {
  const props = PropertiesService.getScriptProperties()
  const pedir = (url: string, opciones: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions) => {
    const r = UrlFetchApp.fetch(url, { ...opciones, muteHttpExceptions: true, followRedirects: true })
    return { status: r.getResponseCode(), texto: r.getContentText() }
  }
  return {
    scriptId: ScriptApp.getScriptId(),
    descargar: (url) => pedir(url, { method: 'get' }),
    api: (metodo, ruta, cuerpo) => pedir(`${API}${ruta}`, {
      method: metodo,
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      ...(cuerpo === undefined ? {} : { payload: JSON.stringify(cuerpo) }),
    }),
    props: {
      get: (k) => props.getProperty(k),
      set: (k, v) => { props.setProperty(k, v) },
      borrar: (k) => { props.deleteProperty(k) },
    },
    ahora: () => isoBogota(Date.now()),
  }
}
