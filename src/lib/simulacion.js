/**
 * Simulación de videollamada — una consulta de mentira para que el profesional
 * conozca el panel clínico antes de tener a un paciente real del otro lado.
 *
 * Hoy la única forma de ver el panel es tener una consulta agendada: se aprende
 * encima de un paciente. Esto abre el **mismo** panel (no una maqueta aparte,
 * que se desactualizaría a la primera semana) con un paciente inventado y una
 * guía paso a paso encima.
 *
 * ── La regla que ordena todo esto ────────────────────────────────────────────
 *
 * **La simulación no escribe una sola fila.** Decisión de Mateo (2026-08-31):
 * corre igual en staging y en producción, y en producción una consulta de
 * práctica que se guardara ensuciaría las estadísticas, las ganancias, el panel
 * del super admin y —lo peor— la historia clínica de un paciente que no existe.
 *
 * **Cómo se garantiza, y por qué así.** Los ids de la simulación son constantes
 * reservadas (`simulacion`, `simulacion-encuentro`, `simulacion-paciente`) que
 * nunca pueden chocar con un uuid. Los servicios que tocan la base cortan al
 * principio del método cuando reciben uno: `if (esSimulado(id)) return …`.
 *
 * La alternativa era pasarle a `VideoCall.jsx` y a sus seis componentes hijos un
 * juego de servicios falsos por props o por contexto. Se descartó: son 1738
 * líneas y el panel clínico escribe desde media docena de lugares, así que
 * alcanzaba con que UNO quedara sin cablear para que la práctica escribiera en
 * la historia clínica de producción. Con el corte en el servicio, el camino a la
 * base no existe para un id simulado, lo cablee quien lo cablee. El costo es que
 * la palabra `esSimulado` aparece en cuatro servicios; `grep esSimulado src/`
 * muestra la valla entera.
 *
 * **La única excepción es la receta**, y es a propósito — ver `EMITE_AL_SANDBOX`.
 */

// ── Ids reservados ───────────────────────────────────────────────────────────
// `simulacion` es también el `:id` de la ruta `/profesional/videollamada/:id`,
// así que no hace falta ninguna ruta nueva ni tocar el guard de rol.
export const ID_CONSULTA   = 'simulacion'
export const ID_ENCUENTRO  = 'simulacion-encuentro'
export const ID_PACIENTE   = 'simulacion-paciente'

const IDS = new Set([ID_CONSULTA, ID_ENCUENTRO, ID_PACIENTE])

/**
 * Quién está practicando. Lo setea `VideoCall.jsx` al montar en modo simulación
 * y lo limpia al desmontar.
 *
 * Es estado de módulo y no un contexto de React a propósito: quienes lo
 * necesitan son los **servicios** (`consultationsService.getById` y compañía),
 * que no son componentes y no pueden leer un contexto. Y hace falta porque el
 * profesional tiene que verse a sí mismo en el panel — su nombre, su matrícula,
 * su especialidad —: una simulación con un profesional genérico no enseña a
 * reconocer lo propio, que es medio punto del ejercicio. No hay riesgo de fuga
 * entre sesiones: vive en el tab del navegador y sólo lo leen métodos que ya
 * cortaron por `esSimulado`.
 */
let ctx = {}

export function iniciar({ profile, profProfile } = {}) { ctx = { profile, profProfile } }
export function terminar() { ctx = {}; recetas = []; observaciones = [] }

/**
 * La valla. La usan `consultationsService`, `clinicalService`,
 * `historiaClinicaService` y `profilesService` para cortar antes de tocar
 * Supabase.
 */
export const esSimulado = id => IDS.has(id)

/**
 * La receta **sí** sale de verdad, pero siempre contra homologación — aun
 * corriendo en producción (decisión de Mateo, 2026-08-31). Es la única parte de
 * la simulación que habla con un servicio externo.
 *
 * Por qué vale la pena la excepción: el recetario es el módulo más difícil y el
 * único donde equivocarse tiene consecuencias legales, así que es justo el que
 * conviene practicar entero, con el PDF real al final. Y por qué es seguro:
 * emitir en homologación **no** genera un acto médico válido —es el mismo
 * ambiente donde se hizo la certificación, con matrículas inventadas— mientras
 * que emitir en producción sí. `rcta-issue` recibe `simulacion: true` y usa los
 * secrets `RCTA_HML_*`; si no están cargados, corta con un error explícito en
 * vez de caer en los de producción.
 */
export const EMITE_AL_SANDBOX = true

/**
 * El código que el paciente le dicta al profesional para cerrar la consulta
 * (migración 099). En la simulación es fijo y la guía lo muestra: el ejercicio
 * es ver dónde se pide y qué pasa al errarle, no adivinar cuatro dígitos.
 */
export const CODIGO_DE_CIERRE = '1234'

// ── El paciente ──────────────────────────────────────────────────────────────
// Con DNI, sexo y fecha de nacimiento reales-en-forma: son los tres datos que
// la receta electrónica exige, así que sin ellos el paso del recetario se
// tropezaría con el cartel de "faltan datos" en vez de dejar practicar.
// El DNI arranca con 99 — rango que no se asigna — para que nadie lo confunda
// con una persona.
export const PACIENTE = {
  id: ID_PACIENTE,
  fullName: 'Paciente de práctica',
  email: 'practica@healthier.app',
  phone: '+54 9 11 0000-0000',
  dni: '99000001',
  gender: 'femenino',
  birthDate: '1985-03-14',
  avatarUrl: null,
  bloodType: 'A+',
  heightCm: 165,
  weightKg: 68,
  coverageType: 'particular',
  financiadorId: null,
  insuranceName: null,
  insuranceNum: null,
  emergencyName: 'Contacto de práctica',
  emergencyPhone: '+54 9 11 0000-0001',
  emergencyRel: 'Hermano',
}

// Lo que el paciente declaró antes de entrar. Se eligió un motivo que atraviesa
// todo el panel: da para cargar signos vitales, un diagnóstico con código y una
// receta — o sea, deja practicar el recorrido completo y no un pedacito.
const PRECONSULTA = {
  version: 2,
  motivo: 'Dolor de garganta y fiebre',
  sintomas: [
    'Dolor al tragar desde hace 3 días',
    'Fiebre de 38,2 °C anoche',
    'Ganglios del cuello hinchados',
  ],
  desde: 'hace 3 días',
  medicacion_actual: 'Ibuprofeno 400 mg cada 8 h por su cuenta',
}

/**
 * La consulta. Se arma con el profesional que está practicando —su nombre, su
 * especialidad y su matrícula salen en el panel y en la receta, y verlos ahí es
 * parte de lo que se viene a comprobar.
 */
export function consulta() {
  const { profile, profProfile } = ctx
  const ahora = new Date().toISOString()
  return {
    id: ID_CONSULTA,
    patientId: ID_PACIENTE,
    professionalId: profile?.id ?? null,
    status: 'confirmed',
    modality: 'video',
    scheduledAt: ahora,
    startedAt: ahora,
    completedAt: null,
    closingNotes: null,
    durationMinutes: 30,
    priceAtBooking: profProfile?.priceVideo ?? profProfile?.sessionPrice ?? 0,
    paymentStatus: 'paid',
    paidAt: ahora,
    vertical: 'salud',
    isOnDemand: false,
    coverageType: 'particular',
    financiadorId: null,
    obraSocialName: null,
    affiliateNumber: null,
    preconsultaData: PRECONSULTA,
    // El paciente ya está esperando y todavía sin habilitar: así el primer paso
    // de la guía ("ingresá al paciente") tiene algo real que hacer, que es el
    // botón que más consultas de soporte genera.
    patientWaitingSince: ahora,
    patientAdmittedAt: null,
    patient: PACIENTE,
    professional: {
      fullName: profile?.fullName ?? 'Profesional',
      avatarUrl: profile?.avatarUrl ?? null,
      professionalProfiles: [{ specialty: profProfile?.specialty ?? 'otra' }],
    },
    consultationType: null,
    payment: [],
  }
}

// ── Historia clínica previa ──────────────────────────────────────────────────
// Un encuentro cerrado hace tres meses. Existe para que la pestaña de Historia
// Clínica no esté vacía: un panel vacío no enseña a leerlo, y lo que hay que
// aprender es justamente a mirar el antecedente antes de recetar (acá, la
// alergia a la penicilina, que choca de frente con lo que uno recetaría para
// una angina).
export function historia() {
  const haceTresMeses = new Date(Date.now() - 90 * 86400000).toISOString()
  return {
    encounters: [{
      id: 'simulacion-encuentro-previo',
      patientId: ID_PACIENTE,
      status: 'finished',
      specialty: 'medicina_general',
      modality: 'telemedicina',
      startedAt: haceTresMeses,
      finishedAt: haceTresMeses,
      createdAt: haceTresMeses,
      professional: {
        fullName: 'Dr. Consulta anterior',
        avatarUrl: null,
        professionalProfiles: [{ specialty: 'medicina_general' }],
      },
      entries: [{
        id: 'simulacion-entrada-previa',
        encounterId: 'simulacion-encuentro-previo',
        entryType: 'consultation',
        sequenceNumber: 1,
        createdAt: haceTresMeses,
        content: [
          'Motivo: Control anual',
          '',
          'Antecedentes: sin enfermedades crónicas. No fuma.',
          '',
          'Vitales: TA 118/76 · FC 72 lpm · SatO2 98%',
          '',
          'Diagnóstico:',
          '- Examen periódico de salud (Z00.0)',
        ].join('\n'),
      }],
      conditions: [],
      medications: [],
    }],
    // A nivel paciente, no del encuentro — es como lo devuelve el servicio real.
    allergies: [{
      id: 'simulacion-alergia',
      patientId: ID_PACIENTE,
      allergen: 'Penicilina',
      allergyType: 'medicamento',
      severity: 'severa',
      reaction: 'Urticaria generalizada',
      clinicalStatus: 'active',
      createdAt: haceTresMeses,
      professional: { fullName: 'Dr. Consulta anterior' },
    }],
  }
}

/** El encuentro de ESTA consulta, ya abierto: la simulación no crea nada. */
export function encuentro() {
  const { profile, profProfile } = ctx
  return {
    id: ID_ENCUENTRO,
    patientId: ID_PACIENTE,
    professionalId: profile?.id ?? null,
    consultationId: ID_CONSULTA,
    specialty: profProfile?.specialty ?? 'otra',
    modality: 'telemedicina',
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    professionalLicenseType: profProfile?.licenseType ?? 'MN',
    professionalLicenseNumber: profProfile?.licenseNumber ?? '0',
    entries: [],
    conditions: [],
    allergies: [],
    medications: [],
    observations: [],
  }
}

/**
 * Devuelve la "fila" que el servicio real habría creado, sin crearla.
 *
 * Los componentes del panel clínico esperan que un `add*` les devuelva algo con
 * `id` y `createdAt` para pintarlo en la lista al instante. Devolver `null`
 * dejaría la nota escrita en pantalla y desaparecida al re-renderizar, y el
 * profesional aprendería que "guardar no funciona". Con el eco, la práctica se
 * comporta igual que la consulta real hasta que recarga la página.
 */
let contador = 0
export function eco(fila) {
  contador += 1
  return {
    id: `simulacion-fila-${contador}`,
    createdAt: new Date().toISOString(),
    sequenceNumber: contador,
    ...fila,
  }
}

// ── Lo que el profesional carga durante la práctica ──────────────────────────
// Vive en memoria de módulo y se limpia al salir (`terminar()`). Es lo que hace
// que guardar una receta o un signo vital se comporte como en una consulta real
// —aparece en la lista, se puede emitir— sin que exista una fila en ningún lado.
let recetas = []
let observaciones = []

export const recetasDePractica = () => recetas
export const observacionesDePractica = () => observaciones

export function guardarRecetaDePractica(fila) {
  const guardada = eco({ ...fila, status: 'active', rcta_status: null })
  recetas = [guardada, ...recetas]
  return guardada
}

/**
 * Deja las recetas de la práctica en `issued` con el PDF que devolvió
 * homologación. Existe porque el camino de éxito de `PrescriptionCreator`
 * **releé la receta guardada** para confirmar que quedó emitida, en vez de
 * confiar en el 200 (un éxito que el profesional no puede contrastar es peor
 * que un error — ver el comentario ahí). Esa verificación también vale en la
 * práctica, así que la simulación la satisface de verdad en vez de saltearla.
 */
export function marcarRecetaEmitida(ids, { prescriptionId, pdfUrl, issuedAt, transactionId } = {}) {
  recetas = recetas.map(rx => ids.includes(rx.id)
    ? { ...rx, rcta_status: 'issued', rcta_prescription_id: prescriptionId ?? null,
        rcta_pdf_url: pdfUrl ?? null, rcta_transaction_id: transactionId ?? null,
        rcta_issued_at: issuedAt ?? new Date().toISOString() }
    : rx)
  return recetas
}

export function guardarObservacionDePractica(fila) {
  const guardada = eco({ ...fila, observed_at: new Date().toISOString() })
  observaciones = [...observaciones, guardada]
  return guardada
}

// ── El SDK de video ──────────────────────────────────────────────────────────
/**
 * Daily de mentira: mismo contrato que `DailyIframe.createCallObject()`, sin
 * sala ni red.
 *
 * Se hace así y no abriendo una sala real por dos razones: Daily se cobra por
 * minuto —y esto va a correr muchas veces, es una herramienta de práctica— y del
 * otro lado no hay nadie, así que una sala real mostraría exactamente lo mismo
 * que ésta, un solo participante.
 *
 * Es hermano del mock de `tests/fixtures/daily-mock.js`, que hace lo mismo para
 * los e2e. Se dejaron separados a propósito: aquél se inyecta con
 * `page.addInitScript` y no puede importar del bundle, y además necesita
 * demoras pensadas para el doble montaje de React Strict Mode. Fundirlos ataría
 * la herramienta que usa el profesional a las necesidades de la suite de tests.
 */
/**
 * Pistas de video de verdad, sin sala y sin nadie del otro lado.
 *
 * `VideoTile` hace `new MediaStream([track])`, así que los tracks tienen que ser
 * `MediaStreamTrack` reales — un objeto de mentira revienta la pantalla entera
 * (lo encontró la prueba en browser, con el ErrorBoundary de por medio).
 *
 *  · **La propia** sale de la cámara real. Es parte de lo que se viene a
 *    practicar: cómo se lo ve, si se le ve la cara, si el encuadre sirve. Si no
 *    hay permiso o no hay cámara, cae al lienzo de abajo.
 *  · **La de la paciente** sale de un `<canvas>` con `captureStream()`, que
 *    también da un track real. Un video pregrabado habría sido más lindo pero
 *    implica un archivo pesado en el bundle y una persona de verdad grabada.
 */
function pistaDeLienzo(texto) {
  const lienzo = document.createElement('canvas')
  lienzo.width = 640
  lienzo.height = 360
  const ctx2d = lienzo.getContext('2d')

  // Un latido lento en vez de un cuadro congelado: quieto parece la llamada
  // colgada, que es justo la duda que uno quiere sacarse practicando.
  let t = 0
  const dibujar = () => {
    t += 0.02
    const pulso = 0.5 + 0.5 * Math.sin(t)
    ctx2d.fillStyle = '#27272a'
    ctx2d.fillRect(0, 0, 640, 360)
    ctx2d.beginPath()
    ctx2d.arc(320, 150, 52, 0, Math.PI * 2)
    ctx2d.fillStyle = `rgba(124, 179, 139, ${0.25 + pulso * 0.2})`
    ctx2d.fill()
    ctx2d.fillStyle = '#ffffff'
    ctx2d.font = '600 40px system-ui, sans-serif'
    ctx2d.textAlign = 'center'
    ctx2d.fillText('P', 320, 165)
    ctx2d.font = '16px system-ui, sans-serif'
    ctx2d.fillStyle = 'rgba(255,255,255,0.55)'
    ctx2d.fillText(texto, 320, 250)
  }
  dibujar()
  const reloj = setInterval(dibujar, 60)

  const [pista] = lienzo.captureStream(15).getVideoTracks()
  // Cuando el track se termina (al colgar), se apaga el dibujo: si no, queda un
  // `setInterval` por cada práctica que se abrió en la pestaña.
  pista.addEventListener('ended', () => clearInterval(reloj))
  const detenerOriginal = pista.stop.bind(pista)
  pista.stop = () => { clearInterval(reloj); detenerOriginal() }
  return pista
}

async function pistasPropias() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    return { video: stream.getVideoTracks()[0] ?? null, audio: stream.getAudioTracks()[0] ?? null }
  } catch {
    // Sin permiso de cámara la práctica tiene que seguir: se ve el lienzo en vez
    // de la cara propia y el resto del recorrido queda igual.
    return { video: pistaDeLienzo('Tu cámara está apagada'), audio: null }
  }
}

export function dailyDeMentira() {
  function crear() {
    const escuchas = {}
    let propias = { video: null, audio: null }
    let dePaciente = null
    let camara = true
    let microfono = true
    const emitir = (evento, carga) => escuchas[evento]?.forEach(fn => fn(carga))

    const yo = () => ({
      local: true,
      session_id: 'sim-local',
      user_name: 'Vos',
      tracks: {
        video: { persistentTrack: camara ? propias.video : null, state: camara && propias.video ? 'playable' : 'off' },
        audio: { persistentTrack: microfono ? propias.audio : null, state: microfono ? 'playable' : 'off' },
      },
    })
    const paciente = () => ({
      local: false,
      session_id: 'sim-paciente',
      user_name: PACIENTE.fullName,
      tracks: {
        video: { persistentTrack: dePaciente, state: 'playable' },
        // Sin audio: reproducir una voz inventada en una consulta de práctica
        // confunde más de lo que enseña.
        audio: { persistentTrack: null, state: 'off' },
      },
    })

    const call = {
      on(evento, fn) { (escuchas[evento] ??= []).push(fn); return call },
      off(evento, fn) { escuchas[evento] = (escuchas[evento] ?? []).filter(f => f !== fn); return call },
      async join() {
        propias = await pistasPropias()
        emitir('joined-meeting', { participants: { local: yo() } })
        // La paciente "entra" un segundo después, como pasa de verdad: sin esa
        // demora nunca se ve la pantalla de "conectando sala", que es una de las
        // que genera dudas.
        setTimeout(() => {
          dePaciente = pistaDeLienzo(PACIENTE.fullName)
          emitir('participant-joined', { participant: paciente() })
        }, 1200)
        return {}
      },
      participants() { return { local: yo() } },
      async setLocalVideo(on) {
        camara = on
        if (propias.video) propias.video.enabled = on
        emitir('participant-updated', { participant: yo() })
      },
      async setLocalAudio(on) {
        microfono = on
        if (propias.audio) propias.audio.enabled = on
        emitir('participant-updated', { participant: yo() })
      },
      localVideo() { return camara },
      localAudio() { return microfono },
      async leave() {
        propias.video?.stop()
        propias.audio?.stop()
        dePaciente?.stop()
        emitir('left-meeting', {})
      },
      async destroy() {
        propias.video?.stop()
        propias.audio?.stop()
        dePaciente?.stop()
      },
    }
    return call
  }

  return { createCallObject: crear }
}
