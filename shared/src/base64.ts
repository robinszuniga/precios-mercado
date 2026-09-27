// Base64 de texto UTF-8 sin btoa/atob ni Buffer, para que corra igual en Apps Script, Node y el navegador.
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8(texto: string): number[] {
  const bytes: number[] = []
  for (const ch of texto) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return bytes
}

function desdeUtf8(bytes: number[]): string {
  let s = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]
    let c: number
    if (b < 0x80) { c = b; i += 1 }
    else if (b < 0xe0) { c = ((b & 31) << 6) | (bytes[i + 1] & 63); i += 2 }
    else if (b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3 }
    else {
      c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63)
      i += 4
    }
    s += String.fromCodePoint(c)
  }
  return s
}

export function aBase64(texto: string): string {
  const b = utf8(texto)
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63]
    s += i + 1 < b.length ? ALFABETO[(n >> 6) & 63] : '='
    s += i + 2 < b.length ? ALFABETO[n & 63] : '='
  }
  return s
}

export function deBase64(b64: string): string {
  const limpio = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes: number[] = []
  for (let i = 0; i < limpio.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < limpio.length ? ALFABETO.indexOf(limpio[i + k]) : -1))
    const n = (v[0] << 18) | (v[1] << 12) | ((v[2] < 0 ? 0 : v[2]) << 6) | (v[3] < 0 ? 0 : v[3])
    bytes.push((n >> 16) & 255)
    if (v[2] >= 0) bytes.push((n >> 8) & 255)
    if (v[3] >= 0) bytes.push(n & 255)
  }
  return desdeUtf8(bytes)
}
