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
// Las URLs también van por LISTA BLANCA: un segmento de la ruta sale sólo si es un literal
// conocido (la API de Supabase, una tabla, una función, un bucket, una ruta de la app) o un
// UUID; cualquier otro (un nombre de archivo, un DNI, un mail, un nombre) sale como ":dato".
// El storage se corta después del bucket: el nombre del archivo del usuario nunca viaja.
// La lista se regenera con los nombres reales del proyecto (rutas de la web y de la app,
// Edge Functions, tablas y funciones de las migraciones, buckets); los tests avisan si una
// ruta, función o bucket nuevo no está.
export const BUCKETS_CONOCIDOS = new Set        ([
  'avatars', 'ordenes-traslado', 'patient-docs', 'pharmacy-products', 'prescriptions',
  'professional-docs', 'verticales',
])

export const SEGMENTOS_CONOCIDOS = new Set        ([
  '(auth)', '(pro)', '(tabs)', '[category]', '[id]', '[vertical]', 'accept_ondemand_request',
  'acceso-familiar', 'activity_plans', 'actualizar_item_pedido_medicamentos', 'admin',
  'admin_action_log', 'admin_action_log_inmutable', 'admin_grupos_familiares', 'admins', 'agenda',
  'agendar', 'agregar', 'agregar-tarjeta', 'agregar_item_pedido_medicamentos', 'ai-companion',
  'ambulance_crew', 'ambulance_locations', 'ambulance_locations_ahora', 'ambulances',
  'ambulancias', 'amigo-peludo', 'anywhere', 'apple-health', 'apply_debt_recovery',
  'appointment-reminders', 'asignar_emergencia', 'atencion', 'auditoria', 'auth',
  'auth_providers_super_admin', 'auth_user_por_email', 'authenticated', 'authorize',
  'availability_slots', 'avatars', 'avisar_bienvenida_por_mail', 'avisar_cambio_de_correo',
  'avisar_cierre_al_paciente', 'avisar_cierre_de_consulta_por_mail', 'avisar_consulta_cancelada',
  'avisar_consulta_nueva', 'avisar_derivacion_nueva', 'avisar_derivacion_rechazada',
  'avisar_devolucion_al_paciente', 'avisar_disponibilidad_por_vencer',
  'avisar_emergencia_asignada', 'avisar_emergencia_cancelada', 'avisar_emergencia_estado',
  'avisar_estado_al_paciente', 'avisar_falta_precio_por_mail', 'avisar_paciente_esperando',
  'avisar_pago_recibido', 'avisar_pedido_aceptado', 'avisar_pedido_al_paciente',
  'avisar_pedido_de_farmacia_por_mail', 'avisar_pedido_en_cola', 'avisar_pedido_ondemand',
  'avisar_posdatadas_habilitadas', 'avisar_receta_al_paciente', 'avisar_receta_emitida_por_mail',
  'avisar_reserva_por_mail', 'avisar_revision_profesional', 'avisar_turno_agendado',
  'avisar_verificacion_por_mail', 'avisos_consulta_pendientes', 'ayuda', 'bajas_de_usuarios',
  'biometric', 'biovisor', 'biovisor-extract', 'blindar_perfil_desde_el_cliente',
  'block_clinical_delete', 'block_clinical_entry_update', 'block_finalized_scribe_session_delete',
  'bloquear_autoregistro_ministerio', 'bloquear_autoverificacion',
  'bloquear_cambios_tras_rechazo_permanente', 'booking', 'boveda', 'bucket', 'buscar',
  'buscar-alimentos', 'buscar-disponibles', 'buscar_profesionales_cobrables', 'callback',
  'cambio-de-correo', 'camino', 'cancelar_derivacion', 'cancelled', 'canjear_pin_familiar',
  'catalogo', 'cerrar_consultas_colgadas', 'cerrar_emergencia_con_registro', 'challenge',
  'checkout', 'cio', 'clinical-scribe', 'clinical_access_log', 'clinical_allergies',
  'clinical_conditions', 'clinical_encounters', 'clinical_entries',
  'clinical_entries_set_sequence', 'clinical_medications', 'clinical_notes',
  'clinical_observations', 'clinical_scribe_sessions', 'clinical_scribe_sessions_set_updated_at',
  'cobertura-sugerida', 'cobertura_consultas', 'cobertura_rnos', 'coberturas', 'cola_de_despacho',
  'columnas_sensibles_del_profesional', 'comision_efectiva', 'comision_historial_inmutable',
  'comision_propia_vigente', 'comisiones_de_profesionales', 'completar-registro',
  'completar_cierre_de_consulta', 'complete-profile', 'complete_patient_rcta_data', 'comprobantes',
  'configuracion', 'confirmed', 'congelar_atribucion_de_referido', 'congelar_codigo_de_referido',
  'consent', 'consentimientos', 'consulta', 'consulta_cruza_mundos',
  'consulta_de_emergencia_solo_del_modulo', 'consulta_inmediata_late_al_prender', 'consultas',
  'consultation', 'consultation_arrivals', 'consultation_events', 'consultation_orders',
  'consultation_reassignments', 'consultation_types', 'consultation_validation_codes',
  'consultations', 'consultorios', 'coordinador_emergencias', 'copiar_nombre_paciente_emergencia',
  'correo_de_prueba', 'crear_codigo_de_entrega', 'crear_derivacion', 'crear_perfil_al_registrarse',
  'crear_vertical', 'create_validation_code', 'cuenta_dada_de_baja', 'cuentas_compatibles',
  'daily-token', 'dar-de-baja-usuario', 'dar_de_baja_perfil', 'dashboard', 'debt_recoveries',
  'definir_coordinador_emergencias', 'delete-account', 'derivacion_consentimientos',
  'derivaciones', 'despacho', 'diagnostic_reports', 'diff_de_campos', 'documento_es_extranjero',
  'documentos', 'email_change_requests', 'email_de_mi_cuenta', 'email_log', 'emergencia',
  'emergencia_cancelada_es_final', 'emergencia_de_la_carpeta', 'emergencias',
  'emergencias_mismo_mundo', 'emergencies', 'emergency', 'emergency_provider_staff',
  'emergency_providers', 'emergency_tracking', 'emergency_transfer_orders', 'enroll',
  'entidad_de_ambulancia', 'enviar_avisos_de_consulta', 'enviar_mail', 'enviar_mail_reserva',
  'enviar_push', 'enviar_push_tipo', 'es_cuenta_de_prueba', 'es_especialidad_medica',
  'es_operador_de_plataforma', 'es_parte_de_derivacion', 'es_titular_de', 'espera',
  'estado_atencion_emergencia', 'exigir_codigo_de_entrega', 'exigir_mismo_mundo',
  'expire-stale-appointments', 'expire_ondemand_requests', 'expo_push_tokens', 'factors',
  'familiar', 'familiar_pin_intentos', 'familiar_pins', 'familiares_siguen_el_mail_del_titular',
  'family-add', 'family_members', 'family_members_antes', 'family_members_sincronizar_perfil',
  'farmacia', 'farmacia_aplicar_piso_de_receta', 'farmacia_concentraciones',
  'farmacia_drogas_bajo_receta', 'farmacia_item_exige_receta', 'farmacia_items_sin_receta',
  'farmacia_mis_recetas', 'farmacia_pedido_exige_receta', 'farmacia_rango_venta',
  'farmacia_reaplicar_piso', 'farmacia_receta_matchea', 'farmacia_recetas_de',
  'farmacia_recetas_del_pedido', 'farmacia_texto_es_controlado', 'farmacia_unidades_envase',
  'fastpass', 'federador', 'federador-paciente', 'federar_paciente_al_completar',
  'fijar_comision_de_profesional', 'finalize_consultation', 'functions', 'ganancias',
  'generar_codigo_de_referido', 'generar_pin_familiar', 'generate_link', 'get_credit_balance',
  'get_my_role', 'get_professional_pending_debt', 'grupos-familiares', 'guia',
  'has_shared_consultation', 'health', 'historia-clinica', 'historial', 'ia',
  'identidad_federable', 'identities', 'image', 'impedir_autoascenso_de_rol', 'impersonate-user',
  'impersonation_log', 'index', 'info', 'iniciar_atencion_emergencia', 'invite', 'landing',
  'legajo_nace_sin_verificar', 'limpiar_reverificacion_al_verificar', 'list',
  'llamar_edge_function', 'log_alta_de_profesional', 'log_consultation_status_change',
  'log_hitos_del_legajo', 'log_paso_de_onboarding', 'login', 'logout', 'magiclink', 'mails',
  'mantener_onboarding_step_monotono', 'map', 'mapa', 'marcar_aviso_de_consulta',
  'marcar_derivacion_reservada', 'marcar_indicacion_cargada', 'marcar_notas_de_cierre',
  'marcar_notificaciones_leidas', 'marcar_paciente_nuevo', 'marcar_reverificacion_del_profesional',
  'marcar_reverificacion_por_identidad', 'mark_reassignment_owed_paid', 'mark_settlement_paid',
  'medical_documents', 'medication_order_delivery_codes', 'medication_order_items',
  'medication_orders', 'medico-online', 'meta-pauta', 'mi_comision', 'mi_entidad_de_emergencias',
  'mis_referidos', 'mover_vertical', 'movil_de_guardia', 'mp-capture', 'mp-connect', 'mp-payment',
  'mp-refresh-tokens', 'mp-refund', 'mp-save-card', 'mp-webhook', 'mp_accounts', 'mundo_que_veo',
  'no', 'nombre_normalizado', 'notificaciones', 'nutriplan', 'nutriplan-receta',
  'nutrition_plan_adherence', 'nutrition_plans', 'object', 'onboarding', 'ondemand',
  'ondemand-despacho', 'ondemand_request_cobros', 'ondemand_requests', 'opciones_de_despacho',
  'ordenes-traslado', 'order', 'orders', 'otp', 'paciente', 'paciente_de_emergencia_fijo',
  'paciente_del_pedido', 'paciente_paso_onboarding_monotono', 'pacientes', 'pago', 'pagos',
  'patient-docs', 'patient_addresses', 'patient_credits', 'patient_followups',
  'patient_has_completed_consultation', 'patient_waiting_ping', 'pauta', 'payment',
  'payment_methods', 'payments', 'pediatria', 'pedido', 'pedidos', 'perfil', 'pets', 'pharmacies',
  'pharmacy', 'pharmacy-mp-connect', 'pharmacy-products', 'pharmacy_mp_accounts',
  'pharmacy_order_patients', 'pharmacy_products', 'pharmacy_products_sync_in_stock',
  'pharmacy_products_sync_requires_prescription', 'plan-actividad', 'platform_settings',
  'preconsulta', 'prescriptions', 'profesional', 'profesional_puede_recetar',
  'profesional_sigue_la_baja', 'profesional_ve_hc', 'profesionales', 'profesionales_en_atencion',
  'professional-docs', 'professional_commission_changes', 'professional_offline',
  'professional_onboarding_events', 'professional_online_ping', 'professional_profiles',
  'professional_profiles_espejo_de_prueba', 'professional_referral_visits',
  'professional_schedules', 'professional_signatures', 'professional_verification_log', 'profile',
  'profile-edit', 'profiles', 'profiles_marca_de_prueba', 'profiles_propagar_marca_de_prueba',
  'promote_user_to_admin', 'prospects', 'proteger_cobro_emergencia',
  'proteger_desenlace_emergencia', 'proteger_despacho_emergencia', 'proteger_emision_de_receta',
  'proteger_factura_del_profesional', 'proteger_payment_status_consultations',
  'proteger_payment_status_pedidos_medicamentos', 'proteger_requiere_onboarding', 'public',
  'puede_cargar_orden_traslado', 'puede_tomar_ondemand', 'puede_ver_orden_traslado',
  'puedo_actuar_como', 'push_subscriptions', 'queue', 'r', 'rcta-anular', 'rcta-catalog',
  'rcta-issue', 'rcta_issue_log', 'reactivar-cuenta', 'reactivar_perfil', 'realtime',
  'reassign_consultation', 'reauthenticate', 'recalc_professional_rating',
  'recalcular_total_pedido_medicamentos', 'receta', 'recetas', 'rechazar_derivacion', 'recorrido',
  'recover', 'recuperar-contrasena', 'referidos', 'referidos_de_profesional', 'refes-consultorio',
  'register', 'registrar_admin_comision', 'registrar_admin_config', 'registrar_admin_devolucion',
  'registrar_admin_impersonacion', 'registrar_admin_professional_profiles',
  'registrar_admin_profiles', 'registrar_push_token', 'registro', 'registro-profesional',
  'reintentar_registros_ministerio', 'render', 'resend', 'reservar',
  'reset_reminder_on_reschedule', 'resolver_link_de_referido',
  'responder_consentimiento_derivacion', 'rest', 'restablecer-contrasena', 'resumen',
  'resumen_de_referidos', 'review', 'reviews', 'reviews_recalc_rating_trigger',
  'rol_de_servidor_valido', 'rpc', 'sala-espera', 'salud', 'search-professional',
  'selecting-service', 'sellar_cierre_emergencia', 'sellar_orden_traslado', 'send-email',
  'send-push-notification', 'sessions', 'set_updated_at', 'settings', 'sign', 'signup',
  'sin-cobertura-medica', 'sincronizar_nombre_completo', 'sincronizar_pago_de_pedido',
  'sincronizar_rol_de_servidor', 'sisa-verify', 'sos', 'soy_coordinador_emergencias',
  'soy_medico_del_movil', 'soy_paciente_de_ambulancia', 'soy_tripulacion', 'specialties',
  'start_consultation', 'storage', 'subidas', 'summary', 'super-admin', 'sync_has_signature',
  'tarjetas', 'teleclinica', 'tiene_derivacion_con', 'token', 'touch_consultation_arrival',
  'touch_emergency_tracking', 'transicion_consulta_valida', 'triage', 'turno-confirmado', 'upload',
  'upload_log', 'user', 'usuarios', 'v1', 'v2', 'validar_consulta_derivada',
  'validar_piso_precio_consulta', 'validar_transicion_consulta', 'vencer_derivaciones',
  'veo_bajas', 'verificar_codigo_de_cierre', 'verificar_codigo_entrega',
  'verificar_consultorio_al_cambiar', 'verificar_que_puede_recetar', 'verify', 'vertical_settings',
  'verticales', 'video', 'videollamada', 'vitales_fecha_sigue_al_valor', 'waiting', 'waitlist',
  'walk-in', 'walk_in_queue', 'web', 'websocket', 'webview-session', 'zonas', 'zones',
])
const CALIFICADORES_STORAGE = new Set(['image', 'sign', 'public', 'authenticated', 'info', 'upload', 'list'])

function segmentoSeguro(seg        )         {
  if (seg === '') return ''
  if (SEGMENTOS_CONOCIDOS.has(seg) || BUCKETS_CONOCIDOS.has(seg) || UUID.test(seg)) return seg
  return ':dato'
}

/**
 * Una URL o ruta de red/navegación sin query ni fragmento y con SÓLO segmentos conocidos
 * (el resto, ":dato"). En el storage, hasta el bucket. El host sale si tiene forma de host.
 */
export function rutaSinQuery(url     )                     {
  if (typeof url !== 'string' || url === '') return undefined
  const m = /^(https?:\/\/)([^/?#]*)([^?#]*)/i.exec(url)
  let origen = ''
  let ruta = url.split(/[?#]/)[0]
  if (m) {
    const host = m[2].replace(/^.*@/, '')
    origen = m[1] + (/^[a-z0-9.-]{1,120}(:\d{1,5})?$/i.test(host) ? host : ':host')
    ruta = m[3]
  }
  const segs = ruta.split('/')
  const salida           = []
  for (let i = 0; i < segs.length; i++) {
    salida.push(segmentoSeguro(segs[i]))
    // storage: /storage/v1/(object|render)/[image/][sign|public|authenticated/]<bucket>/<archivo del usuario…>
    if (segs[i] === 'storage' && segs[i + 1] === 'v1' && (segs[i + 2] === 'object' || segs[i + 2] === 'render')) {
      salida.push('v1', segs[i + 2])
      let j = i + 3
      while (j < segs.length && CALIFICADORES_STORAGE.has(segs[j])) salida.push(segs[j++])
      if (j < segs.length) salida.push(BUCKETS_CONOCIDOS.has(segs[j]) ? segs[j] : ':dato')
      break   // todo lo que sigue al bucket es el nombre del archivo
    }
  }
  const t = origen + salida.join('/')
  return t.length > 200 ? `${t.slice(0, 200)}…` : t
}

/** El archivo de un frame del stack (bundle, módulo): sin query y con una forma técnica; si no, no viaja. */
export function archivoSeguro(f     )                     {
  if (typeof f !== 'string' || f === '') return undefined
  const t = f.split(/[?#]/)[0]
  return FORMA_ARCHIVO.test(t) ? t : undefined
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
        const r = archivoSeguro(f[k])
        if (r) s[k] = r
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
