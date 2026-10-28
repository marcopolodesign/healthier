/**
 * Sentry con LISTA BLANCA (convenio RENAPER, 2026-10-28).
 *
 * El Manual de Seguridad declara que a Sentry —un tercero— no viaja ningún dato
 * personal. Decisión de Mateo: no se intenta reconocer ni tapar datos personales en
 * texto libre (se probó con regex y siempre aparecía otra forma de fuga: JSON
 * truncado, claves de objeto, el valor que eco-a un 22P02…). En su lugar el evento se
 * RECONSTRUYE desde cero con lo único que sale:
 *
 *   · `user`: sólo `id` (UUID). La identificación de la persona la hacemos nosotros
 *     con ese id, adentro; Sentry no puede saber quién es.
 *   · `exception`: `type`, frames (archivo, función, línea, columna) y un `value` que
 *     NUNCA es el mensaje original: es un literal nuestro de una lista conocida, o el
 *     código del error (23505, 22P02, PGRST116, HTTP 409), o el nombre de la clase.
 *   · `message` (captureMessage): sólo un literal conocido o un código; si no, "[mensaje]".
 *   · `breadcrumbs`: categoría, nivel, hora; para navegación y fetch/xhr, la ruta sin
 *     query (y método / status). Los de consola y los clics salen sin texto ni datos.
 *   · `request`: URL sin query y método. `extra`: no sale.
 *   · `contexts`: sólo los técnicos (os, browser, device, app, runtime, trace) y sólo
 *     sus campos técnicos. `tags`: sólo environment, release, canal.
 *
 * El agrupamiento no se pierde: Sentry agrupa por tipo + stack, no por el mensaje.
 *
 * Lógica pura (no importa `@sentry/*`): se prueba con `node --test`
 * (scripts/test-sentry-sin-datos-personales.mjs). `website/src/lib/sentryFilter.js` y
 * `mobile/src/lib/sentryFilter.ts` son el mismo código — se tocan juntos.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NIVELES = new Set(['fatal', 'error', 'warning', 'log', 'info', 'debug'])
const TIPOS_BREADCRUMB = new Set(['default', 'debug', 'error', 'info', 'navigation', 'http', 'query', 'ui', 'user'])
const IDENTIFICADOR = /^[A-Za-z_$][\w$.]{0,80}$/

// Forma de cada string técnico que sale: si no calza, el campo no viaja. Ninguna deja
// pasar espacios sueltos ni "@", así que un texto libre (un nombre, un mail) no entra.
const FORMA_FUNCION = /^(?:(?:async|new|get|set) )?[A-Za-z_$<?][\w$.<>[\]?#-]{0,100}$/
const FORMA_MODULO = /^[\w$./:-]{1,120}$/
const FORMA_ARCHIVO = /^[\w$./:~%+-]{1,300}$/
const FORMA_DIRECCION = /^(?:0x)?[0-9a-fA-F]{1,20}$/
const FORMA_ETIQUETA = /^[\w.-]{1,60}$/
const FORMA_ID = /^[\w-]{1,64}$/
const FORMA_VERSION = /^[\w.+\-:]{1,200}$/
const FORMA_VALOR_CONTEXTO = /^[\w .,()+/:-]{0,100}$/

// ── Rutas ───────────────────────────────────────────────────────────────────
function segmentoSeguro(seg        )         {
  let d = seg
  try { d = decodeURIComponent(seg) } catch { /* se deja como vino */ }
  if (d.includes('@')) return ':email'
  if (/^\d{6,}$/.test(d)) return ':numero'
  if (/\s/.test(d)) return ':dato'
  return seg
}

/** La ruta de una URL sin query ni fragmento; sin mails ni números largos en los segmentos. */
export function rutaSinQuery(url     )                     {
  if (typeof url !== 'string' || url === '') return undefined
  const t = url.split(/[?#]/)[0].split('/').map(segmentoSeguro).join('/')
  return t.length > 200 ? `${t.slice(0, 200)}…` : t
}

// ── Mensajes y códigos ──────────────────────────────────────────────────────
// Códigos de error que sí viajan: SQLSTATE de Postgres, PostgREST, estados HTTP.
const ES_CODIGO = /^(?:[0-9A-Z]{5}|PGRST\d{3}|[1-5]\d{2})$/

// Mensajes de la base que NO dicen qué valor falló en sí mismos, pero que sí lo
// repiten más adelante ("…for type uuid: \"juan@x.com\""): se reconocen por su comienzo
// y se reemplazan por su código, sin copiar nada del original.
const CODIGOS_POR_MENSAJE                          = [
  [/^invalid input syntax for type/i, '22P02'],
  [/duplicate key value violates unique constraint/i, '23505'],
  [/violates foreign key constraint/i, '23503'],
  [/violates not-null constraint|Failing row contains/i, '23502'],
  [/violates check constraint/i, '23514'],
  [/violates row-level security policy|permission denied for/i, '42501'],
  [/value too long for type/i, '22001'],
  [/out of range for type|numeric field overflow/i, '22003'],
  [/JWT expired/i, 'PGRST301'],
  [/does not exist/i, '42P01'],
  [/Could not find the .* column/i, 'PGRST204'],
  [/JSON object requested, multiple \(or no\) rows returned/i, 'PGRST116'],
]

const EXTRAER_CODIGO           = [
  /\b(PGRST\d{3})\b/,
  /\b(?:[cC]ode|SQLSTATE)\b\\*["']?\s*[:=]\s*\\*["']?([0-9A-Z]{5})\b/,   // también en JSON serializado dos veces: \"code\":\"23505\"
  /\bHTTP (\d{3})\b/,
  /\b[sS]tatus(?: [cC]ode)?\\*["']?\s*[:=]?\s*\\*["']?([1-5]\d{2})\b/,
]

/** El código de error que se pueda sacar de un mensaje, sin copiar nada más. */
export function codigoDe(texto     )                     {
  if (typeof texto !== 'string') return undefined
  for (const re of EXTRAER_CODIGO) {
    const m = re.exec(texto)
    if (m && ES_CODIGO.test(m[1])) return m[1]
  }
  for (const [re, codigo] of CODIGOS_POR_MENSAJE) if (re.test(texto)) return codigo
  return undefined
}

// Mensajes nuestros o del navegador que se conservan TAL CUAL: no llevan datos
// (sólo identificadores de código y frases fijas). Se agregan acá, uno por uno.
export const MENSAJES_CONOCIDOS = new Set        ([
  'Failed to fetch', 'Load failed', 'Network request failed', 'NetworkError when attempting to fetch resource.',
  'Script error.', 'ResizeObserver loop limit exceeded', 'ResizeObserver loop completed with undelivered notifications.',
  'Algo salió mal', 'No autenticado', 'Sesión vencida',
])
const PATRONES_SEGUROS           = [
  /^Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '[A-Za-z_$][\w$]{0,60}'\)$/,
  /^Cannot set propert(?:y|ies) of (?:undefined|null) \(setting '[A-Za-z_$][\w$]{0,60}'\)$/,
  /^[A-Za-z_$][\w$.]{0,80} is not a function$/,
  /^[A-Za-z_$][\w$]{0,60} is not defined$/,
  /^undefined is not an object \(evaluating '[A-Za-z_$][\w$.]{0,80}'\)$/,
  /^null is not an object \(evaluating '[A-Za-z_$][\w$.]{0,80}'\)$/,
]

function esLiteralSeguro(m        )          {
  return MENSAJES_CONOCIDOS.has(m) || PATRONES_SEGUROS.some((re) => re.test(m))
}

/** Lo que reemplaza al mensaje de una captureMessage: un literal conocido, un código, o "[mensaje]". */
export function mensajeSeguro(m     , codigoExtra         )         {
  if (typeof m !== 'string') return '[mensaje]'
  if (esLiteralSeguro(m)) return m
  return codigoExtra ?? codigoDe(m) ?? '[mensaje]'
}

/** El `value` de una excepción: un literal conocido, el código, o el nombre de la clase. Nunca el mensaje. */
export function valorSeguro(tipo        , valor     , codigoExtra         )         {
  if (typeof valor === 'string' && esLiteralSeguro(valor)) return valor
  return codigoExtra ?? codigoDe(valor) ?? tipo
}

// ── Piezas del evento ───────────────────────────────────────────────────────
function limpiarFrames(st     )      {
  if (!st || !Array.isArray(st.frames)) return undefined
  return {
    frames: st.frames.map((f     ) => {
      const s                      = {}
      if (!f || typeof f !== 'object') return s
      if (typeof f.function === 'string' && FORMA_FUNCION.test(f.function)) s.function = f.function
      if (typeof f.raw_function === 'string' && FORMA_FUNCION.test(f.raw_function)) s.raw_function = f.raw_function
      if (typeof f.module === 'string' && FORMA_MODULO.test(f.module)) s.module = f.module
      if (typeof f.package === 'string' && FORMA_ARCHIVO.test(f.package)) s.package = f.package
      if (typeof f.platform === 'string' && /^[a-z]{2,20}$/.test(f.platform)) s.platform = f.platform
      for (const k of ['lineno', 'colno']) if (typeof f[k] === 'number') s[k] = f[k]
      if (typeof f.in_app === 'boolean') s.in_app = f.in_app
      for (const k of ['instruction_addr', 'symbol_addr', 'image_addr']) if (typeof f[k] === 'string' && FORMA_DIRECCION.test(f[k])) s[k] = f[k]
      if (f.addr_mode === 'abs' || f.addr_mode === 'rel:0') s.addr_mode = f.addr_mode
      for (const k of ['filename', 'abs_path']) {
        const r = typeof f[k] === 'string' ? rutaSinQuery(f[k]) : undefined
        if (r && FORMA_ARCHIVO.test(r.replace(/…$/, ''))) s[k] = r
      }
      return s   // sin vars, context_line, pre_context ni post_context
    }),
  }
}

function codigoDelExtra(e     )                     {
  const c = e?.extra?.__serialized__?.code ?? e?.extra?.code
  return typeof c === 'string' && ES_CODIGO.test(c) ? c : typeof c === 'number' && ES_CODIGO.test(String(c)) ? String(c) : undefined
}

function limpiarExcepciones(e     , codigoExtra         )      {
  const valores = Array.isArray(e.exception?.values) ? e.exception.values : []
  return {
    values: valores.map((ex     ) => {
      const tipo = typeof ex?.type === 'string' && IDENTIFICADOR.test(ex.type) ? ex.type : 'Error'
      const s                      = { type: tipo, value: valorSeguro(tipo, ex?.value, codigoExtra) }
      if (ex?.mechanism && typeof ex.mechanism === 'object') {
        s.mechanism = {}
        if (typeof ex.mechanism.type === 'string' && FORMA_ETIQUETA.test(ex.mechanism.type)) s.mechanism.type = ex.mechanism.type
        for (const k of ['handled', 'synthetic']) if (typeof ex.mechanism[k] === 'boolean') s.mechanism[k] = ex.mechanism[k]
      }
      const st = limpiarFrames(ex?.stacktrace)
      if (st) s.stacktrace = st
      if (typeof ex?.module === 'string' && FORMA_MODULO.test(ex.module)) s.module = ex.module
      if (typeof ex?.thread_id === 'number') s.thread_id = ex.thread_id
      return s
    }),
  }
}

/** Un breadcrumb: categoría, nivel y hora; navegación y red con la ruta sin query. Nada de texto libre. */
export function limpiarBreadcrumb(b     )      {
  if (!b || typeof b !== 'object') return b
  const s                      = {}
  if (typeof b.timestamp === 'number') s.timestamp = b.timestamp
  if (NIVELES.has(b.level)) s.level = b.level
  if (typeof b.category === 'string' && /^[\w.-]{1,40}$/.test(b.category)) s.category = b.category
  if (TIPOS_BREADCRUMB.has(b.type)) s.type = b.type
  const d = b.data && typeof b.data === 'object' ? b.data : null
  if (d && s.category === 'navigation') {
    const data                      = {}
    if (typeof d.from === 'string') data.from = rutaSinQuery(d.from)
    if (typeof d.to === 'string') data.to = rutaSinQuery(d.to)
    s.data = data
  } else if (d && (s.category === 'fetch' || s.category === 'xhr' || s.category === 'http')) {
    const data                      = {}
    if (typeof d.url === 'string') data.url = rutaSinQuery(d.url)
    if (typeof d.method === 'string' && /^[A-Za-z]{3,7}$/.test(d.method)) data.method = d.method.toUpperCase()
    if (typeof d.status_code === 'number') data.status_code = d.status_code
    s.data = data
  }
  return s
}

// Contextos técnicos y SÓLO sus campos técnicos. Sin nombre del dispositivo, sin
// identificadores únicos, sin locale/timezone, sin el stack de componentes de React.
const CONTEXTOS_OK                           = {
  os: ['name', 'version', 'build', 'kernel_version', 'rooted'],
  browser: ['name', 'version'],
  runtime: ['name', 'version'],
  app: ['app_name', 'app_version', 'app_build', 'app_identifier', 'build_type', 'in_foreground', 'app_start_time'],
  device: ['family', 'model', 'model_id', 'brand', 'manufacturer', 'arch', 'simulator', 'memory_size', 'usable_memory',
    'free_memory', 'storage_size', 'free_storage', 'processor_count', 'screen_resolution', 'screen_density',
    'screen_dpi', 'orientation', 'low_memory', 'online', 'charging'],
  trace: ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin'],
}

function limpiarContextos(c     )      {
  if (!c || typeof c !== 'object') return undefined
  const salida                      = {}
  for (const [ctx, campos] of Object.entries(CONTEXTOS_OK)) {
    const v = c[ctx]
    if (!v || typeof v !== 'object') continue
    const s                      = {}
    for (const k of campos) {
      const x = v[k]
      if (typeof x === 'number' || typeof x === 'boolean') s[k] = x
      else if (typeof x === 'string' && FORMA_VALOR_CONTEXTO.test(x)) s[k] = x
    }
    if (Object.keys(s).length) salida[ctx] = s
  }
  return salida
}

const TAGS_OK = new Set(['environment', 'release', 'canal', 'handled', 'level'])

function limpiarTags(t     )      {
  if (!t || typeof t !== 'object') return undefined
  const salida                         = {}
  for (const [k, v] of Object.entries(t)) {
    if (TAGS_OK.has(k) && typeof v === 'string' && /^[\w.+\-: ]{0,64}$/.test(v)) salida[k] = v
  }
  return salida
}

function limpiarSpans(spans     )      {
  if (!Array.isArray(spans)) return undefined
  return spans.map((sp     ) => {
    const s                      = {}
    for (const k of ['span_id', 'trace_id', 'parent_span_id']) if (typeof sp?.[k] === 'string' && FORMA_ID.test(sp[k])) s[k] = sp[k]
    for (const k of ['start_timestamp', 'timestamp']) if (typeof sp?.[k] === 'number') s[k] = sp[k]
    for (const k of ['op', 'origin', 'status']) if (typeof sp?.[k] === 'string' && FORMA_ETIQUETA.test(sp[k])) s[k] = sp[k]
    // La descripción sólo en los pedidos de red: "GET https://…/ruta" sin query.
    if (typeof sp?.op === 'string' && sp.op.startsWith('http') && typeof sp.description === 'string') {
      const m = /^([A-Z]+)\s+(\S+)/.exec(sp.description)
      if (m) s.description = `${m[1]} ${rutaSinQuery(m[2])}`
    }
    return s
  })
}

// Campos del sobre que pasan tal cual: son técnicos (ids de evento, hora, versión,
// símbolos para destripar stacks nativos).
const CAMPOS_PASO = ['sdk', 'debug_meta', 'measurements', 'transaction_info', 'sdkProcessingMetadata']

function camposTecnicos(e     )                      {
  const s                      = {}
  if (typeof e.event_id === 'string' && /^[0-9a-f]{32}$/i.test(e.event_id)) s.event_id = e.event_id
  for (const k of ['timestamp', 'start_timestamp']) if (typeof e[k] === 'number') s[k] = e[k]
  if (typeof e.platform === 'string' && /^[a-z]{2,20}$/.test(e.platform)) s.platform = e.platform
  if (NIVELES.has(e.level)) s.level = e.level
  for (const k of ['environment', 'release', 'dist']) if (typeof e[k] === 'string' && FORMA_VERSION.test(e[k])) s[k] = e[k]
  if (e.type === 'transaction') s.type = 'transaction'
  return s
}

/**
 * Un evento (error o transacción) de Sentry → el evento que SALE. Se construye de cero
 * con la lista blanca; todo lo que no está nombrado acá no viaja.
 */
export function limpiarEvento(evento     )      {
  if (!evento || typeof evento !== 'object') return evento
  const e = evento
  const salida                      = camposTecnicos(e)
  for (const k of CAMPOS_PASO) if (e[k] !== undefined) salida[k] = e[k]

  const codigoExtra = codigoDelExtra(e)

  // user: sólo el id, y sólo si es un UUID.
  if (typeof e.user?.id === 'string' && UUID.test(e.user.id)) salida.user = { id: e.user.id }

  // exception: type + frames + un value que no es el mensaje.
  if (e.exception) salida.exception = limpiarExcepciones(e, codigoExtra)

  // captureMessage
  if (typeof e.message === 'string') salida.message = mensajeSeguro(e.message, codigoExtra)
  if (e.logentry) salida.logentry = { message: mensajeSeguro(e.logentry.message, codigoExtra) }

  // hilos (stacks nativos de la app)
  if (e.threads && Array.isArray(e.threads.values)) {
    salida.threads = {
      values: e.threads.values.map((t     ) => {
        const s                      = {}
        if (typeof t?.id === 'number' || (typeof t?.id === 'string' && FORMA_ID.test(t.id))) s.id = t.id
        for (const k of ['crashed', 'current']) if (typeof t?.[k] === 'boolean') s[k] = t[k]
        const st = limpiarFrames(t?.stacktrace)
        if (st) s.stacktrace = st
        return s
      }),
    }
  }

  const bc = Array.isArray(e.breadcrumbs) ? e.breadcrumbs : Array.isArray(e.breadcrumbs?.values) ? e.breadcrumbs.values : null
  if (bc) salida.breadcrumbs = bc.map(limpiarBreadcrumb)

  // request: URL sin query y método.
  if (e.request && typeof e.request === 'object') {
    const r                      = {}
    const url = rutaSinQuery(e.request.url)
    if (url) r.url = url
    if (typeof e.request.method === 'string' && /^[A-Za-z]{3,7}$/.test(e.request.method)) r.method = e.request.method.toUpperCase()
    if (Object.keys(r).length) salida.request = r
  }

  if (typeof e.transaction === 'string') salida.transaction = rutaSinQuery(e.transaction)
  const contexts = limpiarContextos(e.contexts)
  if (contexts) salida.contexts = contexts
  const tags = limpiarTags(e.tags)
  if (tags) salida.tags = tags
  const spans = limpiarSpans(e.spans)
  if (spans) salida.spans = spans

  // Si alguien fijó una huella a mano, se respeta (son strings nuestros).
  if (Array.isArray(e.fingerprint)) salida.fingerprint = e.fingerprint.filter((f     ) => typeof f === 'string' && /^[\w.:{}-]{1,80}$/.test(f))

  return salida
}

/** Opciones de privacidad compartidas por `Sentry.init` en la web y en la app. */
export const OPCIONES_PRIVADAS   
                       
                                  
                                             
                                   
  = {
  sendDefaultPii: false,
  beforeSend: limpiarEvento,
  beforeSendTransaction: limpiarEvento,
  beforeBreadcrumb: limpiarBreadcrumb,
}
