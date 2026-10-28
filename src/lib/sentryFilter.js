/**
 * Filtro de datos personales para Sentry (convenio RENAPER, 2026-10-28).
 *
 * El Manual de Seguridad declara que a Sentry —un tercero— no viajan datos
 * personales. Este módulo es el que lo hace verdad: se enchufa en `beforeSend`,
 * `beforeSendTransaction` y `beforeBreadcrumb` y deja cada evento sin mails, DNI,
 * CUIT, teléfonos, tokens, query strings, cuerpos de request ni datos del usuario
 * más allá de su id.
 *
 * No importa `@sentry/*` a propósito: es lógica pura, así que se prueba con
 * `node --test` (scripts/test-sentry-sin-datos-personales.mjs). La app mobile
 * tiene una copia idéntica en `mobile/src/lib/sentryFilter.ts` — si se toca una,
 * se toca la otra (el test de la app compara las reglas con las mismas entradas).
 *
 * Criterio: ante la duda, enmascarar. Un número de 9 dígitos de más que se
 * esconde cuesta una línea menos en un mensaje de error; un DNI que sale cuesta
 * una declaración jurada falsa.
 */

const MASCARA = '[filtrado]'

// UUIDs: se protegen antes de enmascarar (un grupo de 8 dígitos parecería DNI) y
// se restauran después. Un id de usuario o de consulta no es un dato personal.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

// Los errores de Postgres/PostgREST traen la FILA que falló ("Failing row contains
// (…, Juan Pérez, Av. X 123, …)", sus columnas pueden ser jsonb con comillas y
// llaves) y la clave duplicada ("Key (email)=(x) already exists"). Llegan por
// breadcrumbs de consola y por rejections serializadas una o dos veces. La fila
// entera es un dato personal aunque ninguna columna parezca un mail o un DNI, así
// que NO se intenta reconocer sus partes: se tapa todo lo que sigue.
//
// Para no destruir la estructura de lo que se manda, el texto se recorre de
// izquierda a derecha en UNA pasada:
//   · un fragmento JSON legible (uno o dos niveles de serialización) se parsea, se
//     limpia valor por valor (los strings con este mismo recorrido) y se vuelve a
//     escribir: `code`, `status`… sobreviven y sigue siendo JSON válido;
//   · "Failing row contains" y "Key (…)=(…)" en TEXTO SUELTO tapan hasta el final
//     del texto (el de un string JSON es el final de ese string);
//   · lo suelto que queda pasa por las reglas de abajo (mails, DNI, tokens…).

// El orden importa: lo más específico primero, los números sueltos al final.
const REGLAS = [
  // Tokens y secretos
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[token]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [token]'],
  [/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[token]'],
  [/\b(access_token|refresh_token|id_token|token|apikey|api_key|secret|password|passwd|contrasena|contraseña)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[token]'],
  // Mails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
  // CUIT / CUIL (11 dígitos con prefijo AFIP, con o sin guiones)
  [/\b(?:20|23|24|27|30|33|34)[-\s]?\d{8}[-\s]?\d\b/g, '[cuit]'],
  // Teléfonos: con +, con separadores, o corridas largas de dígitos. Una marca de
  // tiempo en ms (13 dígitos que empiezan con 15–19) no es un teléfono.
  [/\+\d[\d\s().-]{7,}\d/g, '[teléfono]'],
  [/\b\d{2,4}[\s.-]\d{3,4}[\s.-]\d{4}\b/g, '[teléfono]'],
  [/\b\d{4}-\d{4}\b/g, '[teléfono]'],
  [/\b(?!1[5-9]\d{11}\b)\d{9,15}\b/g, '[número]'],
  // DNI: 12.345.678 o 7–8 dígitos corridos
  [/\b\d{1,2}\.\d{3}\.\d{3}\b/g, '[dni]'],
  [/\b\d{7,8}\b/g, '[dni]'],
]

// Sólo para texto suelto: `details`/`hint` de un JSON que NO se pudo leer (truncado,
// mal escapado) y de un objeto impreso con comillas simples. Ante la duda, el resto
// de la línea.
const REGLAS_SUELTO = [
  [/(\\*"(?:details|hint)\\*"\s*:\s*)(?!null\b)[^\n]*/gi, '$1"[filtrado]"'],
  [/(\b(?:details|hint)\b\s*:\s*)(['"`])(?:(?!\2)[^\\]|\\.)*\2/gi, '$1$2[filtrado]$2'],
]

/** Reglas sobre un tramo de texto suelto (sin JSON adentro). */
function limpiarSuelto(texto) {
  const guardados = []
  let t = texto.replace(UUID, (u) => `⟦u${guardados.push(u) - 1}⟧`)
  for (const [re, reemplazo] of REGLAS_SUELTO) t = t.replace(re, reemplazo)
  for (const [re, reemplazo] of REGLAS) t = t.replace(re, reemplazo)
  return t.replace(/⟦u(\d+)⟧/g, (_, i) => guardados[Number(i)])
}

const FILA = /Failing row contains/iy
// El valor sólo se da por terminado con el sufijo conocido del error o con el final
// del texto; si no, se tapa hasta el final (un valor puede tener cualquier carácter).
const KEY_CON_CIERRE = /Key \(([^\n]*?)\)=\([\s\S]*?\)(?=\s+(?:already exists|is not present|is still referenced)|[.,;]?\s*$)/y
const KEY_ABIERTA = /Key \(([^\n]*?)\)=\(/y
const TEXTO_MAX = 50000
const NIVEL_MAX = 6          // un JSON dentro de un string dentro de un JSON… no se sigue para siempre
const INTENTOS_JSON_MAX = 200
let nivelTexto = 0

/** Índice posterior al cierre del `{`/`[` de `ini` (con strings y escapes), o -1. */
function finDeJson(t, ini) {
  let prof = 0
  let enString = false
  let escapado = false
  for (let i = ini; i < t.length; i++) {
    const c = t[i]
    if (enString) {
      if (escapado) escapado = false
      else if (c === '\\') escapado = true
      else if (c === '"') enString = false
      continue
    }
    if (c === '"') enString = true
    else if (c === '{' || c === '[') prof++
    else if (c === '}' || c === ']') {
      prof--
      if (prof === 0) return i + 1
      if (prof < 0) return -1
    }
  }
  return -1
}

/** Enmascara mails, DNI, CUIT, teléfonos, tokens y filas de errores de la base dentro de un texto. */
export function limpiarTexto(texto) {
  if (typeof texto !== 'string' || texto === '') return texto
  if (nivelTexto >= NIVEL_MAX) return MASCARA
  nivelTexto++
  try {
    return limpiarTextoInterno(texto)
  } finally {
    nivelTexto--
  }
}

function limpiarTextoInterno(texto) {
  const recortado = texto.length > TEXTO_MAX
  const t = recortado ? texto.slice(0, TEXTO_MAX) : texto

  // Un string JSON entero ("…") se lee y se vuelve a escribir.
  const entero = t.trim()
  if (entero.length > 1 && entero[0] === '"' && entero[entero.length - 1] === '"') {
    try {
      const v = JSON.parse(entero)
      if (typeof v === 'string') return JSON.stringify(limpiarTexto(v))
    } catch { /* no era un string JSON: se sigue como texto suelto */ }
  }

  let salida = ''
  let suelto = ''
  let intentos = 0
  const vaciar = () => {
    if (suelto) { salida += limpiarSuelto(suelto); suelto = '' }
  }

  let i = 0
  while (i < t.length) {
    const c = t[i]

    if (c === 'F' || c === 'f') {
      FILA.lastIndex = i
      if (FILA.test(t)) {
        vaciar()
        salida += `Failing row contains ${MASCARA}`
        i = t.length
        break
      }
    } else if (c === 'K' && (i === 0 || !/\w/.test(t[i - 1]))) {
      KEY_CON_CIERRE.lastIndex = i
      const cerrada = KEY_CON_CIERRE.exec(t)
      if (cerrada) {
        vaciar()
        salida += `Key (${cerrada[1]})=(${MASCARA})`
        i += cerrada[0].length
        continue
      }
      KEY_ABIERTA.lastIndex = i
      const abierta = KEY_ABIERTA.exec(t)
      if (abierta) {
        vaciar()
        salida += `Key (${abierta[1]})=(${MASCARA})`
        i = t.length
        break
      }
    } else if ((c === '{' || c === '[') && intentos < INTENTOS_JSON_MAX) {
      intentos++
      const fin = finDeJson(t, i)
      if (fin > 0) {
        let valor
        try { valor = JSON.parse(t.slice(i, fin)) } catch { valor = undefined }
        if (valor !== undefined) {
          vaciar()
          salida += JSON.stringify(limpiarValor(valor, 0, new WeakSet(), true))
          i = fin
          continue
        }
      }
    }

    suelto += c
    i++
  }
  vaciar()
  return recortado ? `${salida}…` : salida
}

/** Saca la query string y el fragmento (ahí viajan ids, mails y tokens de magic link). */
export function limpiarUrl(url) {
  if (typeof url !== 'string') return url
  return limpiarTexto(url.split(/[?#]/)[0])
}

// Claves cuyo VALOR se esconde entero, sea lo que sea que tengan.
const CLAVE_SENSIBLE = /(^(details|hint|detail)$|e-?mail|\bmail\b|dni|documento|cuit|cuil|phone|tel[eé]fono|celular|whatsapp|passw|contrase|token|authorization|api[_-]?key|apikey|secret|cookie|full_?name|first_?name|last_?name|nombre|apellido|username|display_?name|address|direcci[oó]n|nacimiento|birth|fecha_de_nac)/i

// Cuerpos de request/response: nunca viajan.
const CLAVE_CUERPO = /^(body|data|request_body|response_body|requestbody|responsebody|payload)$/i

const PROFUNDIDAD_MAX = 8

/** Recorre un valor cualquiera y devuelve una copia limpia (no muta la entrada). */
export function limpiarValor(valor, profundidad = 0, vistos = new WeakSet(), numeros = false) {
  if (typeof valor === 'string') return limpiarTexto(valor)
  // Un número dentro de un JSON leído de un texto (un DNI sin comillas) pasa por las mismas reglas.
  if (typeof valor === 'number' && numeros) {
    const t = limpiarSuelto(String(valor))
    return t === String(valor) ? valor : t
  }
  if (valor === null || typeof valor !== 'object') return valor
  if (profundidad >= PROFUNDIDAD_MAX) return MASCARA
  if (vistos.has(valor)) return '[circular]'
  vistos.add(valor)
  if (Array.isArray(valor)) return valor.map((v) => limpiarValor(v, profundidad + 1, vistos, numeros))
  const salida = {}
  for (const [k, v] of Object.entries(valor)) {
    if (CLAVE_SENSIBLE.test(k) && v !== null && v !== undefined && v !== '') salida[k] = MASCARA
    else if (/url$/i.test(k) && typeof v === 'string') salida[k] = limpiarUrl(v)
    else salida[k] = limpiarValor(v, profundidad + 1, vistos, numeros)
  }
  return salida
}

/** Un breadcrumb: URLs sin query, sin cuerpos, mensajes y datos limpios. */
export function limpiarBreadcrumb(b) {
  if (!b || typeof b !== 'object') return b
  const salida = { ...b }
  if (typeof salida.message === 'string') salida.message = limpiarTexto(salida.message)
  if (salida.data && typeof salida.data === 'object') {
    const data = {}
    for (const [k, v] of Object.entries(salida.data)) {
      if (CLAVE_CUERPO.test(k)) continue
      if (typeof v === 'string' && /(^|_)(url|from|to)$/i.test(k)) data[k] = limpiarUrl(v)
      else data[k] = limpiarValor(v)
    }
    salida.data = data
  }
  return salida
}

// Del contexto del dispositivo no sale el nombre que le puso la persona
// ("iPhone de Mateo") ni nada que lo identifique de forma única.
const CAMPOS_DEL_DISPOSITIVO = ['name', 'device_unique_identifier', 'id', 'serial', 'email', 'user']

/**
 * Un evento (error o transacción) de Sentry. Devuelve el evento limpio, o el
 * mismo objeto modificado: el SDK acepta cualquiera de las dos.
 */
export function limpiarEvento(evento) {
  if (!evento || typeof evento !== 'object') return evento
  const e = evento

  // Usuario: sólo el id. Nada de mail, nombre, IP ni segmento.
  if (e.user) {
    const id = e.user.id !== undefined && e.user.id !== null ? limpiarTexto(String(e.user.id)) : undefined
    e.user = id ? { id } : undefined
    if (!e.user) delete e.user
  }
  delete e.server_name

  // Texto libre
  if (typeof e.message === 'string') e.message = limpiarTexto(e.message)
  if (e.logentry) {
    if (typeof e.logentry.message === 'string') e.logentry.message = limpiarTexto(e.logentry.message)
    if (Array.isArray(e.logentry.params)) e.logentry.params = e.logentry.params.map((p) => limpiarValor(p))
  }
  if (typeof e.transaction === 'string') e.transaction = limpiarUrl(e.transaction)

  // Excepciones: el mensaje y los valores locales de cada frame
  for (const ex of e.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = limpiarTexto(ex.value)
    for (const f of ex.stacktrace?.frames ?? []) {
      delete f.vars
      if (typeof f.abs_path === 'string') f.abs_path = limpiarUrl(f.abs_path)
      if (typeof f.filename === 'string') f.filename = limpiarUrl(f.filename)
    }
  }

  // Request: sin cuerpo, cookies, headers ni query string.
  if (e.request) {
    const r = e.request
    if (typeof r.url === 'string') r.url = limpiarUrl(r.url)
    delete r.data
    delete r.cookies
    delete r.headers
    delete r.query_string
    delete r.env
  }

  // Breadcrumbs
  if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map(limpiarBreadcrumb)
  else if (Array.isArray(e.breadcrumbs?.values)) e.breadcrumbs.values = e.breadcrumbs.values.map(limpiarBreadcrumb)

  // Extra, tags y contextos
  if (e.extra) e.extra = limpiarValor(e.extra)
  if (e.tags) e.tags = limpiarValor(e.tags)
  if (e.contexts) {
    const dispositivo = e.contexts.device
    e.contexts = limpiarValor(e.contexts)
    delete e.contexts.user
    if (dispositivo && e.contexts.device) {
      for (const c of CAMPOS_DEL_DISPOSITIVO) delete e.contexts.device[c]
    }
  }

  // Transacciones: cada span lleva la URL que pidió.
  for (const s of e.spans ?? []) {
    if (typeof s.description === 'string') {
      const m = /^([A-Z]+)\s+(.*)$/.exec(s.description)   // "GET https://…/x?y=1"
      s.description = m ? `${m[1]} ${limpiarUrl(m[2])}` : limpiarUrl(s.description)
    }
    if (s.data) s.data = limpiarValor(s.data)
  }

  return e
}

/** Opciones de privacidad compartidas por `Sentry.init` en la web y en la app. */
export const OPCIONES_PRIVADAS = {
  sendDefaultPii: false,
  beforeSend: limpiarEvento,
  beforeSendTransaction: limpiarEvento,
  beforeBreadcrumb: limpiarBreadcrumb,
}
