-- Seed multi-vertical clinical notes for paciente@healthier.app (Tomás García)
-- Adds notes from Psicología, Nutrición, Kinesiología, and Medicina Clínica
-- so the Historia Clínica page shows a rich cross-specialty timeline.
--
-- Patient:  7adf8d52-649e-4456-9d03-12541b196594  (Tomás García, paciente@healthier.app)
-- Note: specialty values match the SPECIALTIES list in src/lib/specialties.js
--       so SPECIALTY_COLORS renders correctly.

DO $$
DECLARE
  v_patient  uuid := '7adf8d52-649e-4456-9d03-12541b196594';
  v_sofia    uuid := '00000003-0000-0000-0000-000000000003';  -- Lic. Sofía Ruiz (Psicología)
  v_ana      uuid := '00000002-0000-0000-0000-000000000002';  -- Lic. Ana Gómez (Nutrición)
  v_matias   uuid := '00000004-0000-0000-0000-000000000004';  -- Lic. Matías Fernández (Kinesiología)
  v_martin   uuid := '00000001-0000-0000-0000-000000000001';  -- Dr. Martín López (Medicina Clínica)
BEGIN
  -- Guard agregado el 2026-08-24: estos datos demo apuntan a usuarios de
  -- `auth.users` con UUID fijo que existen en producción pero NO en una base
  -- nueva. Sin esto, reconstruir la base desde el repo fallaba acá por
  -- violación de foreign key. Donde no están los usuarios, la migración
  -- simplemente no siembra nada — que es lo correcto: son datos de demo, no
  -- esquema. (Ver la migración 000 y el catchup del 2026-08-24.)
  if not exists (select 1 from public.profiles where id = v_patient) then
    raise notice 'Seed omitido: no existe el paciente demo en esta base.';
    return;
  end if;

-- ── MEDICINA CLÍNICA ─────────────────────────────────────────────────────────

INSERT INTO public.clinical_notes
  (patient_id, professional_id, specialty, note_type, title, content, created_at, updated_at)
VALUES
  (
    v_patient, v_martin,
    'Medicina Clínica', 'internal',
    'Chequeo anual — laboratorio e hipertensión',
    E'Paciente masculino, 34 años, sin antecedentes de relevancia hasta la fecha.\n\n'
    'Motivo de consulta: chequeo preventivo anual. Refiere leve mareo matutino ocasional en los últimos 2 meses.\n\n'
    'Examen físico:\n'
    '- PA: 138/88 mmHg (brazo derecho), 136/86 mmHg (brazo izquierdo)\n'
    '- FC: 74 lpm, ritmo regular\n'
    '- Peso: 82 kg, Talla: 178 cm, IMC: 25.9\n'
    '- Auscultación cardiopulmonar: sin hallazgos\n\n'
    'Plan:\n'
    '- Solicito laboratorio completo: hemograma, glucemia, perfil lipídico, función renal, TSH\n'
    '- Monitoreo ambulatorio de PA por 7 días\n'
    '- Reducir ingesta de sodio, moderar café\n'
    '- Control en 30 días con resultados',
    '2026-02-12 10:30:00+00', '2026-02-12 10:30:00+00'
  ),
  (
    v_patient, v_martin,
    'Medicina Clínica', 'external',
    'Resumen para el paciente — 12 de febrero',
    E'Tomás, fue un gusto atenderte.\n\n'
    'Resumen de la consulta de hoy:\n'
    '- Tu presión arterial estuvo algo elevada (138/88). No es urgente, pero hay que monitorearlo.\n'
    '- Pedí análisis de sangre para completar el panorama.\n'
    '- Te recomiendo reducir la sal y el café por unos días.\n\n'
    'Próximos pasos:\n'
    '1. Hacete el laboratorio en ayunas.\n'
    '2. Medite la presión en casa 1 vez por día, de mañana.\n'
    '3. Volvemos a vernos en 30 días con los resultados.\n\n'
    'Cualquier duda me escribís.',
    '2026-02-12 10:35:00+00', '2026-02-12 10:35:00+00'
  ),
  (
    v_patient, v_martin,
    'Medicina Clínica', 'internal',
    'Control laboratorio — prediabetes + dislipemia leve',
    E'Resultados de laboratorio recibidos.\n\n'
    'Valores a destacar:\n'
    '- Glucemia en ayunas: 102 mg/dL (prediabetes, rango 100–125)\n'
    '- Colesterol LDL: 128 mg/dL (levemente elevado)\n'
    '- Colesterol HDL: 48 mg/dL (en límite inferior)\n'
    '- Triglicéridos: 156 mg/dL\n'
    '- Función renal y TSH: normales\n'
    '- Hemograma: sin alteraciones\n\n'
    'Presión promedio domiciliaria semana 1: 134/84 mmHg. Confirma HTA grado 1.\n\n'
    'Plan actualizado:\n'
    '- Inicio de intervención nutricional (derivación a nutrición)\n'
    '- Cambio en actividad física (derivación a kinesiología)\n'
    '- Sin medicación antihipertensiva por ahora — reevaluar en 3 meses\n'
    '- Nuevo laboratorio en 90 días',
    '2026-03-10 11:00:00+00', '2026-03-10 11:00:00+00'
  ),
  (
    v_patient, v_martin,
    'Medicina Clínica', 'external',
    'Resultados de laboratorio — próximos pasos',
    E'Tomás, tus resultados de laboratorio llegaron y los revisé.\n\n'
    'Los puntos más importantes:\n'
    '- La glucosa en ayunas está un poco alta (102 mg/dL). Es una señal de alerta temprana — no es diabetes, pero hay que prestarle atención con la alimentación.\n'
    '- El colesterol LDL también está algo elevado.\n'
    '- La presión sigue un toque arriba en casa.\n\n'
    'La buena noticia es que con cambios en la alimentación y ejercicio regular esto se puede revertir sin medicación.\n\n'
    'Por eso te derivé a nutrición y kinesiología — trabajar en equipo va a darte mejores resultados.\n\n'
    'Nos vemos en junio para ver cómo evolucionaste.',
    '2026-03-10 11:10:00+00', '2026-03-10 11:10:00+00'
  ),

-- ── NUTRICIÓN ────────────────────────────────────────────────────────────────

  (
    v_patient, v_ana,
    'Nutrición', 'internal',
    'Primera consulta nutricional — evaluación y plan inicial',
    E'Paciente derivado por Dr. Martín López por prediabetes y dislipemia.\n\n'
    'Evaluación inicial:\n'
    '- IMC: 25.9 — sobrepeso leve\n'
    '- Cintura: 92 cm (riesgo cardiovascular moderado)\n'
    '- Hábitos alimentarios: desayuno rico en harinas refinadas, almuerzo variado, cena tardía (22:00–23:00), consumo elevado de café (4–5/día con azúcar), snacks ultraprocesados a media tarde\n'
    '- Actividad física: sedentario (sólo desplazamientos cotidianos)\n'
    '- Hidratación: insuficiente (~800 ml agua/día)\n\n'
    'Objetivos del plan:\n'
    '1. Bajar glucemia en ayunas a <100 mg/dL\n'
    '2. Mejorar perfil lipídico (LDL <110, triglicéridos <130)\n'
    '3. Reducir peso 3–4 kg en 3 meses\n\n'
    'Plan inicial:\n'
    '- Desayuno: proteína + fibra (huevo + fruta + infusión sin azúcar)\n'
    '- Almuerzo: plato completo con legumbres o proteína magra, verduras, porción de cereal integral\n'
    '- Merienda: fruta + puñado de nueces\n'
    '- Cena: antes de las 21:00, liviana\n'
    '- Eliminar bebidas azucaradas y snacks ultraprocesados\n'
    '- Hidratación objetivo: 2 L/día\n'
    '- Control en 4 semanas',
    '2026-03-25 15:00:00+00', '2026-03-25 15:00:00+00'
  ),
  (
    v_patient, v_ana,
    'Nutrición', 'external',
    'Tu plan nutricional — semana 1',
    E'Tomás, acá te dejo un resumen claro de lo que hablamos hoy.\n\n'
    'El objetivo no es hacer una dieta estricta, sino ir ajustando hábitos de a poco.\n\n'
    '🍳 Desayuno: algo con proteína (huevo, queso untable descremado) + fruta + mate o té sin azúcar. Nada de medialunas o galletitas.\n\n'
    '🥗 Almuerzo: tu plato favorito, pero siempre con verduras y sin frituras. Si podés incorporar legumbres (lentejas, garbanzos) 2–3 veces por semana, mejor.\n\n'
    '🍎 Merienda: fruta + nueces o maní natural (sin sal ni azúcar). Nada de alfajores ni papas fritas.\n\n'
    '🍽️ Cena: antes de las 21:00. Liviana — ensalada, huevo, queso.\n\n'
    '💧 Agua: 2 litros por día. Podés ayudarte con una botella de 500 ml que vayas llenando.\n\n'
    'Nos vemos en 4 semanas. Cualquier duda me escribís.',
    '2026-03-25 15:10:00+00', '2026-03-25 15:10:00+00'
  ),
  (
    v_patient, v_ana,
    'Nutrición', 'internal',
    'Control mes 1 — buena adherencia, ajuste de plan',
    E'Primer control nutricional al mes.\n\n'
    'Evolución positiva:\n'
    '- Peso: 80.2 kg (-1.8 kg)\n'
    '- Cintura: 90 cm (-2 cm)\n'
    '- Adherencia al plan: ~75% según registro del paciente\n'
    '- Dificultades reportadas: cenas tardías los viernes/sábados (vida social), snacks de media tarde difíciles de eliminar\n\n'
    'Ajustes al plan:\n'
    '- Permitir cena tardía 1–2 veces por semana sin restricción (sostenibilidad)\n'
    '- Merienda: permitir 2 cuadraditos de chocolate amargo 70% como alternativa al snack\n'
    '- Incorporar batidos de proteína post-entrenamiento (coordinado con Lic. Fernández)\n'
    '- Aumentar consumo de avena en desayuno\n\n'
    'Laboratorio de control previsto para junio — esperamos mejoría en glucemia y LDL.',
    '2026-04-22 15:30:00+00', '2026-04-22 15:30:00+00'
  ),
  (
    v_patient, v_ana,
    'Nutrición', 'external',
    'Primer mes — muy buen avance',
    E'Tomás, ¡bajaste casi 2 kg en un mes! Eso es un muy buen ritmo.\n\n'
    'Lo más importante es que la mayoría de los cambios los pudiste sostener. Eso es lo difícil y lo que más importa.\n\n'
    'Para el próximo mes:\n'
    '- No te preocupes si una o dos noches cenás tarde por salidas — está dentro del plan.\n'
    '- Podés tomar un batido de proteína whey después de entrenar con Matías.\n'
    '- Agregá avena al desayuno si podés — es muy buena para el colesterol.\n\n'
    'Seguimos así, vamos muy bien.',
    '2026-04-22 15:35:00+00', '2026-04-22 15:35:00+00'
  ),
  (
    v_patient, v_ana,
    'Nutrición', 'internal',
    'Control mes 2 — consolidación de hábitos',
    E'Segundo control nutricional.\n\n'
    'Evolución:\n'
    '- Peso: 79.1 kg (-3.7 kg desde inicio)\n'
    '- Cintura: 89 cm (-3 cm desde inicio)\n'
    '- Adherencia: ~85%\n'
    '- Paciente refiere mayor energía y mejor sueño\n'
    '- Incorporó batido post-entrenamiento sin dificultad\n\n'
    'Laboratorio previo a esta consulta:\n'
    '- Glucemia ayunas: 97 mg/dL ✓ (mejoría significativa desde 102)\n'
    '- LDL: 114 mg/dL (leve mejoría)\n'
    '- Triglicéridos: 134 mg/dL (mejoría)\n\n'
    'Plan: mantener esquema actual. Objetivo para el mes 3: consolidar peso <79 kg y LDL <110.',
    '2026-05-20 15:00:00+00', '2026-05-20 15:00:00+00'
  ),

-- ── KINESIOLOGÍA ─────────────────────────────────────────────────────────────

  (
    v_patient, v_matias,
    'Kinesiología', 'internal',
    'Evaluación inicial — sedentarismo + dolor lumbar crónico leve',
    E'Paciente derivado por Dr. López para incorporación de actividad física progresiva.\n\n'
    'Antecedentes relevantes:\n'
    '- Sedentarismo total desde hace 4 años (trabajo de oficina, 8–10 h/día sentado)\n'
    '- Dolor lumbar crónico leve (EVA 2–3/10), empeora con postura prolongada\n'
    '- Sin lesiones ortopédicas previas de importancia\n'
    '- Sin contraindicaciones cardiovasculares para el ejercicio (validado con Dr. López)\n\n'
    'Evaluación funcional:\n'
    '- Postura: hiperlordosis lumbar marcada, hombros en protracción\n'
    '- Flexibilidad: muy limitada (cadena posterior tensa)\n'
    '- Fuerza de core: insuficiente\n'
    '- Test de resistencia aeróbica: VO2max estimado bajo (sedentario)\n\n'
    'Plan de 12 semanas en 3 etapas:\n'
    'ETAPA 1 (sem. 1–4): movilidad, core y postura\n'
    'ETAPA 2 (sem. 5–8): fuerza funcional y resistencia aeróbica\n'
    'ETAPA 3 (sem. 9–12): progresión carga y autonomía\n\n'
    'Frecuencia: 3 sesiones/semana. Sesiones de 50 min.',
    '2026-04-01 09:00:00+00', '2026-04-01 09:00:00+00'
  ),
  (
    v_patient, v_matias,
    'Kinesiología', 'external',
    'Bienvenido al plan de entrenamiento',
    E'Tomás, fue genial conocerte hoy.\n\n'
    'Arrancar desde cero es siempre un poco intimidante, pero te garantizo que con paciencia y constancia vas a notar la diferencia rápido.\n\n'
    'Lo que vamos a hacer en las primeras 4 semanas:\n'
    '- Ejercicios de movilidad para la zona lumbar y caderas\n'
    '- Trabajo de core (faja abdominal) para proteger la espalda\n'
    '- Elongación al final de cada sesión\n\n'
    'Nada de pesas pesadas todavía — primero construimos la base.\n\n'
    'Nos vemos martes, jueves y sábado, 9:00 hs. Si algún día no podés venir, avisame con anticipación así reagendamos.',
    '2026-04-01 09:15:00+00', '2026-04-01 09:15:00+00'
  ),
  (
    v_patient, v_matias,
    'Kinesiología', 'internal',
    'Fin etapa 1 — progresión a fuerza funcional',
    E'Cierre de etapa 1 (4 semanas, 12 sesiones completadas).\n\n'
    'Evolución:\n'
    '- Asistencia: 11/12 sesiones (91%)\n'
    '- Dolor lumbar: EVA 1/10 (mejoría significativa)\n'
    '- Core: notable mejoría en estabilidad — mantiene plank 45 seg\n'
    '- Flexibilidad: mejoría moderada en cadena posterior\n'
    '- Paciente motivado y sin molestias post-sesión\n\n'
    'Inicio etapa 2:\n'
    '- Incorporar sentadilla con peso corporal y luego goblet\n'
    '- Peso muerto rumano con barra vacía → progresión\n'
    '- Cardio: caminata inclinada 20 min + intervalos cortos\n'
    '- Mantener trabajo de core 15 min al final de cada sesión',
    '2026-04-29 09:30:00+00', '2026-04-29 09:30:00+00'
  ),
  (
    v_patient, v_matias,
    'Kinesiología', 'external',
    'Terminamos la primera etapa — ¡muy bien!',
    E'Tomás, terminamos las primeras 4 semanas y los resultados son excelentes.\n\n'
    '- Tu dolor de espalda bajó muchísimo.\n'
    '- Tu core está mucho más estable.\n'
    '- Pudiste venir casi todas las sesiones — eso es lo que más importa.\n\n'
    'La semana que viene arrancamos con ejercicios de fuerza: sentadillas, peso muerto y algo de cardio.\n\n'
    'Vas a ver que con esta base que construiste, el cuerpo responde mucho mejor. ¡Seguimos!',
    '2026-04-29 09:35:00+00', '2026-04-29 09:35:00+00'
  ),
  (
    v_patient, v_matias,
    'Kinesiología', 'internal',
    'Sesión 16 — progresión de cargas',
    E'Sesión 16. Etapa 2, semana 3.\n\n'
    'Trabajo realizado:\n'
    '- Goblet squat: 4x12 con 16 kg (subimos de 12 kg) — técnica sólida\n'
    '- Peso muerto rumano: 4x10 con 30 kg — sin dolor lumbar\n'
    '- Remo con mancuerna: 3x12 por lado, 12 kg\n'
    '- Cardio: 20 min bicicleta estática a FC 135–145 lpm\n'
    '- Core: plancha frontal 3x50 seg + bird-dog 3x10\n\n'
    'Observaciones: paciente mejoró notablemente la resistencia aeróbica. Refiere que ya no se cansa al subir escaleras. Sin dolor lumbar post-entrenamiento.\n\n'
    'Próxima sesión: incorporar press banca con barra.',
    '2026-05-14 09:00:00+00', '2026-05-14 09:00:00+00'
  ),

-- ── PSICOLOGÍA ───────────────────────────────────────────────────────────────

  (
    v_patient, v_sofia,
    'Psicología', 'internal',
    'Primera sesión — ansiedad generalizada y estrés laboral',
    E'Primera sesión. Paciente no derivado (consulta espontánea).\n\n'
    'Motivo de consulta: "me cuesta desconectarme del trabajo, duermo mal y me preocupo demasiado por cosas que no puedo controlar".\n\n'
    'Historia clínica psicológica:\n'
    '- Sin tratamientos previos\n'
    '- Sin medicación psiquiátrica\n'
    '- Sin antecedentes de trauma o duelo reciente\n'
    '- Trabajo de alta demanda (tech, reuniones frecuentes, disponibilidad constante)\n'
    '- Vida social activa pero refiere "siempre estar pensando en el trabajo"\n\n'
    'Sintomatología presentada:\n'
    '- Dificultad para iniciar el sueño (latencia >45 min)\n'
    '- Preocupación excesiva y rumiación\n'
    '- Tensión muscular generalizada\n'
    '- Irritabilidad leve en casa\n'
    '- Sin síntomas depresivos significativos\n\n'
    'Impresión diagnóstica preliminar: Trastorno de Ansiedad Generalizada (F41.1) — leve a moderado.\n\n'
    'Enfoque terapéutico: TCC + técnicas de mindfulness. Frecuencia sugerida: 1 sesión semanal.\n\n'
    'Tarea para la próxima sesión: registrar en un cuaderno 3 situaciones de ansiedad durante la semana (situación, pensamiento automático, emoción, conducta).',
    '2026-03-18 18:00:00+00', '2026-03-18 18:00:00+00'
  ),
  (
    v_patient, v_sofia,
    'Psicología', 'internal',
    'Sesión 3 — técnicas de regulación emocional',
    E'Sesión 3. Paciente trae registro de la semana: 4 situaciones de ansiedad, todas relacionadas con trabajo (deadlines, reuniones inesperadas).\n\n'
    'Análisis funcional:\n'
    '- Situación disparadora: correo inesperado fuera de horario\n'
    '- Pensamiento automático: "si no respondo ahora van a pensar que soy irresponsable"\n'
    '- Emoción: ansiedad alta (8/10)\n'
    '- Conducta: responde inmediatamente aunque sea tarde, no puede dormir después\n\n'
    'Trabajo en sesión:\n'
    '1. Identificación de distorsión cognitiva: "lectura de mente" y "catastrofización"\n'
    '2. Reestructuración cognitiva: evidencia a favor y en contra del pensamiento automático\n'
    '3. Introducción a la técnica de respiración 4-7-8 para reducción de activación fisiológica\n'
    '4. Establecimiento de "zonas horarias personales" — acordado no revisar correos laborales después de las 21:00\n\n'
    'El sueño mejoró levemente desde la sesión anterior. Paciente comprometido con los cambios.',
    '2026-04-01 18:00:00+00', '2026-04-01 18:00:00+00'
  ),
  (
    v_patient, v_sofia,
    'Psicología', 'external',
    'Lo que trabajamos hoy — sesión 3',
    E'Tomás, acá te dejo un resumen de la sesión de hoy para que puedas releerlo durante la semana.\n\n'
    'El patrón que identificamos: cuando llega un mensaje de trabajo fuera de horario, tu cabeza automáticamente piensa "si no respondo ya, algo malo va a pasar". Eso no es un hecho — es una interpretación, y casi siempre exagerada.\n\n'
    'Lo que te propongo esta semana:\n'
    '1. Cuando aparezca ese pensamiento, hacete esta pregunta: ¿Tengo evidencia real de que algo malo pasó alguna vez por no responder de noche?\n'
    '2. Practicá la respiración 4-7-8 (inhalar 4 seg, retener 7, exhalar 8) cuando notes que la ansiedad sube.\n'
    '3. Después de las 21:00, el teléfono va al modo no molesten. Una semana de prueba.\n\n'
    'No es magia — es práctica. Nos vemos la semana que viene.',
    '2026-04-01 18:10:00+00', '2026-04-01 18:10:00+00'
  ),
  (
    v_patient, v_sofia,
    'Psicología', 'internal',
    'Sesión 6 — consolidación de logros, exploración de origen',
    E'Sesión 6. Evolución general positiva.\n\n'
    'Cambios reportados desde el inicio:\n'
    '- Sueño: latencia reducida a ~20 min (desde >45 min)\n'
    '- Ansiedad general: 4–5/10 (desde 7–8/10)\n'
    '- Implementó "zona horaria personal" — cumplimiento 80%\n'
    '- Irritabilidad en casa: mejora notable según reporte propio\n\n'
    'En esta sesión empezamos a explorar el origen de la hiperresponsabilidad laboral. Paciente relaciona con exigencia paterna durante la infancia y necesidad de aprobación. No hay trauma, pero sí un esquema aprendido de "soy valioso si produzco".\n\n'
    'Se introduce la diferencia entre valor personal y desempeño laboral.\n\n'
    'Tarea: escribir 5 cosas que le generan satisfacción que no tengan nada que ver con el trabajo.',
    '2026-05-06 18:00:00+00', '2026-05-06 18:00:00+00'
  ),
  (
    v_patient, v_sofia,
    'Psicología', 'external',
    'Avance en el proceso — sesión 6',
    E'Tomás, llevás 6 sesiones y el progreso es real y visible.\n\n'
    'Dormís mejor. La ansiedad bajó. Pudiste empezar a poner límites laborales — eso no es fácil.\n\n'
    'Lo que trabajamos hoy es más profundo: de dónde viene la sensación de que "tenés que estar disponible siempre". No es algo que se cambie de un día para el otro, pero el solo hecho de poder verlo ya es un gran paso.\n\n'
    'Para esta semana: escribí 5 cosas que te generen satisfacción o alegría que no tengan nada que ver con el trabajo. Puede ser cualquier cosa — cocinar, ver una peli, salir a caminar.\n\n'
    'Nos vemos el martes que viene.',
    '2026-05-06 18:10:00+00', '2026-05-06 18:10:00+00'
  );

END $$;
