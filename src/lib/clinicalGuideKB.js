/**
 * Guía clínica de la consulta — contenido de APOYO al profesional durante la
 * videollamada, pestaña "Hoy" (`ClinicalPanel` en
 * `pages/professional/VideoCall.jsx`).
 *
 * Origen: contenido clínico armado por Nacho (CEO) en un prototipo aparte,
 * pasado a Mateo el 2026-08-07 y exportado en
 * `docs/referencia-preguntas-consulta-nacho.js` (ESO es sólo referencia, no se
 * importa desde acá — este archivo es el que vive en `src/` y se porta a mano,
 * a propósito, ver la nota de "Por qué un módulo JS" más abajo).
 *
 * Por qué un módulo JS y no una tabla de Supabase: es contenido clínico sin
 * revisión médica formal todavía. Cambiarlo tiene que pasar por una revisión de
 * código (PR, diff, quién lo tocó), no por un campo editable en `/super-admin`
 * un martes cualquiera. Es lo opuesto al catálogo de especialidades, que sí es
 * config operativa y vive en base — acá el riesgo no es operativo, es clínico.
 *
 * Por cada motivo de consulta:
 *   q  → preguntas dirigidas para hacerle al paciente EN la llamada
 *   rf → banderas rojas (lo que hay que descartar activamente)
 *   dx → diagnósticos diferenciales: [nombre, código CIE-10, urgente(1) o no(0)]
 *   ex → maniobras de examen físico sugeridas
 *   st → estudios complementarios sugeridos
 *
 * Es material de apoyo al razonamiento y a la documentación. No reemplaza el
 * juicio clínico ni constituye un diagnóstico — el disclaimer que acompaña a
 * este contenido en pantalla (`DISCLAIMER` más abajo) lo dice explícitamente y
 * tiene que seguir viéndose donde sea que se use este módulo.
 */

export const DISCLAIMER =
  'Esto es una ayuda para guiar la consulta y documentarla más rápido — no reemplaza tu criterio clínico ni es un diagnóstico. La decisión es siempre tuya.'

export const CLINICAL_GUIDE_KB = {
  'Dolor torácico': {
    q: ['¿Carácter: opresivo, punzante o quemante?', '¿Irradia a brazo izquierdo, cuello o mandíbula?', '¿Aparece o empeora con el esfuerzo?', '¿Se modifica con la respiración o los movimientos?', '¿Se reproduce con la palpación?', '¿Sudoración, náuseas o disnea asociadas?', '¿Inicio súbito o progresivo? Duración.', 'Factores de riesgo CV: HTA, DBT, tabaco, dislipemia.'],
    rf: ['Dolor opresivo + esfuerzo + irradiación (sospecha de SCA)', 'Inicio súbito desgarrante irradiado a espalda (disección aórtica)', 'Disnea súbita + dolor pleurítico + riesgo de TEP', 'Síncope o hipotensión', 'Asimetría de pulsos o TA entre brazos'],
    dx: [['Síndrome coronario agudo', 'I24.9', 1], ['Angina estable', 'I20.9', 0], ['Tromboembolismo pulmonar', 'I26.9', 1], ['Disección aórtica', 'I71.0', 1], ['Pericarditis aguda', 'I30.9', 0], ['Dolor musculoesquelético', 'M94.0', 0], ['Reflujo gastroesofágico', 'K21.9', 0], ['Crisis de ansiedad', 'F41.0', 0]],
    ex: ['Auscultación cardíaca (soplos, R3/R4, roce)', 'Auscultación pulmonar comparativa', 'Palpación de pared torácica', 'Pulsos y TA en ambos brazos', 'Signos de TVP en MMII'],
    st: ['ECG de 12 derivaciones (< 10 min)', 'Troponina de alta sensibilidad', 'Radiografía de tórax', 'Dímero D si sospecha de TEP (baja prob.)', 'Score HEART / Wells según sospecha'],
  },
  'Disnea': {
    q: ['¿Aguda, subaguda o crónica?', '¿En reposo o con esfuerzo? Clase funcional.', '¿Ortopnea o disnea paroxística nocturna?', '¿Sibilancias, tos o expectoración?', '¿Dolor torácico o palpitaciones?', '¿Edemas en MMII?', '¿Fiebre o síntomas infecciosos?', 'Antecedentes: cardiopatía, EPOC/asma, tabaco.'],
    rf: ['Disnea de reposo con uso de músculos accesorios', 'Saturación < 92% o cianosis', 'Estridor o incapacidad para hablar en frases', 'Dolor torácico o síncope asociados', 'Hipotensión o mala perfusión'],
    dx: [['Insuficiencia cardíaca descompensada', 'I50.9', 0], ['Neumonía', 'J18.9', 0], ['Exacerbación de EPOC', 'J44.1', 0], ['Crisis asmática', 'J45.9', 0], ['Tromboembolismo pulmonar', 'I26.9', 1], ['Anemia', 'D64.9', 0], ['Neumotórax', 'J93.9', 1], ['Ansiedad / hiperventilación', 'F41.0', 0]],
    ex: ['Saturometría y frecuencia respiratoria', 'Auscultación pulmonar (crepitantes, sibilancias)', 'Auscultación cardíaca e ingurgitación yugular', 'Edemas y signos de TVP', 'Uso de musculatura accesoria'],
    st: ['Saturación / gasometría si grave', 'Radiografía de tórax', 'ECG', 'Hemograma', 'BNP/NT-proBNP, dímero D según sospecha'],
  },
  'Dolor abdominal': {
    q: ['Localización e irradiación (¿migró?)', '¿Cólico, constante o urente?', 'Relación con comidas y defecación', 'Náuseas, vómitos, diarrea o constipación', 'Fiebre, síntomas urinarios o ginecológicos', 'FUM y posibilidad de embarazo', 'Inicio y tiempo de evolución', 'Antecedentes quirúrgicos; AINE/anticoagulantes.'],
    rf: ['Abdomen en tabla / reacción peritoneal', 'Dolor intenso de inicio súbito', 'Distensión sin eliminación de gases/heces', 'Hematemesis, melena o hematoquecia', 'Inestabilidad hemodinámica', 'Embarazo con dolor y sangrado (ectópico)'],
    dx: [['Apendicitis aguda', 'K35.80', 0], ['Colecistitis / cólico biliar', 'K81.9', 0], ['Pancreatitis aguda', 'K85.9', 0], ['Obstrucción intestinal', 'K56.6', 0], ['Infección urinaria / pielonefritis', 'N39.0', 0], ['Diverticulitis', 'K57.9', 0], ['Úlcera perforada', 'K27.5', 1], ['Embarazo ectópico', 'O00.9', 1]],
    ex: ['Auscultación de ruidos hidroaéreos', 'Blumberg, Murphy, McBurney', 'Puñopercusión lumbar', 'Tacto rectal si sangrado/obstrucción', 'Examen ginecológico si corresponde'],
    st: ['Hemograma, PCR', 'Función renal/hepática, amilasa/lipasa', 'Orina completa', 'β-hCG en mujer en edad fértil', 'Ecografía / TC según sospecha'],
  },
  'Cefalea': {
    q: ['¿La peor cefalea de su vida? ¿Inicio en trueno?', 'Localización, carácter e intensidad', 'Patrón temporal y progresión', 'Náuseas, fotofobia, aura, síntomas visuales', 'Fiebre, rigidez de nuca', 'Déficit neurológico focal', 'Cambios con Valsalva o postura', 'Migraña previa; sobreuso de analgésicos.'],
    rf: ['Cefalea en trueno (máxima en segundos)', 'Fiebre + rigidez de nuca (meningismo)', 'Déficit focal o alteración de conciencia', 'Nueva > 50 años o cambio de patrón', 'Papiledema / HT endocraneana', 'Inmunosupresión o cáncer conocido'],
    dx: [['Migraña', 'G43.9', 0], ['Cefalea tensional', 'G44.2', 0], ['Cefalea en racimos', 'G44.0', 0], ['Hemorragia subaracnoidea', 'I60.9', 1], ['Meningitis', 'G03.9', 1], ['Arteritis de células gigantes', 'M31.6', 1], ['Cefalea por sobreuso', 'G44.4', 0]],
    ex: ['Examen neurológico completo', 'Signos meníngeos (Kernig, Brudzinski)', 'Fondo de ojo', 'Palpación de arteria temporal', 'Estado de conciencia (Glasgow)'],
    st: ['TC de cráneo si banderas rojas', 'Punción lumbar si HSA/meningitis (post-TC)', 'VSG/PCR si sospecha de arteritis', 'Laboratorio básico'],
  },
  'Fiebre': {
    q: ['Tiempo de evolución y patrón', 'Foco: respiratorio, urinario, digestivo, piel, SNC', 'Escalofríos, sudoración nocturna, peso', 'Viajes, contacto con enfermos, animales', 'Inmunosupresión, ATB reciente', 'Medicación (fiebre por fármacos)', 'Síntomas localizadores por sistema.'],
    rf: ['Signos de sepsis (qSOFA)', 'Rigidez de nuca o rash purpúrico', 'Neutropenia o inmunosupresión', 'Fiebre > 5-7 días sin foco', 'Compromiso hemodinámico'],
    dx: [['Infección respiratoria / neumonía', 'J18.9', 0], ['Infección urinaria', 'N39.0', 0], ['Gastroenteritis infecciosa', 'A09', 0], ['Celulitis', 'L03.9', 0], ['Sepsis', 'A41.9', 1], ['Meningitis', 'G03.9', 1], ['Síndrome viral inespecífico', 'B34.9', 0]],
    ex: ['Estado general y signos vitales', 'Auscultación cardiopulmonar', 'Abdomen y puñopercusión lumbar', 'Piel y adenopatías', 'Signos meníngeos'],
    st: ['Hemograma con fórmula, PCR', 'Hemocultivos si sospecha de sepsis', 'Orina y urocultivo', 'Radiografía de tórax', 'Lactato si sepsis'],
  },
  'Tos': {
    q: ['Aguda, subaguda o crónica', 'Seca o productiva; esputo', 'Hemoptisis', 'Fiebre, disnea o dolor torácico', 'Goteo posnasal / vía aérea superior', 'Reflujo, uso de IECA', 'Tabaco, exposiciones, contexto de TBC.'],
    rf: ['Hemoptisis', 'Disnea o hipoxemia', 'Peso y sudoración nocturna (TBC/neoplasia)', 'Fiebre alta con foco pulmonar', 'Estridor o disnea progresiva'],
    dx: [['IRA viral', 'J06.9', 0], ['Bronquitis aguda', 'J20.9', 0], ['Neumonía', 'J18.9', 0], ['Asma', 'J45.9', 0], ['EPOC', 'J44.9', 0], ['Tuberculosis', 'A15.9', 0], ['Tos por IECA / reflujo', 'R05', 0]],
    ex: ['Auscultación pulmonar', 'Saturometría', 'Fauces y adenopatías cervicales', 'Signos de consolidación', 'Estado general y peso'],
    st: ['Radiografía de tórax si persistente/foco', 'Saturación de O₂', 'Baciloscopía si sospecha de TBC', 'Espirometría si crónica'],
  },
  'Lumbalgia': {
    q: ['Mecánica vs inflamatoria (rigidez matinal)', 'Irradiación a MMII (ciática) y trayecto', 'Trauma o esfuerzo', 'Déficit motor/sensitivo o esfinteriano', 'Fiebre, peso, antecedente oncológico', 'Corticoides, inmunosupresión, drogas EV', 'Tiempo de evolución.'],
    rf: ['Alteración esfinteriana / anestesia en silla de montar', 'Déficit motor progresivo', 'Fiebre + dolor (espondilodiscitis)', 'Cáncer o pérdida de peso', 'Trauma / osteoporosis (fractura)', '< 20 o > 50 años con dolor nuevo'],
    dx: [['Lumbalgia mecánica inespecífica', 'M54.5', 0], ['Lumbociática / hernia discal', 'M51.1', 0], ['Cauda equina', 'G83.4', 1], ['Espondilodiscitis / absceso', 'M46.4', 1], ['Fractura vertebral', 'S32.0', 0], ['Metástasis vertebral', 'C79.5', 1]],
    ex: ['Inspección y palpación de columna', 'Lasègue / elevación de pierna recta', 'Fuerza, reflejos y sensibilidad MMII', 'Tono esfinteriano si banderas', 'Marcha'],
    st: ['Sin imágenes en 4-6 sem sin banderas rojas', 'RM urgente si cauda / infección / tumor', 'VSG/PCR si inflamatoria/infecciosa', 'Rx si sospecha de fractura'],
  },
  'Mareo / vértigo': {
    q: ['¿Vértigo, presíncope, desequilibrio o inespecífico?', 'Desencadenado por movimientos de cabeza', 'Duración de los episodios', 'Síntomas auditivos (hipoacusia, acúfenos)', 'Síntomas neurológicos (diplopía, disartria, ataxia)', 'Fármacos, hipotensión ortostática', 'Factores de riesgo CV.'],
    rf: ['Signos neurológicos focales (central)', 'Cefalea intensa o súbita', 'Nistagmo vertical o no inhibido por fijación', 'Ataxia desproporcionada', 'Riesgo vascular con inicio agudo'],
    dx: [['Vértigo posicional (VPPB)', 'H81.1', 0], ['Neuronitis vestibular', 'H81.2', 0], ['Enfermedad de Ménière', 'H81.0', 0], ['Hipotensión ortostática', 'I95.1', 0], ['ACV/AIT de fosa posterior', 'I63.9', 1], ['Vértigo farmacológico', 'T50.9', 0]],
    ex: ['Dix-Hallpike', 'Impulso cefálico (HINTS si agudo)', 'Neurológico y pares craneales', 'TA acostado y de pie', 'Otoscopia y Romberg'],
    st: ['Habitualmente clínico', 'TC/RM si patrón central o banderas', 'Glucemia, ionograma', 'ECG si presíncope'],
  },
  'Astenia / fatiga': {
    q: ['Tiempo de evolución y curso', '¿Fatigabilidad, somnolencia o disnea de esfuerzo?', 'Pérdida de peso, fiebre, sudoración nocturna', 'Sueño y ánimo (screening de depresión)', 'Síntomas por sistema (tiroideo, anemia, cardíaco)', 'Medicación y alcohol', 'Impacto funcional.'],
    rf: ['Pérdida de peso involuntaria', 'Fiebre o sudoración nocturna persistente', 'Adenopatías, visceromegalias o sangrado', 'Disnea o dolor torácico de esfuerzo', 'Síntomas neurológicos focales'],
    dx: [['Anemia', 'D64.9', 0], ['Hipotiroidismo', 'E03.9', 0], ['Depresión', 'F32.9', 0], ['Diabetes mellitus', 'E11.9', 0], ['Apnea del sueño', 'G47.3', 0], ['Fatiga crónica', 'G93.3', 0], ['Neoplasia oculta', 'C80.1', 1]],
    ex: ['Palidez, ictericia, estado general', 'Palpación tiroidea', 'Adenopatías y visceromegalias', 'Auscultación cardiopulmonar', 'Neurológico básico'],
    st: ['Hemograma', 'TSH', 'Glucemia / HbA1c', 'Función renal/hepática, ionograma', 'Ferritina, VSG, serologías según sospecha'],
  },
  'Odinofagia': {
    q: ['Tiempo de evolución', 'Fiebre, exudado, adenopatías', 'Tos y coriza (orientan a viral)', 'Dificultad para tragar saliva / abrir la boca', 'Disnea o estridor', 'Contacto con faringitis estreptocócica', 'Criterios de Centor.'],
    rf: ['Estridor o dificultad respiratoria', 'No puede tragar saliva / babeo', 'Trismus o voz "en papa caliente"', 'Edema/asimetría faríngea marcada', 'Rigidez de nuca'],
    dx: [['Faringitis viral', 'J02.9', 0], ['Faringitis estreptocócica', 'J02.0', 0], ['Mononucleosis', 'B27.9', 0], ['Absceso periamigdalino', 'J36', 1], ['Epiglotitis', 'J05.1', 1]],
    ex: ['Fauces (exudado, asimetría)', 'Adenopatías cervicales', 'Temperatura', 'Evaluación de vía aérea', 'Abdomen (esplenomegalia si MNI)'],
    st: ['Test rápido de estreptococo según Centor', 'Sin estudios si claramente viral', 'Monotest si sospecha de MNI'],
  },
}

/**
 * Motivos de consulta con guía clínica disponible, en el orden en que se
 * ofrecen en el selector.
 */
export const GUIDE_MOTIVOS = Object.keys(CLINICAL_GUIDE_KB)

/**
 * Especialidades (`professional_profiles.specialty`) que recetan y examinan
 * de esta forma — mismo criterio que ya se usa para habilitar recetas (ver
 * migración de vertical_settings / catchup 2026-08-06: "arranca prendido sólo
 * en medicina_general y pediatria"). Cardiología y Dermatología están en el
 * catálogo pero hoy no hay ningún profesional dado de alta con ellas.
 */
export const CLINICAL_GUIDE_SPECIALTIES = ['medicina_general', 'pediatria']

/**
 * Mapeo del catálogo de síntomas de la pre-consulta (`src/data/symptoms.js`,
 * id de cada síntoma) al motivo de guía clínica correspondiente, para
 * preseleccionar el motivo en la pestaña "Hoy" sin que el profesional tenga
 * que elegirlo de nuevo si el paciente ya lo declaró.
 *
 * No todos los síntomas de la pre-consulta tienen guía clínica todavía (p.ej.
 * "Náuseas o vómitos", "Diarrea", "Manchas o sarpullido", "Dolor de oído",
 * "Otro motivo") — para esos no hay preselección y el profesional elige del
 * selector manualmente.
 */
export const SYMPTOM_ID_TO_MOTIVO = {
  fiebre: 'Fiebre',
  tos: 'Tos',
  dolor_garganta: 'Odinofagia',
  dolor_cabeza: 'Cefalea',
  dolor_abdominal: 'Dolor abdominal',
  falta_aire: 'Disnea',
  dolor_pecho: 'Dolor torácico',
  mareos: 'Mareo / vértigo',
  dolor_espalda: 'Lumbalgia',
  cansancio: 'Astenia / fatiga',
}

/**
 * Motivo de guía clínica sugerido a partir de la pre-consulta del paciente
 * (`consultations.preconsulta_data`, formato v2 con `symptom.id`). Devuelve
 * `null` si no hay pre-consulta, es formato v1 (texto libre) o el síntoma no
 * tiene guía asociada.
 */
export function suggestMotivoFromPreconsulta(preconsulta) {
  const symptomId = preconsulta?.symptom?.id
  if (!symptomId) return null
  return SYMPTOM_ID_TO_MOTIVO[symptomId] ?? null
}
