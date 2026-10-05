/**
 * El texto de la guía de uso, rol por rol. Las capturas salen de
 * scripts/guia/ (web: capturas.mjs, app: capturas-app.mjs) y las marcas
 * numeradas se miden solas sobre la pantalla (marcas.json): acá sólo va qué
 * dice cada número. El número tiene que coincidir con el de scripts/guia/tomas.mjs
 * (web) o tomas-app.mjs (app); scripts/prueba-guia.mjs lo controla.
 *
 * Copy en castellano rioplatense, de cara a quien usa la plataforma: lo que se
 * puede hacer y cómo. Nunca el nombre del proveedor de recetas.
 *
 * Forma de cada guía:
 *   slug, nombre, para, mision, bajada, ficha [[k, v]], dia [{titulo, texto}],
 *   viajes [VIAJE_*], puede [{titulo, texto, ir}], secciones [Seccion],
 *   faq [{p, r}], glosario [clave de GLOSARIO], ayuda
 * Seccion: { id, titulo, bajada, captura?, grupo?, marcas?: {n: texto},
 *   pasos?: [texto], tips?: [{tipo: 'tip'|'ojo', texto}] }
 */

// ── Cómo viaja cada cosa: el mismo recorrido para todos, cambia dónde está cada uno ──
export const VIAJE_CONSULTA = {
  titulo: 'Cómo viaja una consulta',
  pasos: [
    { rol: 'paciente', titulo: 'El paciente la pide', texto: 'Saca un turno o pide atención inmediata, y paga con Mercado Pago.' },
    { rol: 'profesional', titulo: 'El profesional atiende', texto: 'Lo hace pasar a la sala, carga la historia clínica y receta.' },
    { rol: 'paciente', titulo: 'Se cierra con un código', texto: 'El paciente comparte su código y recibe el resumen y la receta.' },
    { rol: 'farmacia', titulo: 'La farmacia la entrega', texto: 'Si el paciente compra lo recetado, la farmacia lo prepara y lo envía.' },
    { rol: 'super-admin', titulo: 'Healthier lo sigue', texto: 'Pagos, verificaciones y avisos, todo a la vista del equipo.' },
  ],
}

export const VIAJE_PEDIDO = {
  titulo: 'Cómo viaja un pedido de farmacia',
  pasos: [
    { rol: 'profesional', titulo: 'El profesional receta', texto: 'Emite la receta electrónica en la consulta.' },
    { rol: 'paciente', titulo: 'El paciente compra', texto: 'Desde la receta o el catálogo, elige la dirección y paga.' },
    { rol: 'farmacia', titulo: 'La farmacia lo prepara', texto: 'Lo pasa a "En preparación" y después a "Enviado".' },
    { rol: 'paciente', titulo: 'Llega con un código', texto: 'El paciente le dice su código de 4 números a quien entrega.' },
    { rol: 'farmacia', titulo: 'La farmacia lo cierra', texto: 'Carga el código y el pedido queda entregado.' },
  ],
}

export const VIAJE_EMERGENCIA = {
  titulo: 'Cómo viaja una emergencia',
  pasos: [
    { rol: 'paciente', titulo: 'El paciente pide S.O.S.', texto: 'Reserva el monto en su tarjeta y cuenta qué le pasa.' },
    { rol: 'emergencias', titulo: 'Coordinación asigna', texto: 'Le llega el aviso y elige el móvil más conveniente.' },
    { rol: 'emergencias', titulo: 'La tripulación sale', texto: 'Acepta, navega y el paciente la ve llegar en el mapa.' },
    { rol: 'profesional', titulo: 'El médico atiende', texto: 'En el lugar, con el mismo panel clínico de la videoconsulta.' },
    { rol: 'emergencias', titulo: 'Se cierra el traslado', texto: 'El móvil vuelve a estar disponible y se cobra el servicio.' },
  ],
}

export const GLOSARIO = {
  'Consulta inmediata': 'Atención por videollamada sin turno: te atiende un profesional disponible en ese momento. Se reserva el monto y se cobra al terminar.',
  Turno: 'Una consulta agendada con día y hora, virtual o presencial. Se paga al reservar.',
  'Sala de espera': 'Donde espera el paciente antes de la videollamada. Entra cuando el profesional lo hace pasar.',
  'Pre-consulta': 'Las preguntas que contesta el paciente antes de entrar: qué le pasa, desde cuándo, qué toma.',
  'Código de cierre': 'Cuatro números que tiene el paciente y confirman que la consulta ocurrió. El profesional los carga al cerrarla.',
  'Receta electrónica': 'La receta con validez legal que emite el profesional desde la plataforma. Le llega al paciente en PDF.',
  'Historia clínica': 'El registro de cada consulta: notas, diagnósticos, alergias y medicación. La escriben los profesionales y el paciente la puede leer.',
  Bóveda: 'El lugar del paciente donde está todo lo médico: historia clínica, recetas, estudios, planes y mascotas.',
  BioVisor: 'La parte de la bóveda donde el paciente sube sus análisis de sangre y ve cómo evolucionan sus valores.',
  NutriPlan: 'El plan de alimentación que arma el nutricionista y el paciente va tildando día a día.',
  'Grupo familiar': 'Los familiares a cargo de un paciente (hijos, padres). Cada uno tiene su propia historia clínica y entra con un código.',
  'Código familiar': 'Seis números que genera el titular para que un familiar entre a su cuenta sin contraseña. Vence a los 15 minutos.',
  'Healthy Credits': 'Saldo a favor en Healthier. Llega cuando se aprueba una devolución y sirve para pagar turnos.',
  'Mercado Pago': 'Con lo que se cobra todo en Healthier. La plata va directo a la cuenta del profesional o de la farmacia.',
  Comisión: 'La parte de cada cobro que queda para Healthier. Hoy es el 20%.',
  'Horas hábiles': 'Las horas de lunes a viernes. Con ellas se cuenta la anticipación para cancelar con devolución.',
  'Disponible ahora': 'El estado del profesional que tiene prendida la consulta inmediata. Dura una hora y se renueva solo mientras usa la plataforma.',
  'En sala': 'La marca que ve el profesional cuando el paciente ya está esperando.',
  'Ingresar paciente': 'El botón con el que el profesional hace pasar al paciente a la videollamada.',
  Verificación: 'La revisión que hace Healthier de la matrícula y los documentos antes de que un profesional reciba pacientes.',
  Firma: 'La firma del profesional, cargada una sola vez. Sin ella no se emiten recetas.',
  Vademécum: 'El listado oficial de medicamentos. La receta se arma eligiendo de ahí.',
  'Obra social': 'La cobertura del paciente (obra social o prepaga). Se elige del listado, no se escribe a mano.',
  Referido: 'El link personal del profesional para invitar a sus pacientes a Healthier.',
  Pedido: 'Una compra en la farmacia. Pasa por pendiente, en preparación, enviado y entregado.',
  'Código de entrega': 'Cuatro números que ve el paciente cuando su pedido está en camino. La farmacia los carga al entregar.',
  Catálogo: 'Los productos de la farmacia con su precio y stock. Se carga con un Excel.',
  Bonificado: 'Un pedido o una consulta sin cargo para el paciente.',
  'S.O.S.': 'El botón rojo del paciente para pedir una ambulancia.',
  Triage: 'Cómo se clasifica la gravedad de una emergencia: código rojo, amarillo o verde.',
  Móvil: 'Una ambulancia de la flota, con su patente, su tipo y su tripulación.',
  Tripulación: 'Quienes van en el móvil: médico, enfermero y chofer.',
  'Código de despacho': 'El número de cada traslado, con la forma UTM-1234.',
  Coordinador: 'Quien recibe el aviso de cada pedido de ambulancia y la asigna.',
  Reserva: 'El monto que se toma de la tarjeta sin cobrarlo todavía. Se cobra al terminar o se libera solo.',
  Vertical: 'Cada área de atención: Clínica, Pediatría, Nutrición, Salud Mental, Veterinaria.',
  Prospecto: 'Alguien que creó la cuenta y todavía no terminó de registrarse.',
  Auditoría: 'El registro de quién consultó o escribió cada historia clínica y de cada receta emitida.',
  Zona: 'Un barrio donde Healthier atiende presencial. Fuera de las zonas hay lista de espera.',
}

// ═══════════════════════════════════════════════════════════════════════════
// PACIENTE — sobre todo la app
// ═══════════════════════════════════════════════════════════════════════════
const paciente = {
  slug: 'paciente',
  nombre: 'Paciente',
  para: 'Pacientes',
  mision: 'Tu salud, cuando la necesitás, desde el teléfono.',
  bajada: 'Hablás con un médico en minutos o sacás turno con quien elijas, pagás con Mercado Pago, recibís tu receta y la comprás sin salir de casa. Tu historia clínica, tus estudios y los de tu familia quedan en un solo lugar.',
  ficha: [['Entrás con', 'Tu mail, Google o Apple'], ['Desde', 'La app (y la web)'], ['Tu pantalla clave', 'Inicio'], ['Para aprenderla', 'Unos 10 minutos']],
  dia: [
    { titulo: 'Abrís el inicio', texto: 'Ves tu próximo turno, tus avisos y quién está disponible ahora.' },
    { titulo: 'Pedís atención', texto: 'Consulta inmediata o turno con el profesional que elijas.' },
    { titulo: 'Entrás a la sala', texto: 'Contestás la pre-consulta y esperás a que te hagan pasar.' },
    { titulo: 'Te atienden', texto: 'Por videollamada, y al final compartís tu código.' },
    { titulo: 'Recibís todo', texto: 'Resumen, receta y, si querés, la compra en la farmacia.' },
  ],
  viajes: [VIAJE_CONSULTA, VIAJE_PEDIDO],
  puede: [
    { titulo: 'Atenderte ya', texto: 'Un médico disponible en minutos, sin turno.', ir: 'inmediata' },
    { titulo: 'Sacar turno', texto: 'Virtual o presencial, con quien elijas.', ir: 'reservar' },
    { titulo: 'Seguir tus turnos', texto: 'Entrar a la sala, cancelar y pedir devolución.', ir: 'turnos' },
    { titulo: 'Hacer la videollamada', texto: 'Desde la app, con tu código de cierre.', ir: 'videollamada' },
    { titulo: 'Ver tus recetas', texto: 'En PDF, y comprarlas en un toque.', ir: 'recetas' },
    { titulo: 'Leer tu historia clínica', texto: 'Cada consulta, con notas, diagnósticos y medicación.', ir: 'historia' },
    { titulo: 'Guardar tus estudios', texto: 'Análisis, planes y todo lo médico en tu bóveda.', ir: 'boveda' },
    { titulo: 'Comprar en la farmacia', texto: 'Con envío y seguimiento del pedido.', ir: 'farmacia' },
    { titulo: 'Cuidar a tu familia', texto: 'Turnos e historia de cada familiar, y un código para que entren.', ir: 'familia' },
    { titulo: 'Pedir una ambulancia', texto: 'El botón S.O.S., para cuando es urgente.', ir: 'sos' },
  ],
  secciones: [
    {
      id: 'inicio', titulo: 'El inicio', captura: 'pac-app-inicio', grupo: 'Atenderte',
      bajada: 'Es lo primero que ves al abrir la app. Desde acá llegás a todo lo demás.',
      marcas: {
        1: 'Tu carrito de farmacia y tus avisos: la campanita muestra cuántos tenés sin leer.',
        2: 'Tu próximo turno: cuando falta poco, entrás a la sala desde acá.',
        3: 'Atención inmediata: un médico disponible ahora, sin turno.',
        4: 'La barra de abajo: Inicio, Turnos, Bóveda y Perfil. El + busca un profesional.',
      },
      tips: [{ tipo: 'tip', texto: 'Más abajo: tu pedido de farmacia en curso, los profesionales cerca tuyo, tu historia clínica, tus recetas y el botón S.O.S.' }],
    },
    {
      id: 'inmediata', titulo: 'Consulta inmediata', captura: 'pac-ondemand', grupo: 'Atenderte',
      bajada: 'Para cuando necesitás hablar con un médico ahora. Elegís la especialidad y te atiende el primer profesional disponible.',
      marcas: {
        1: 'La especialidad y el profesional que te va a atender.',
        2: 'El precio de la consulta.',
        3: 'La tarjeta con la que se reserva el monto.',
        4: 'Pagar e iniciar: se reserva el monto y vas a la sala de espera.',
      },
      pasos: [
        'En el inicio, tocá "Empezar" en la especialidad que necesitás.',
        'Revisá el profesional asignado y el precio.',
        'Elegí la tarjeta y tocá "Pagar e iniciar".',
        'Tocá "Continuar" para ir a la sala de espera.',
      ],
      tips: [
        { tipo: 'tip', texto: 'El monto se reserva en tu tarjeta y se cobra recién cuando termina la consulta. Si nadie te atiende, no se cobra nada.' },
        { tipo: 'tip', texto: 'Si el profesional tarda, podés esperar unos minutos más o probar con otro profesional, sin pagar de nuevo.' },
      ],
    },
    {
      id: 'reservar', titulo: 'Sacar un turno', captura: 'pac-reservar', grupo: 'Atenderte',
      bajada: 'Elegís especialidad, modalidad, profesional, día y hora. El turno queda confirmado cuando se acredita el pago.',
      marcas: {
        1: 'Cómo querés atenderte: por videollamada o en el consultorio.',
        2: 'Para vos o para alguien de tu grupo familiar.',
        3: 'Continuar al profesional, el día y la hora.',
      },
      pasos: [
        'Elegí la especialidad.',
        'Elegí "Videoconsulta" o "Presencial".',
        'Elegí el profesional y mirá su perfil y sus reseñas.',
        'Elegí el día y uno de los horarios libres.',
        'Revisá el resumen y tocá "Ir al pago".',
      ],
      tips: [{ tipo: 'tip', texto: 'Los horarios son de a 15 minutos y en hora de Buenos Aires. Para hoy, se reserva con al menos una hora de anticipación.' }],
    },
    {
      id: 'pago', titulo: 'Pagar con Mercado Pago', captura: 'pac-pago', grupo: 'Atenderte',
      bajada: 'Pagás con una tarjeta guardada o con una nueva. Si tenés Healthy Credits, se descuentan solos.',
      marcas: {
        1: 'El resumen del turno: profesional, día, hora y modalidad.',
        2: 'Tus Healthy Credits, si tenés saldo a favor.',
        3: 'Tus tarjetas guardadas, o pagar con una nueva.',
        4: 'Confirmar y pagar.',
      },
      tips: [{ tipo: 'tip', texto: 'Healthier sólo guarda la marca y los últimos 4 números de tu tarjeta. El pago lo procesa Mercado Pago.' }],
    },
    {
      id: 'turnos', titulo: 'Tus turnos', captura: 'pac-app-turnos', grupo: 'Atenderte',
      bajada: 'Todos tus turnos, los que vienen y los que ya pasaron. Desde acá entrás a la sala o cancelás.',
      marcas: {
        1: 'Próximos e historial.',
        2: 'Cada turno con el profesional, el día, la hora y el estado.',
        3: 'Entrar a la sala cuando falta poco, o ver cómo llegar si es presencial.',
      },
    },
    {
      id: 'cancelar', titulo: 'Cancelar y pedir la devolución', captura: 'pac-cancelar', grupo: 'Atenderte',
      bajada: 'Si cancelás con anticipación, pedís la devolución en el mismo paso y la recibís en Healthy Credits.',
      marcas: {
        1: 'Si te corresponde devolución según la anticipación.',
        2: 'Un motivo, si querés contarlo.',
        3: 'Cancelar y pedir la devolución.',
      },
      pasos: [
        'En Turnos, tocá "Cancelar" en el turno.',
        'Mirá si te corresponde devolución.',
        'Tocá "Sí, cancelar y solicitar devolución".',
        'El equipo la revisa y te acredita los Healthy Credits.',
      ],
      tips: [
        { tipo: 'tip', texto: 'La anticipación se cuenta en horas hábiles, de lunes a viernes. Hoy son 48.' },
        { tipo: 'tip', texto: 'Los Healthy Credits se pueden pasar a plata por Mercado Pago, con un pedido desde Turnos.' },
      ],
    },
    {
      id: 'sala', titulo: 'La sala de espera', captura: 'pac-sala', grupo: 'La consulta',
      bajada: 'Antes de entrar contestás unas preguntas cortas, y esperás a que el profesional te haga pasar.',
      marcas: {
        1: 'Las preguntas de la pre-consulta: qué te pasa, desde cuándo y qué tomás. Al final seguís a la sala de espera.',
      },
      tips: [{ tipo: 'tip', texto: 'Lo que contestás lo lee el profesional antes de atenderte, así la consulta va directo al punto.' }],
    },
    {
      id: 'videollamada', titulo: 'La videollamada', captura: 'pac-videollamada', grupo: 'La consulta',
      bajada: 'Es una sala privada entre vos y el profesional, sin grabación. Al final te pide tu código de cierre.',
      marcas: {
        1: 'Tu código de cierre, con el botón para compartirlo.',
        3: 'Salir de la llamada.',
      },
      tips: [
        { tipo: 'tip', texto: 'Cuando el profesional te pide el código, te aparece un aviso: tocás "Aceptar y compartir" y listo.' },
        { tipo: 'tip', texto: 'Si se corta, volvés a entrar desde Turnos mientras la consulta siga abierta.' },
      ],
    },
    {
      id: 'resumen', titulo: 'El resumen y la reseña', captura: 'pac-resumen', grupo: 'La consulta',
      bajada: 'Cuando el profesional cierra la consulta te llega el resumen por mail y en la app, con la receta si te recetó.',
      marcas: {
        1: 'El resumen que escribió el profesional.',
        2: 'El diagnóstico.',
        3: 'Las indicaciones y la medicación.',
      },
      tips: [{ tipo: 'tip', texto: 'Si te recetó, la receta aparece acá mismo para abrirla en PDF. Más abajo podés dejar una reseña.' }],
    },
    {
      id: 'recetas', titulo: 'Tus recetas', captura: 'pac-receta', grupo: 'Tu salud',
      bajada: 'Todas las recetas que te emitieron, con su PDF. Si la farmacia tiene los medicamentos, los comprás desde acá.',
      marcas: {
        1: 'La receta en PDF.',
        2: 'Cada medicamento con su dosis.',
        3: 'Agregar al carrito lo que tiene la farmacia, o comprar todo junto.',
      },
    },
    {
      id: 'historia', titulo: 'Tu historia clínica', captura: 'pac-app-historia', grupo: 'Tu salud',
      bajada: 'Cada consulta que tuviste, con lo que anotó el profesional, los diagnósticos, la medicación y tus alergias.',
      marcas: {
        1: 'Tus alergias activas, siempre arriba.',
        2: 'Cada consulta: tocala para ver el detalle.',
        3: 'Descargarla o compartirla.',
      },
      tips: [{ tipo: 'tip', texto: 'La escriben los profesionales que te atienden; vos la podés leer siempre.' }],
    },
    {
      id: 'boveda', titulo: 'Tu bóveda', captura: 'pac-app-boveda', grupo: 'Tu salud',
      bajada: 'Todo lo médico en un solo lugar: historia clínica, recetas, estudios, planes de tus profesionales y tus mascotas.',
      marcas: {
        1: 'Tu historia clínica.',
        2: 'Las carpetas: recetas, análisis, nutrición, salud mental y más.',
      },
    },
    {
      id: 'biovisor', titulo: 'BioVisor: tus análisis', captura: 'pac-biovisor', grupo: 'Tu salud',
      bajada: 'Subís el PDF o la foto de tu análisis de sangre y ves tus valores, con su rango y cómo evolucionan.',
      marcas: {
        1: 'Subir, ver tus parámetros o la evolución.',
        2: 'Cada valor con su resultado: normal, atención o alerta.',
      },
    },
    {
      id: 'nutriplan', titulo: 'NutriPlan', captura: 'pac-nutriplan', grupo: 'Tu salud',
      bajada: 'El plan de alimentación que te armó tu nutricionista. Vas tildando lo que comés y él ve cómo vas.',
      marcas: {
        1: 'Las calorías y los macronutrientes del día.',
        2: 'Las comidas del día, con la que toca ahora marcada.',
      },
    },
    {
      id: 'mascotas', titulo: 'Amigo Peludo', captura: 'pac-mascotas', grupo: 'Tu salud',
      bajada: 'Cargás a tus mascotas y las elegís cuando sacás un turno de veterinaria.',
      marcas: {
        1: 'Tus mascotas.',
        2: 'Agregar una mascota nueva.',
      },
    },
    {
      id: 'farmacia', titulo: 'Comprar en la farmacia', captura: 'pac-farmacia', grupo: 'Farmacia',
      bajada: 'Comprás tus medicamentos con envío a domicilio y pagás con Mercado Pago.',
      marcas: {
        1: 'Buscar productos.',
        2: 'Lo que te recetó tu médico, primero.',
        3: 'Agregar al carrito.',
        4: 'Tus pedidos.',
      },
      pasos: [
        'Entrá desde tu receta ("Comprar todos") o desde Farmacia.',
        'Revisá el carrito y tocá "Proceder al checkout".',
        'Elegí la dirección de entrega.',
        'Pagá con tu tarjeta.',
      ],
    },
    {
      id: 'pedido', titulo: 'Seguir tu pedido', captura: 'pac-pedido', grupo: 'Farmacia',
      bajada: 'Ves en qué está tu pedido. Cuando sale, aparece tu código de entrega.',
      marcas: {
        1: 'El estado del pedido.',
        2: 'Tu código de entrega: decíselo a quien te lo trae.',
      },
      tips: [{ tipo: 'tip', texto: 'No hace falta mostrar el DNI: con el código alcanza.' }],
    },
    {
      id: 'familia', titulo: 'Tu grupo familiar', captura: 'pac-familiar', grupo: 'Tu familia',
      bajada: 'Cargás a tus hijos o a tus padres. Cada uno tiene su propia historia clínica y vos le sacás turnos y lo acompañás.',
      marcas: {
        1: 'Reservar un turno o una consulta inmediata para tu familiar.',
        2: 'Su historia clínica.',
      },
      pasos: [
        'En Perfil, en "Grupo familiar", tocá "Añadir".',
        'Cargá nombre, apellido, vínculo, DNI y fecha de nacimiento.',
        'Entrá a su ficha para sacarle turno o ver su historia.',
      ],
      tips: [{ tipo: 'tip', texto: 'Los avisos de las consultas de tu familiar te llegan a vos.' }],
    },
    {
      id: 'codigo-familiar', titulo: 'Que tu familiar entre solo', captura: 'pac-acceso-familiar', grupo: 'Tu familia',
      bajada: 'Tu familiar entra sin contraseña, con un código de 6 números que generás vos desde su ficha.',
      marcas: {
        1: 'Dónde escribe el código.',
        2: 'Entrar.',
      },
      pasos: [
        'En la ficha del familiar, tocá "Generar código de acceso".',
        'Pasale el código.',
        'En el ingreso, toca "Entrar con código familiar" y lo escribe.',
      ],
      tips: [{ tipo: 'ojo', texto: 'El código sirve una sola vez y vence a los 15 minutos. Si generás otro, el anterior deja de andar.' }],
    },
    {
      id: 'sos', titulo: 'S.O.S.: pedir una ambulancia', captura: 'pac-sos', grupo: 'Urgencias',
      bajada: 'El botón rojo del inicio. Reservás el monto en tu tarjeta, contás qué te pasa y seguís a la ambulancia en el mapa.',
      marcas: {
        1: 'Si hay riesgo de vida, el 107 está siempre a mano.',
        2: 'El monto se reserva, no se cobra todavía.',
        3: 'Reservar y seguir a contar qué te pasa.',
      },
      pasos: [
        'En el inicio, tocá "Emergencia S.O.S.".',
        'Tocá "Reservar y continuar".',
        'Marcá lo que te pasa y tocá "Pedir la ambulancia".',
        'Seguí la ambulancia en el mapa hasta que llegue.',
      ],
      tips: [{ tipo: 'tip', texto: 'Mientras se asigna la ambulancia podés cancelar sin cargo.' }],
    },
    {
      id: 'perfil', titulo: 'Tu perfil', captura: 'pac-app-perfil', grupo: 'Tu cuenta',
      bajada: 'Tus datos, tu perfil clínico, tus direcciones, tus tarjetas y tu familia.',
      marcas: {
        1: 'Tus datos y tu perfil clínico.',
        2: 'Tus profesionales y tu grupo familiar.',
        3: 'Direcciones, tarjetas, comprobantes y avisos.',
      },
      tips: [{ tipo: 'tip', texto: 'Desde Perfil también abrís esta guía, en "Guía de uso".' }],
    },
  ],
  faq: [
    { p: '¿Cuándo me cobran?', r: 'Un turno se paga al reservarlo. En la consulta inmediata se reserva el monto y se cobra al terminar. En una ambulancia se reserva al pedirla y se cobra al cerrar el traslado.' },
    { p: '¿Qué pasa si el profesional no se conecta?', r: 'En la consulta inmediata podés esperar unos minutos más o pasar a otro profesional, y no se te cobra nada hasta que te atiendan. En un turno, si el profesional no aparece, lo marcás ausente y el equipo revisa tu devolución.' },
    { p: '¿Puedo cancelar un turno?', r: 'Sí, desde Turnos. Con 48 horas hábiles de anticipación pedís la devolución en el mismo paso y la recibís en Healthy Credits.' },
    { p: '¿Puedo cambiar el día de un turno?', r: 'Se cancela y se reserva de nuevo. Si cancelás con anticipación, la devolución te queda como saldo para el turno nuevo.' },
    { p: '¿Dónde está mi receta?', r: 'En el resumen de la consulta, en Mis recetas y en tu bóveda. También te llega por mail.' },
    { p: '¿Cómo compro lo que me recetaron?', r: 'Desde la receta, con "Comprar todos", o desde Farmacia. Pagás con tu tarjeta y te lo envían.' },
    { p: '¿Puedo atender a mi hijo con mi cuenta?', r: 'Sí. Lo cargás en tu grupo familiar y al reservar elegís "para alguien de tu grupo familiar". Su consulta queda en su propia historia clínica.' },
    { p: '¿Mi historia clínica la ve cualquiera?', r: 'No. La ven los profesionales que te atienden, y cada acceso queda registrado.' },
    { p: '¿La videollamada se graba?', r: 'No. Es una sala privada entre vos y el profesional.' },
    { p: '¿Para qué sirve el código de cierre?', r: 'Confirma que la consulta ocurrió. Se lo compartís al profesional al final, con un toque.' },
  ],
  glosario: ['Consulta inmediata', 'Turno', 'Sala de espera', 'Pre-consulta', 'Código de cierre', 'Receta electrónica', 'Historia clínica', 'Bóveda', 'BioVisor', 'NutriPlan', 'Grupo familiar', 'Código familiar', 'Healthy Credits', 'Horas hábiles', 'Código de entrega', 'S.O.S.'],
  ayuda: '¿Dudas? Tocá "Contactá a soporte" en el inicio y te contestamos por WhatsApp.',
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFESIONAL — sobre todo la web
// ═══════════════════════════════════════════════════════════════════════════
const profesional = {
  slug: 'profesional',
  nombre: 'Profesional',
  para: 'Profesionales de la salud',
  mision: 'Tu consultorio online, de la agenda a la receta.',
  bajada: 'Recibís pacientes por turno o al instante, los atendés por videollamada con la historia clínica al lado, recetás con validez legal y cobrás directo en tu Mercado Pago.',
  ficha: [['Entrás con', 'Tu mail o Google'], ['Desde', 'La computadora (y la app)'], ['Tu pantalla clave', 'La sala'], ['Para aprenderla', 'Unos 15 minutos']],
  dia: [
    { titulo: 'Te ponés disponible', texto: 'Prendés la consulta inmediata y mirás tus turnos de hoy.' },
    { titulo: 'Leés la pre-consulta', texto: 'Antes de atender ya sabés qué le pasa al paciente.' },
    { titulo: 'Atendés', texto: 'Lo hacés pasar, cargás la historia clínica y recetás.' },
    { titulo: 'Cerrás', texto: 'Escribís el resumen y cargás el código del paciente.' },
    { titulo: 'Cobrás', texto: 'La plata entra directo a tu Mercado Pago.' },
  ],
  viajes: [VIAJE_CONSULTA],
  puede: [
    { titulo: 'Darte de alta', texto: 'Tus datos, tu matrícula y tus documentos.', ir: 'alta' },
    { titulo: 'Ordenar tu día', texto: 'Turnos, avisos y métricas en el inicio.', ir: 'inicio' },
    { titulo: 'Atender al instante', texto: 'Prendés la consulta inmediata y te llegan pacientes.', ir: 'inmediata' },
    { titulo: 'Armar tu agenda', texto: 'Tus horarios, de a 15 minutos.', ir: 'agenda' },
    { titulo: 'Poner tus precios', texto: 'Por modalidad, y dónde atendés.', ir: 'tarifas' },
    { titulo: 'Atender por video', texto: 'Con la historia clínica al lado.', ir: 'sala' },
    { titulo: 'Recetar', texto: 'Receta electrónica con validez legal.', ir: 'receta' },
    { titulo: 'Cerrar la consulta', texto: 'Resumen y código del paciente.', ir: 'cerrar' },
    { titulo: 'Seguir a tus pacientes', texto: 'Su ficha, su historia y el próximo control.', ir: 'pacientes' },
    { titulo: 'Cobrar', texto: 'Conectás tu Mercado Pago y ves tus ganancias.', ir: 'mercadopago' },
    { titulo: 'Sumar pacientes', texto: 'Tu link personal para invitarlos.', ir: 'referido' },
  ],
  secciones: [
    {
      id: 'alta', titulo: 'Tu alta en Healthier', captura: 'pro-onboarding', grupo: 'Empezar',
      bajada: 'Son cinco pasos: especialidad, presentación, documentación, privacidad y envío. Se guarda en cada paso, así que podés seguir después.',
      marcas: {
        1: 'Los cinco pasos del alta.',
        2: 'Tu profesión, tu especialidad y tu matrícula.',
        3: 'Así te van a ver los pacientes, en vivo mientras completás.',
      },
      pasos: [
        'Registrate en "Sumate como profesional".',
        'Elegí tu profesión, tu especialidad y cargá tu matrícula.',
        'Sumá tu DNI, tu foto y una presentación corta.',
        'Subí tu título, tu matrícula y tu DNI.',
        'Aceptá los términos y tocá "Enviar para revisión".',
      ],
      tips: [{ tipo: 'tip', texto: 'El equipo revisa tu documentación en 24 a 48 horas hábiles y te avisa por mail.' }],
    },
    {
      id: 'revision', titulo: 'Mientras te verificamos', captura: 'pro-revision', grupo: 'Empezar',
      bajada: 'Mientras revisamos tu documentación, adelantás todo lo demás: Mercado Pago, horarios, precios y una práctica de videoconsulta.',
      marcas: {
        1: 'El estado de tu verificación.',
        2: 'Conectar Mercado Pago, sin esperar la verificación.',
        3: 'Practicar una videoconsulta con una paciente de prueba.',
        4: 'Lo que te falta para tener el perfil completo.',
      },
      tips: [{ tipo: 'tip', texto: 'La práctica es la sala de verdad con una paciente inventada: no se guarda nada. El código de cierre de práctica es 1234.' }],
    },
    {
      id: 'inicio', titulo: 'Tu inicio', captura: 'pro-inicio', grupo: 'Tu día',
      bajada: 'Lo que tenés que hacer hoy, en una pantalla.',
      marcas: {
        1: 'La consulta inmediata: prendela para recibir pacientes al instante.',
        2: 'Tu link para invitar pacientes.',
        3: 'Tus números: consultas de hoy, totales, calificación y reseñas.',
        4: 'Lo que ganaste este mes.',
        6: 'El menú: agenda, pacientes, historial, ganancias y configuración.',
      },
      tips: [{ tipo: 'tip', texto: 'La primera vez te aparece un recorrido guiado. Lo volvés a ver desde el Centro de ayuda.' }],
    },
    {
      id: 'inmediata', titulo: 'Consulta inmediata', captura: 'pro-inicio', grupo: 'Tu día',
      bajada: 'Con la consulta inmediata prendida aparecés para los pacientes que necesitan atención ahora.',
      marcas: { 1: 'El interruptor: prendido, quedás visible para los pacientes.' },
      pasos: [
        'En el inicio, prendé "Consulta inmediata".',
        'Cuando un paciente te elige, te llega un aviso.',
        'Cuando entra a la sala, ves "En sala" y el botón "Ingresar paciente".',
      ],
      tips: [
        { tipo: 'tip', texto: 'La disponibilidad dura una hora y se renueva sola mientras usás la plataforma. No hace falta dejarla abierta.' },
        { tipo: 'tip', texto: 'El precio de la consulta inmediata lo fija Healthier por especialidad.' },
        { tipo: 'ojo', texto: 'Activá las notificaciones para enterarte al instante cuando un paciente te espera.' },
      ],
    },
    {
      id: 'agenda', titulo: 'Tu agenda', captura: 'pro-agenda', grupo: 'Tu día',
      bajada: 'Cargás los bloques en los que atendés y la plataforma los divide en turnos de 15 minutos.',
      marcas: {
        1: 'Las consultas de hoy.',
        2: 'Tu horario semanal, día por día.',
        3: 'Agregar una franja a un día.',
      },
      pasos: [
        'En "Mi agenda", tocá el + del día.',
        'Elegí la hora de inicio y de fin, y tocá "Agregar".',
        'Para sacar una franja, tocá la X.',
      ],
      tips: [{ tipo: 'tip', texto: 'Los pacientes sólo pueden reservar dentro de tus franjas, y para hoy con al menos una hora de anticipación.' }],
    },
    {
      id: 'tarifas', titulo: 'Tus precios y dónde atendés', captura: 'pro-tarifas', grupo: 'Tu día',
      bajada: 'Elegís si atendés virtual, presencial o las dos, y cuánto cobrás en cada caso.',
      marcas: {
        1: 'Las pestañas de configuración.',
        2: 'Tu modalidad y tu zona.',
        3: 'Tu precio por modalidad.',
      },
      tips: [{ tipo: 'ojo', texto: 'El mínimo es $15.000 por consulta. Sin un precio cargado no aparecés en las búsquedas.' }],
    },
    {
      id: 'sala', titulo: 'La sala de videollamada', captura: 'pro-sala', grupo: 'La consulta',
      bajada: 'El video a un lado y el panel clínico al otro. Todo lo que cargás queda en la historia clínica del paciente.',
      marcas: {
        1: 'El video, con la cámara, el micrófono y Finalizar.',
        2: 'Las pestañas: notas, historia clínica, recetario y cierre.',
        3: 'Lo que contó el paciente en la pre-consulta.',
        4: 'Los tipos de nota: nota, diagnóstico presuntivo, indicación y addendum.',
      },
      pasos: [
        'Tocá "Ingresar paciente" para hacerlo pasar.',
        'Leé la pre-consulta y la historia clínica.',
        'Cargá tus notas mientras lo atendés.',
        'Si hace falta, recetá desde el Recetario.',
        'Tocá "Finalizar" para terminar.',
      ],
      tips: [
        { tipo: 'tip', texto: 'Si el paciente no entra en 5 minutos, podés seguir esperando o marcarlo ausente.' },
        { tipo: 'tip', texto: 'Si se corta o recargás la página, lo que cargaste sigue ahí.' },
        { tipo: 'tip', texto: 'En Clínica y Pediatría tenés la consulta estructurada, con signos vitales y un copiloto que sugiere preguntas y diagnósticos.' },
      ],
    },
    {
      id: 'receta', titulo: 'La receta electrónica', captura: 'pro-receta', grupo: 'La consulta',
      bajada: 'Recetás desde la consulta, eligiendo del vademécum. Al paciente le llega el PDF firmado, con validez legal.',
      marcas: {
        1: 'La cobertura del paciente: obra social o particular.',
        2: 'Recetar medicamentos o estudios.',
      },
      pasos: [
        'En el Recetario, revisá la cobertura del paciente.',
        'Tocá "Recetar medicamentos" y buscalo en el vademécum.',
        'Completá la dosis y tocá "Guardar medicación".',
        'Marcá los medicamentos y tocá "Emitir receta".',
      ],
      tips: [
        { tipo: 'ojo', texto: 'Sin tu firma cargada no se emite. Si te falta, al tocar "Emitir receta" se abre la hoja para firmar y la receta sale sola al guardarla.' },
        { tipo: 'tip', texto: 'Guardar la medicación no se la entrega al paciente: recién al tocar "Emitir receta" le llega.' },
        { tipo: 'tip', texto: 'La receta necesita tu DNI, tu matrícula y la dirección de tu consultorio.' },
      ],
    },
    {
      id: 'firma', titulo: 'Tu firma', captura: 'pro-firma', grupo: 'La consulta',
      bajada: 'La cargás una vez y queda para todas tus recetas.',
      marcas: { 1: 'Firmá con el dedo o el mouse, o subí una foto de tu firma.' },
    },
    {
      id: 'cerrar', titulo: 'Cerrar la consulta', captura: 'pro-cerrar', grupo: 'La consulta',
      bajada: 'Al cerrar escribís el resumen para el paciente y cargás su código de cierre.',
      marcas: {
        1: 'Pedirle el código al paciente: le aparece un aviso para compartirlo.',
        2: 'Donde se carga el código de 4 números.',
      },
      pasos: [
        'En la pestaña "Cerrar Consulta", tocá "Solicitar código al paciente".',
        'Cuando lo comparte, queda verificado solo.',
        'Tocá "Finalizar", escribí el resumen y confirmá el cierre.',
      ],
      tips: [
        { tipo: 'tip', texto: 'Si el paciente ya se fue, cerrás dejando un motivo.' },
        { tipo: 'ojo', texto: 'Una vez cerrada, la consulta queda congelada. Lo único que se puede sumar después es la factura.' },
      ],
    },
    {
      id: 'presencial', titulo: 'Consulta presencial', captura: 'pro-presencial', grupo: 'La consulta',
      bajada: 'Ves cuándo llega el paciente y abrís la consulta con su código.',
      marcas: {
        1: 'Pedile al paciente su código de 4 números para abrir la consulta.',
        2: 'Ingresar.',
      },
      tips: [{ tipo: 'tip', texto: 'Para atender presencial tenés que cargar la dirección de tu consultorio en Mi perfil.' }],
    },
    {
      id: 'pacientes', titulo: 'Tus pacientes', captura: 'pro-pacientes', grupo: 'Seguimiento',
      bajada: 'Todos los pacientes que atendiste, con su ficha, su historia clínica y el próximo control.',
      marcas: {
        1: 'Buscar un paciente.',
        2: 'Cada paciente: tocalo para abrir su ficha.',
      },
      tips: [{ tipo: 'tip', texto: 'Desde la ficha agendás el próximo control: el turno queda creado y al paciente le llega el aviso.' }],
    },
    {
      id: 'historial', titulo: 'Historial', captura: 'pro-historial', grupo: 'Seguimiento',
      bajada: 'Tus consultas pasadas, filtradas por estado.',
      marcas: {
        1: 'Completadas, canceladas, vencidas y ausencias.',
        2: 'Cada consulta: tocala para ver el detalle.',
      },
    },
    {
      id: 'nutriplan', titulo: 'NutriPlan Pro', captura: 'pro-nutriplan', grupo: 'Seguimiento',
      bajada: 'Si sos nutricionista, armás el plan de alimentación de cada paciente y seguís cómo lo cumple.',
      marcas: {
        1: 'El paciente.',
        2: 'Datos, dieta, plantilla de comidas y monitoreo.',
        3: 'Guardar el plan.',
      },
      tips: [{ tipo: 'tip', texto: 'Psicología y entrenamiento tienen su equivalente: el Plan de actividad.' }],
    },
    {
      id: 'mercadopago', titulo: 'Conectar Mercado Pago', captura: 'pro-cuenta', grupo: 'Cobrar',
      bajada: 'Es donde cobrás. Sin Mercado Pago conectado los pacientes no pueden reservarte.',
      marcas: {
        1: 'El estado de tu cuenta de Mercado Pago.',
        2: 'Conectar o desconectar.',
      },
      pasos: [
        'Entrá a Configuración, pestaña "Cuenta".',
        'Tocá "Conectar" y autorizá en Mercado Pago.',
        'Al volver, ya figura conectada.',
      ],
      tips: [{ tipo: 'tip', texto: 'Podés conectarlo apenas te registrás, sin esperar la verificación.' }],
    },
    {
      id: 'ganancias', titulo: 'Tus ganancias', captura: 'pro-ganancias', grupo: 'Cobrar',
      bajada: 'Cuánto cobraste, la comisión y lo que te queda, mes a mes.',
      marcas: {
        1: 'El período.',
        2: 'Tu neto del mes, de la semana y total.',
        3: 'La evolución mes a mes.',
        4: 'Cada pago con su bruto, comisión y neto.',
      },
      tips: [
        { tipo: 'tip', texto: 'Te quedás con el 80% de cada consulta. La plata entra directo a tu Mercado Pago, nunca pasa por Healthier.' },
        { tipo: 'tip', texto: 'Cuándo la podés retirar depende del plazo de acreditación de tu cuenta de Mercado Pago.' },
      ],
    },
    {
      id: 'referido', titulo: 'Tu link para pacientes', captura: 'pro-inicio', grupo: 'Crecer',
      bajada: 'Mandás tu link a tus pacientes. Entran a tu perfil, crean su cuenta y quedan asociados a vos.',
      marcas: { 2: 'Copiar o mandar por WhatsApp. Abajo ves cuántos entraron, se registraron y sacaron turno.' },
    },
    {
      id: 'perfil', titulo: 'Tu perfil', captura: 'pro-perfil', grupo: 'Crecer',
      bajada: 'Lo que ven los pacientes de vos: foto, especialidad, presentación y la dirección de tu consultorio.',
      marcas: {
        1: 'Tu nombre y apellido.',
        2: 'La dirección de tu consultorio.',
      },
      tips: [{ tipo: 'ojo', texto: 'Si cambiás un dato de tu matrícula, tu especialidad o tu nombre, el perfil vuelve a revisión. Seguís atendiendo los turnos que ya tenías.' }],
    },
    {
      id: 'app', titulo: 'En la app', captura: 'pro-app-inicio', grupo: 'En el teléfono',
      bajada: 'En el teléfono tenés tu inicio, tu agenda y tus pacientes, y atendés la videollamada igual que en la computadora.',
      marcas: {
        1: 'La consulta inmediata, a mano.',
        2: 'Tu link para pacientes. Más abajo, tus números y las consultas de hoy.',
        3: 'Inicio, Agenda, Pacientes y Más (ahí están Ganancias, Configuración y esta guía).',
      },
    },
    {
      id: 'ayuda', titulo: 'Centro de ayuda', captura: 'pro-ayuda', grupo: 'En el teléfono',
      bajada: 'Preguntas frecuentes, el recorrido guiado y la práctica de videoconsulta.',
      marcas: {
        1: 'Practicar una videoconsulta.',
        2: 'Volver a ver el recorrido.',
        3: 'Escribirnos por WhatsApp.',
      },
    },
  ],
  faq: [
    { p: '¿Cuánto tarda la verificación?', r: 'Entre 24 y 48 horas hábiles. Te avisamos por mail cuando estás verificado.' },
    { p: '¿Cuándo cobro?', r: 'En cada turno, el cobro entra directo en tu Mercado Pago cuando el paciente paga. En la consulta inmediata se cobra al cerrar la consulta.' },
    { p: '¿Cuánto se queda Healthier?', r: 'El 20% de cada consulta. Vos te quedás con el 80%.' },
    { p: '¿El paciente no se conecta?', r: 'A los 5 minutos te aparece la opción de seguir esperando o marcarlo ausente.' },
    { p: '¿No me deja emitir la receta?', r: 'Revisá que tengas cargada la firma, la dirección del consultorio, tu DNI y tu matrícula. Si falta la firma, la cargás en el momento y la receta sale sola.' },
    { p: '¿No me aparece Mercado Pago?', r: 'Está en Configuración, pestaña "Cuenta". En el teléfono, Configuración está dentro de "Más".' },
    { p: '¿Tengo que dejar la plataforma abierta para la consulta inmediata?', r: 'No. La disponibilidad dura una hora y te llega un aviso cuando un paciente te espera.' },
    { p: '¿Puedo editar una nota ya guardada?', r: 'Las notas no se editan: si algo cambia, se agrega un addendum. Así queda el registro completo.' },
    { p: '¿Qué pasa si cambio mi especialidad o mi matrícula?', r: 'El perfil vuelve a revisión. Mientras tanto seguís atendiendo los turnos que ya tenías.' },
    { p: '¿Cómo practico antes de mi primera consulta?', r: 'Desde el inicio o el Centro de ayuda, con "Practicá una videoconsulta". Es la sala de verdad con una paciente de prueba.' },
  ],
  glosario: ['Verificación', 'Disponible ahora', 'En sala', 'Ingresar paciente', 'Pre-consulta', 'Historia clínica', 'Receta electrónica', 'Vademécum', 'Obra social', 'Firma', 'Código de cierre', 'Mercado Pago', 'Comisión', 'Referido', 'NutriPlan'],
  ayuda: '¿Dudas? Entrá al Centro de ayuda o escribinos por WhatsApp.',
}

// ═══════════════════════════════════════════════════════════════════════════
// FARMACIA — la web
// ═══════════════════════════════════════════════════════════════════════════
const farmacia = {
  slug: 'farmacia',
  nombre: 'Farmacia',
  para: 'Farmacias',
  mision: 'Los pedidos de tus pacientes, de la receta a la puerta.',
  bajada: 'Recibís los pedidos ya pagos, los preparás, los enviás y los entregás con un código. Tu catálogo se carga con un Excel y cobrás directo en tu Mercado Pago.',
  ficha: [['Entrás con', 'Tu mail y tu contraseña'], ['Desde', 'La computadora'], ['Tu pantalla clave', 'Pedidos'], ['Para aprenderla', 'Unos 5 minutos']],
  dia: [
    { titulo: 'Mirás los pendientes', texto: 'Los pedidos nuevos, ya pagos, con la dirección y lo que llevan.' },
    { titulo: 'Preparás', texto: 'Lo pasás a "En preparación".' },
    { titulo: 'Enviás', texto: 'Lo pasás a "Enviado" y al paciente le llega su código.' },
    { titulo: 'Entregás', texto: 'Cargás el código del paciente y queda entregado.' },
    { titulo: 'Cuidás el catálogo', texto: 'Precios, stock y fotos, con un Excel.' },
  ],
  viajes: [VIAJE_PEDIDO],
  puede: [
    { titulo: 'Ver los pedidos', texto: 'Todos, con su estado y su pago.', ir: 'pedidos' },
    { titulo: 'Avanzar un pedido', texto: 'De pendiente a entregado.', ir: 'pedido' },
    { titulo: 'Entregar con código', texto: 'Sin DNI ni firmas.', ir: 'entregar' },
    { titulo: 'Cancelar con motivo', texto: 'El paciente lo ve en su seguimiento.', ir: 'cancelar' },
    { titulo: 'Cargar el catálogo', texto: 'Importar y exportar con Excel.', ir: 'catalogo' },
    { titulo: 'Subir fotos', texto: 'A los productos que no tienen.', ir: 'fotos' },
    { titulo: 'Cobrar', texto: 'Conectando tu Mercado Pago.', ir: 'configuracion' },
  ],
  secciones: [
    {
      id: 'pedidos', titulo: 'Los pedidos', captura: 'far-pedidos', grupo: 'Pedidos',
      bajada: 'Es lo primero que ves al entrar: todos los pedidos de tus pacientes.',
      marcas: {
        1: 'Cuántos pedidos tenés.',
        2: 'Filtrar por estado y por pago.',
        3: 'Cada pedido: paciente, dirección, estado, pago y total. Tocalo para abrirlo.',
        4: 'El siguiente paso de cada pedido, en un botón.',
      },
      tips: [{ tipo: 'tip', texto: 'Cada pedido nuevo también te llega por mail.' }],
    },
    {
      id: 'pedido', titulo: 'Adentro de un pedido', captura: 'far-pedido', grupo: 'Pedidos',
      bajada: 'Todo lo que necesitás para prepararlo y entregarlo.',
      marcas: {
        1: 'El número de pedido, su estado y su pago.',
        2: 'El paciente: nombre, teléfono y dirección de entrega.',
        3: 'Los medicamentos, con los que requieren receta marcados.',
        4: 'El pago: lo cobrado, la comisión y lo que te queda.',
      },
      pasos: [
        'Abrí el pedido pendiente.',
        'Tocá "Marcar en preparación" cuando lo empezás a armar.',
        'Tocá "Marcar enviado" cuando sale.',
      ],
    },
    {
      id: 'entregar', titulo: 'Entregar con código', captura: 'far-entregar', grupo: 'Pedidos',
      bajada: 'Cuando el pedido está enviado, el paciente tiene un código de 4 números. Lo cargás y queda entregado.',
      marcas: { 1: 'Escribí el código del paciente y tocá "Confirmar entrega".' },
      tips: [
        { tipo: 'tip', texto: 'No hace falta pedir DNI: con el código alcanza.' },
        { tipo: 'ojo', texto: 'Hay 5 intentos. Si se terminan, escribinos y lo resolvemos.' },
      ],
    },
    {
      id: 'cancelar', titulo: 'Cancelar un pedido', captura: 'far-cancelar', grupo: 'Pedidos',
      bajada: 'Si no lo podés cumplir, lo cancelás con un motivo que el paciente ve en su seguimiento.',
      marcas: {
        1: 'El motivo: sin stock, fuera del área de entrega…',
        2: 'Confirmar la cancelación.',
      },
    },
    {
      id: 'catalogo', titulo: 'Tu catálogo', captura: 'far-catalogo', grupo: 'Catálogo',
      bajada: 'Tus productos con precio, stock y si necesitan receta. Se carga entero con un Excel.',
      marcas: {
        1: 'Cuántos productos tenés.',
        2: 'Exportar el Excel, para editarlo o como plantilla.',
        3: 'Importar el Excel con los cambios.',
        4: 'Cada producto con su precio, su stock y su categoría.',
      },
      pasos: [
        'Tocá "Exportar Excel".',
        'Editá precios, stock o sumá productos.',
        'Tocá "Importar Excel" y elegí el archivo.',
        'Revisá la vista previa y tocá "Confirmar importación".',
      ],
      tips: [
        { tipo: 'tip', texto: 'Si un producto ya existe (mismo SKU), se actualiza. Con stock en cero queda agotado.' },
        { tipo: 'tip', texto: 'La vista previa te marca las filas con error antes de importar nada.' },
      ],
    },
    {
      id: 'fotos', titulo: 'Las fotos de los productos', captura: 'far-catalogo', grupo: 'Catálogo',
      bajada: 'Los productos con foto se venden mejor. Filtrás los que no tienen y les subís una.',
      marcas: {
        5: 'Ver sólo los productos sin foto.',
        6: 'Tocá la miniatura para subir o cambiar la foto.',
      },
      tips: [{ tipo: 'tip', texto: 'JPG, PNG o WEBP, de hasta 5 MB.' }],
    },
    {
      id: 'configuracion', titulo: 'Mercado Pago y tus datos', captura: 'far-configuracion', grupo: 'Tu farmacia',
      bajada: 'Conectás la cuenta de Mercado Pago donde cobrás y cargás los datos de tu farmacia.',
      marcas: {
        1: 'El estado de tu Mercado Pago, y el botón para conectarlo.',
        2: 'Nombre, dirección y teléfono de la farmacia.',
        3: 'Guardar.',
      },
      tips: [{ tipo: 'tip', texto: 'La plata va directo a tu cuenta, con la comisión de Healthier descontada en el mismo cobro.' }],
    },
  ],
  faq: [
    { p: '¿Los pedidos llegan pagos?', r: 'Sí. Un pedido entra cuando el paciente pagó, o figura como bonificado si no tiene cargo.' },
    { p: '¿Qué pasa si el código no coincide?', r: 'Te avisa cuántos intentos quedan. Son 5; si se terminan, escribinos y lo resolvemos.' },
    { p: '¿Hay retiro en el local?', r: 'Por ahora todos los pedidos son con envío.' },
    { p: '¿Quién puede editar el catálogo?', r: 'El administrador de la farmacia. Los operadores mueven los pedidos, y la cuenta de consulta sólo los ve.' },
    { p: '¿Cuándo me pagan?', r: 'El cobro entra directo en tu Mercado Pago cuando el paciente paga, con la comisión de Healthier ya descontada.' },
    { p: '¿El paciente se entera de cada cambio?', r: 'Le avisamos cuando su pedido sale, cuando se entrega y si se cancela.' },
  ],
  glosario: ['Pedido', 'Código de entrega', 'Catálogo', 'Bonificado', 'Receta electrónica', 'Mercado Pago', 'Comisión'],
  ayuda: '¿Dudas con un pedido? Escribinos y lo vemos juntos.',
}

// ═══════════════════════════════════════════════════════════════════════════
// EMERGENCIAS — coordinación (web) y tripulación (teléfono)
// ═══════════════════════════════════════════════════════════════════════════
const emergencias = {
  slug: 'emergencias',
  nombre: 'Emergencias',
  para: 'Coordinación y tripulación',
  mision: 'Cada pedido de ambulancia, asignado y seguido en vivo.',
  bajada: 'Coordinación recibe cada S.O.S. ya clasificado y lo asigna al móvil más conveniente. La tripulación lo acepta, navega hasta el paciente y el médico lo atiende con el mismo panel clínico de la videoconsulta.',
  ficha: [['Entrás con', 'Tu mail y tu contraseña'], ['Desde', 'La computadora y el teléfono'], ['Tu pantalla clave', 'La cola de despacho'], ['Para aprenderla', 'Unos 10 minutos']],
  dia: [
    { titulo: 'Llega el aviso', texto: 'Cada pedido nuevo, con su código de gravedad.' },
    { titulo: 'Coordinación asigna', texto: 'Elige el móvil, el más cercano o el más rápido.' },
    { titulo: 'La tripulación sale', texto: 'Acepta y navega con Google Maps.' },
    { titulo: 'Llega y atiende', texto: 'El médico carga la atención en la historia clínica.' },
    { titulo: 'Se cierra', texto: 'El móvil queda disponible para el próximo.' },
  ],
  viajes: [VIAJE_EMERGENCIA],
  puede: [
    { titulo: 'Ver la cola', texto: 'Lo que espera móvil y lo que está en curso.', ir: 'cola' },
    { titulo: 'Asignar un móvil', texto: 'Ordenados por distancia.', ir: 'asignar' },
    { titulo: 'Ver la flota en vivo', texto: 'Cada móvil en el mapa.', ir: 'mapa' },
    { titulo: 'Armar los móviles', texto: 'Estado y tripulación de cada uno.', ir: 'ambulancias' },
    { titulo: 'Configurar la entidad', texto: 'Datos y teléfono de guardia.', ir: 'configuracion' },
    { titulo: 'Hacer el traslado', texto: 'Aceptar, navegar y llegar.', ir: 'tripulacion' },
  ],
  secciones: [
    {
      id: 'cola', titulo: 'La cola de despacho', captura: 'emg-cola', grupo: 'Coordinación',
      bajada: 'Los pedidos que esperan ambulancia y los traslados en curso. Se actualiza sola.',
      marcas: {
        1: 'Lo que espera móvil, con cuántos son.',
        2: 'El código de gravedad y cuánto hace que espera.',
        3: 'Asignar un móvil.',
        4: 'Los traslados en curso, con su estado.',
      },
      tips: [{ tipo: 'tip', texto: 'Sólo entran a la cola los pedidos con la reserva confirmada.' }],
    },
    {
      id: 'asignar', titulo: 'Asignar un móvil', captura: 'emg-asignar', grupo: 'Coordinación',
      bajada: 'Elegís entre los móviles disponibles, ordenados por distancia al paciente.',
      marcas: {
        1: 'Cada móvil disponible con su distancia.',
        2: 'Asignar ese móvil.',
      },
      tips: [
        { tipo: 'tip', texto: 'La más cercana no siempre es la más rápida: mirá el tránsito.' },
        { tipo: 'tip', texto: 'Al asignar, el móvil pasa a "En servicio" y el traslado recibe su código UTM.' },
      ],
    },
    {
      id: 'mapa', titulo: 'La flota en vivo', captura: 'emg-mapa', grupo: 'Coordinación',
      bajada: 'Cada móvil en el mapa, con su color según el estado.',
      marcas: {
        1: 'El mapa: verde disponible, ámbar en servicio, gris fuera de servicio.',
        2: 'Los móviles que no están reportando posición.',
      },
      tips: [{ tipo: 'tip', texto: 'Un móvil reporta posición cuando su tripulación tiene "En servicio" prendido en el teléfono.' }],
    },
    {
      id: 'ambulancias', titulo: 'Móviles y tripulación', captura: 'emg-ambulancias', grupo: 'Coordinación',
      bajada: 'Cada móvil con su estado y quiénes van: médico, enfermero y chofer.',
      marcas: {
        1: 'Sumar un móvil nuevo.',
        2: 'Cada móvil, con su estado y su tripulación.',
      },
      pasos: [
        'Para cambiar el estado, elegí Disponible, En servicio o Fuera de servicio.',
        'Para sumar a alguien, buscalo por nombre y elegí su rol.',
        'Para sacarlo, tocá la X.',
      ],
    },
    {
      id: 'configuracion', titulo: 'Los datos de la entidad', captura: 'emg-configuracion', grupo: 'Coordinación',
      bajada: 'Nombre, razón social, teléfonos y el equipo de coordinación.',
      marcas: {
        1: 'Los datos de la entidad.',
        2: 'El teléfono de guardia, el que ve el paciente en un código rojo.',
        3: 'El equipo.',
      },
      tips: [{ tipo: 'tip', texto: 'Los datos los edita el administrador; los operadores los ven.' }],
    },
    {
      id: 'tripulacion', titulo: 'El traslado, en el teléfono', captura: 'emg-tripulacion', grupo: 'Tripulación',
      bajada: 'La tripulación ve la emergencia asignada a su móvil y la sigue paso a paso, con botones grandes.',
      marcas: {
        1: 'El traslado en curso: código, gravedad y cuánto falta.',
        2: 'Navegar con Google Maps, o llamar al paciente.',
        3: 'Avisar que llegaste.',
      },
      pasos: [
        'Tocá "Aceptar emergencia".',
        'Tocá "Navegar al paciente" para abrir Google Maps.',
        'Al llegar, tocá "Llegué al paciente".',
        'Cuando termina la atención, tocá "Cerrar emergencia".',
      ],
      tips: [
        { tipo: 'tip', texto: 'Mientras van en camino, el paciente ve en su mapa dónde están y cuánto falta.' },
        { tipo: 'tip', texto: 'El médico del móvil abre la atención con el mismo panel clínico de la videoconsulta, y queda en la historia clínica del paciente.' },
      ],
    },
  ],
  faq: [
    { p: '¿Cómo me entero de un pedido nuevo?', r: 'Te llega un aviso por cada pedido, con su código de gravedad. Los rojos se marcan primero.' },
    { p: '¿Qué pasa si no hay móviles disponibles?', r: 'La lista te lo dice. Podés liberar un móvil cambiándole el estado en Ambulancias.' },
    { p: '¿Quién cierra el traslado?', r: 'La tripulación, cuando termina la atención. Si no hubo atención (por ejemplo, un traslado a guardia), se cierra con un motivo.' },
    { p: '¿Cuándo se cobra?', r: 'El monto se reserva cuando el paciente pide la ambulancia y se cobra al cerrar el traslado.' },
    { p: '¿El chofer necesita matrícula?', r: 'No. El chofer y el enfermero tienen su propio acceso y mueven los mismos estados que el médico.' },
    { p: '¿Cuándo comparte la ubicación el teléfono?', r: 'Mientras el móvil va en camino al paciente.' },
  ],
  glosario: ['S.O.S.', 'Triage', 'Móvil', 'Tripulación', 'Código de despacho', 'Coordinador', 'Reserva', 'Historia clínica'],
  ayuda: '¿Dudas con un traslado? Escribinos y lo resolvemos al momento.',
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPER ADMIN — sólo con sesión de super admin
// ═══════════════════════════════════════════════════════════════════════════
const superAdmin = {
  slug: 'super-admin',
  nombre: 'Super admin',
  para: 'Administración de Healthier',
  mision: 'Toda la plataforma, a la vista y en tus manos.',
  bajada: 'Verificás profesionales, seguís cada pago y cada devolución, mirás consultas y emergencias, controlás los mails y fijás comisiones, precios y zonas.',
  ficha: [['Entrás con', 'Tu mail y tu contraseña'], ['Desde', 'La computadora'], ['Tu pantalla clave', 'Profesionales'], ['Para aprenderla', 'Unos 20 minutos']],
  dia: [
    { titulo: 'Mirás el tablero', texto: 'Pendientes, prospectos y métricas.' },
    { titulo: 'Verificás', texto: 'Profesionales nuevos, con su documentación.' },
    { titulo: 'Resolvés pagos', texto: 'Devoluciones y pagos a profesionales.' },
    { titulo: 'Controlás', texto: 'Mails, emergencias y auditoría.' },
    { titulo: 'Ajustás', texto: 'Comisión, precios, zonas y especialidades.' },
  ],
  viajes: [VIAJE_CONSULTA, VIAJE_EMERGENCIA],
  puede: [
    { titulo: 'Ver el tablero', texto: 'Captación, consultas y métricas.', ir: 'dashboard' },
    { titulo: 'Verificar profesionales', texto: 'Documentos, SISA y decisión.', ir: 'profesionales' },
    { titulo: 'Resolver pagos', texto: 'Devoluciones y pagos pendientes.', ir: 'pagos' },
    { titulo: 'Ver consultas', texto: 'Con su detalle y su código de cierre.', ir: 'consultas' },
    { titulo: 'Seguir emergencias', texto: 'Y elegir al coordinador.', ir: 'emergencias' },
    { titulo: 'Ver pacientes', texto: 'Usuarios, prospectos y familias.', ir: 'pacientes' },
    { titulo: 'Auditar', texto: 'Accesos a historias clínicas y recetas.', ir: 'auditoria' },
    { titulo: 'Controlar los mails', texto: 'Qué salió y qué rebotó.', ir: 'mails' },
    { titulo: 'Configurar', texto: 'Comisión, turnos, zonas y verticales.', ir: 'settings' },
  ],
  secciones: [
    {
      id: 'dashboard', titulo: 'El tablero', captura: 'sa-dashboard', grupo: 'Seguimiento',
      bajada: 'Lo primero que ves: lo que espera una decisión y cómo viene la plataforma.',
      marcas: {
        1: 'Profesionales pendientes de verificación.',
        2: 'Prospectos de profesionales y de pacientes.',
        3: 'El menú: pagos, consultas, pacientes, profesionales y configuración.',
      },
      tips: [{ tipo: 'tip', texto: 'Más abajo: consultas por día, métricas generales, los mejores profesionales y el funnel de adquisición por fuente.' }],
    },
    {
      id: 'profesionales', titulo: 'Verificar profesionales', captura: 'sa-profesionales', grupo: 'Profesionales',
      bajada: 'Cada profesional con su estado, su Mercado Pago, su firma y si aparece en el mapa. Tocalo para ver su legajo y decidir.',
      marcas: {
        1: 'Filtrar: verificados, pendientes, rechazados o sin Mercado Pago.',
        2: 'Buscar un profesional.',
        3: 'Cada profesional con lo que le falta para atender y recetar.',
      },
      pasos: [
        'Abrí al profesional pendiente.',
        'Revisá sus documentos y tocá "Verificar vía SISA".',
        'Decidí: "Verificar manualmente", "Pedir revisión" o "Rechazo permanente".',
      ],
      tips: [
        { tipo: 'tip', texto: 'Si pedís revisión, el motivo que escribas lo ve el profesional para corregir.' },
        { tipo: 'ojo', texto: 'Un profesional sin precio cargado no aparece en las búsquedas aunque lo apruebes.' },
      ],
    },
    {
      id: 'legajo', titulo: 'El legajo de un profesional', captura: 'sa-profesional', grupo: 'Profesionales',
      bajada: 'Sus datos, sus precios, sus documentos y la verificación, en un panel.',
      marcas: {
        1: 'Lo que necesita para recetar, con lo que le falta marcado. Más abajo, sus documentos.',
        2: 'Las decisiones de verificación.',
      },
    },
    {
      id: 'recorrido', titulo: 'Recorrido y prospectos', captura: 'sa-recorrido', grupo: 'Profesionales',
      bajada: 'Cómo avanza cada profesional desde que crea la cuenta hasta que envía su perfil.',
      marcas: {
        1: 'El período y el grupo.',
        2: 'Cuántos enviaron y cuánto tardan. Abajo, cada profesional y cada paso de su recorrido.',
      },
      tips: [{ tipo: 'tip', texto: 'En Prospectos ves quién se quedó a mitad de camino y le podés escribir. En Referidos, qué profesionales traen más pacientes con su link.' }],
    },
    {
      id: 'pagos', titulo: 'Pagos y devoluciones', captura: 'sa-pagos', grupo: 'Plata',
      bajada: 'Todo lo que se cobró, las devoluciones por resolver y lo que se les debe a los profesionales.',
      marcas: {
        1: 'Facturado, comisión, costo de Mercado Pago y neto de los profesionales.',
        2: 'Las devoluciones: aprobar o rechazar.',
        3: 'Filtrar los pagos por fecha, estado y método.',
      },
      tips: [
        { tipo: 'tip', texto: 'Aprobar una devolución acredita Healthy Credits. Devolver por Mercado Pago es plata real y no se deshace.' },
        { tipo: 'tip', texto: 'Las consultas pagadas con Healthy Credits figuran en "Pagos pendientes a profesionales" hasta que se les transfiere.' },
      ],
    },
    {
      id: 'consultas', titulo: 'Consultas', captura: 'sa-consultas', grupo: 'Operación',
      bajada: 'Todas las consultas, con su estado y su pago. Tocá una para ver el detalle y editarla.',
      marcas: {
        1: 'Buscar por paciente o profesional.',
        2: 'Filtrar por estado y por pago.',
        3: 'Cada consulta: tocala para ver el turno, el pago, el cierre y el código.',
      },
    },
    {
      id: 'emergencias', titulo: 'Emergencias', captura: 'sa-emergencias', grupo: 'Operación',
      bajada: 'Quién coordina las ambulancias y todos los traslados, con su móvil, su cobro y su seguimiento en vivo.',
      marcas: {
        1: 'El coordinador de ambulancias: a quién le llega cada pedido.',
        2: 'Elegir otro coordinador.',
        3: 'Cada traslado con su gravedad, su móvil y su cobro.',
      },
    },
    {
      id: 'pacientes', titulo: 'Pacientes', captura: 'sa-pacientes', grupo: 'Operación',
      bajada: 'Los pacientes con su fuente de llegada y sus consultas. Se exportan a CSV.',
      marcas: {
        1: 'Con consultas, sin consultas o todos.',
        2: 'Exportar.',
        3: 'Cada paciente con su fuente y cuántas consultas tuvo.',
      },
      tips: [{ tipo: 'tip', texto: 'En Grupos familiares ves los familiares de cada titular, sus consultas y cuándo entraron con su código.' }],
    },
    {
      id: 'farmacia', titulo: 'Farmacia', captura: 'sa-farmacia', grupo: 'Operación',
      bajada: 'Cómo viene la farmacia: pedidos, pagados, volumen y el estado de su Mercado Pago.',
      marcas: {
        1: 'Las cifras de la farmacia.',
        2: 'Los últimos pedidos.',
      },
    },
    {
      id: 'auditoria', titulo: 'Auditoría', captura: 'sa-auditoria', grupo: 'Control',
      bajada: 'Quién consultó o escribió cada historia clínica, y cada receta emitida. Sólo los datos del acceso, nunca el contenido clínico.',
      marcas: {
        1: 'Historia clínica o recetas electrónicas.',
        2: 'Buscar por profesional o paciente.',
      },
    },
    {
      id: 'mails', titulo: 'Mails', captura: 'sa-mails', grupo: 'Control',
      bajada: 'Cada mail que salió de la plataforma, y si alguno rebotó, con el motivo exacto.',
      marcas: {
        1: 'Lo de las últimas 24 horas: enviados y con error.',
        2: 'Filtrar por tipo de mail y por estado.',
        3: 'Cada mail con su destinatario y su estado.',
      },
    },
    {
      id: 'settings', titulo: 'Comisión, devoluciones y turnos', captura: 'sa-settings', grupo: 'Configuración',
      bajada: 'Los números que mueven la plataforma.',
      marcas: {
        1: 'La comisión de Healthier y el costo estimado de Mercado Pago.',
        2: 'La ventana de devolución, en horas hábiles.',
        3: 'La duración de cada turno.',
      },
      tips: [{ tipo: 'tip', texto: 'Los cambios se aplican desde el próximo pago y en los horarios futuros; no tocan lo ya reservado.' }],
    },
    {
      id: 'verticales', titulo: 'Verticales y especialidades', captura: 'sa-verticales', grupo: 'Configuración',
      bajada: 'Qué áreas están abiertas, el precio de la consulta inmediata de cada una y el servicio de emergencias.',
      marcas: {
        1: 'Verticales o especialidades.',
        2: 'El precio de la consulta inmediata y si está habilitada.',
        3: 'El servicio de emergencias: precio y si está disponible.',
      },
      tips: [{ tipo: 'tip', texto: 'El precio de la consulta inmediata vale para todos los profesionales de esa vertical. Los turnos siguen con el precio de cada profesional.' }],
    },
    {
      id: 'zonas', titulo: 'Zonas', captura: 'sa-zonas', grupo: 'Configuración',
      bajada: 'Los barrios donde se atiende presencial y la lista de espera de otras ciudades.',
      marcas: {
        1: 'Zonas y lista de espera.',
        2: 'Sumar una zona.',
      },
    },
    {
      id: 'admins', titulo: 'Administradores', captura: 'sa-admins', grupo: 'Configuración',
      bajada: 'Quién más administra la plataforma.',
      marcas: {
        1: 'Sumar un administrador.',
        2: 'Cada administrador con su rol.',
      },
    },
  ],
  faq: [
    { p: '¿"Facturado" es lo que cobró Healthier?', r: 'Es el total cobrado a pacientes. Lo de Healthier es la comisión.' },
    { p: '¿Se puede deshacer una devolución?', r: 'En Healthy Credits queda registrada; por Mercado Pago es plata real y no se deshace.' },
    { p: '¿Por qué un profesional verificado no aparece en las búsquedas?', r: 'Le falta el precio o Mercado Pago. La tabla de Profesionales muestra las dos cosas.' },
    { p: '¿Cambiar la comisión afecta lo ya cobrado?', r: 'No: se aplica desde el próximo pago.' },
    { p: '¿Qué pasa si no hay coordinador de ambulancias?', r: 'Los pedidos nuevos no le avisan a nadie. Elegí uno en Emergencias.' },
    { p: '¿Cambiar el estado de una consulta mueve plata?', r: 'No: cambia el dato de la consulta. Las devoluciones se hacen desde Pagos.' },
  ],
  glosario: ['Verificación', 'Comisión', 'Healthy Credits', 'Horas hábiles', 'Prospecto', 'Auditoría', 'Vertical', 'Zona', 'Coordinador', 'Triage'],
  ayuda: 'Esta guía es interna: sólo se abre con una sesión de super admin.',
}

export const GUIAS = {
  paciente,
  profesional,
  farmacia,
  emergencias,
  'super-admin': superAdmin,
}
