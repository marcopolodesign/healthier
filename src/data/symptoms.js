/**
 * Catálogo de síntomas de la pre-consulta.
 *
 * Por qué ICD-10 y no una lista suelta: la historia clínica ya codifica
 * `clinical_conditions` con `icd10_code` / `icd10_display` siguiendo las
 * convenciones de OpenEMR (ver CLAUDE.md del monorepo). Si el paciente elige
 * un síntoma de una lista libre, esa respuesta muere en un textarea y no se
 * puede cruzar con nada. Codificándolo acá, el motivo de consulta entra al
 * sistema con el mismo vocabulario que después usa el profesional al cargar
 * una condición — y a futuro se puede pre-cargar la condición desde el síntoma.
 *
 * Los códigos salen del capítulo XVIII de ICD-10 (R00–R99, "Síntomas, signos y
 * hallazgos anormales clínicos y de laboratorio"), que es el capítulo pensado
 * exactamente para esto: lo que el paciente refiere, antes de que haya
 * diagnóstico. Dos excepciones deliberadas donde el capítulo R no tiene entrada
 * razonable: otalgia (H92.0) y lumbalgia (M54.5).
 *
 * `redFlag: true` en una opción NO decide nada por sí solo — no hay triage
 * automático acá. Solo hace que esa respuesta se muestre destacada en el panel
 * del profesional, que es quien evalúa.
 */

/** Preguntas que aplican a cualquier síntoma. Se anteponen a las específicas. */
export const COMMON_QUESTIONS = [
  {
    id: 'duracion',
    label: '¿Hace cuánto que te pasa?',
    type: 'single',
    options: [
      { value: 'menos_24h', label: 'Menos de 24 horas' },
      { value: '1_3_dias',  label: 'Entre 1 y 3 días' },
      { value: '4_7_dias',  label: 'Entre 4 y 7 días' },
      { value: 'mas_semana', label: 'Más de una semana' },
      { value: 'mas_mes',    label: 'Más de un mes' },
    ],
  },
  {
    id: 'intensidad',
    label: '¿Qué tan intenso es?',
    type: 'single',
    options: [
      { value: 'leve',     label: 'Leve — molesta pero puedo seguir con mi día' },
      { value: 'moderada', label: 'Moderada — me cuesta hacer cosas normales' },
      { value: 'intensa',  label: 'Intensa — no puedo hacer mi vida normal', redFlag: true },
    ],
  },
  {
    id: 'evolucion',
    label: 'Desde que empezó, ¿cómo viene?',
    type: 'single',
    options: [
      { value: 'mejorando',  label: 'Mejorando' },
      { value: 'igual',      label: 'Igual' },
      { value: 'empeorando', label: 'Empeorando', redFlag: true },
    ],
  },
]

/** Pregunta final, común a todos: medicación actual. */
export const MEDICATION_QUESTION = {
  id: 'medicacion',
  label: '¿Estás tomando alguna medicación?',
  type: 'single_with_detail',
  options: [
    { value: 'no', label: 'No' },
    { value: 'si', label: 'Sí', detailLabel: '¿Cuál o cuáles?', detailRequired: true },
  ],
}

export const SYMPTOMS = [
  {
    id: 'fiebre',
    label: 'Fiebre',
    icd10Code: 'R50.9',
    icd10Display: 'Fiebre, no especificada',
    questions: [
      {
        id: 'temperatura',
        label: '¿Cuál fue la temperatura más alta que te tomaste?',
        type: 'single',
        options: [
          { value: 'no_medida', label: 'No me la tomé' },
          { value: 'menos_38',  label: 'Menos de 38°' },
          { value: '38_39',     label: 'Entre 38° y 39°' },
          { value: 'mas_39',    label: 'Más de 39°', redFlag: true },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Tenés alguno de estos junto con la fiebre?',
        type: 'multi',
        options: [
          { value: 'escalofrios', label: 'Escalofríos' },
          { value: 'sudoracion',  label: 'Sudoración' },
          { value: 'rigidez_nuca', label: 'Rigidez en el cuello', redFlag: true },
          { value: 'confusion',   label: 'Confusión o mucha somnolencia', redFlag: true },
          { value: 'ninguno',     label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'tos',
    label: 'Tos',
    icd10Code: 'R05',
    icd10Display: 'Tos',
    questions: [
      {
        id: 'tipo',
        label: '¿Cómo es la tos?',
        type: 'single',
        options: [
          { value: 'seca',       label: 'Seca' },
          { value: 'con_flema',  label: 'Con flema' },
          { value: 'con_sangre', label: 'Con sangre', redFlag: true },
        ],
      },
      {
        id: 'respiracion',
        label: '¿Te falta el aire?',
        type: 'single',
        options: [
          { value: 'no',        label: 'No' },
          { value: 'esfuerzo',  label: 'Solo al hacer esfuerzo' },
          { value: 'reposo',    label: 'También en reposo', redFlag: true },
        ],
      },
    ],
  },
  {
    id: 'dolor_garganta',
    label: 'Dolor de garganta',
    icd10Code: 'R07.0',
    icd10Display: 'Dolor de garganta',
    questions: [
      {
        id: 'tragar',
        label: '¿Podés tragar?',
        type: 'single',
        options: [
          { value: 'normal',      label: 'Sí, con molestia' },
          { value: 'dificultad',  label: 'Me cuesta bastante' },
          { value: 'no_puedo',    label: 'No puedo tragar ni líquidos', redFlag: true },
        ],
      },
      {
        id: 'signos',
        label: '¿Ves alguno de estos?',
        type: 'multi',
        options: [
          { value: 'placas',      label: 'Placas o puntos blancos' },
          { value: 'ganglios',    label: 'Ganglios hinchados en el cuello' },
          { value: 'voz',         label: 'Cambio en la voz' },
          { value: 'ninguno',     label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'dolor_cabeza',
    label: 'Dolor de cabeza',
    icd10Code: 'R51',
    icd10Display: 'Cefalea',
    questions: [
      {
        id: 'inicio',
        label: '¿Cómo empezó?',
        type: 'single',
        options: [
          { value: 'gradual', label: 'De a poco' },
          { value: 'subito',  label: 'De golpe, muy fuerte', redFlag: true },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'luz',        label: 'Me molesta la luz' },
          { value: 'nauseas',    label: 'Náuseas o vómitos' },
          { value: 'vision',     label: 'Cambios en la visión', redFlag: true },
          { value: 'debilidad',  label: 'Debilidad o hormigueo en un lado del cuerpo', redFlag: true },
          { value: 'ninguno',    label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'dolor_abdominal',
    label: 'Dolor de panza',
    icd10Code: 'R10.4',
    icd10Display: 'Dolor abdominal, otro y no especificado',
    questions: [
      {
        id: 'ubicacion',
        label: '¿Dónde te duele más?',
        type: 'single',
        options: [
          { value: 'arriba',       label: 'Arriba, en la boca del estómago' },
          { value: 'abajo_der',    label: 'Abajo a la derecha', redFlag: true },
          { value: 'abajo_izq',    label: 'Abajo a la izquierda' },
          { value: 'todo',         label: 'En toda la panza' },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'vomitos',   label: 'Vómitos' },
          { value: 'diarrea',   label: 'Diarrea' },
          { value: 'fiebre',    label: 'Fiebre' },
          { value: 'sangre',    label: 'Sangre en la materia fecal', redFlag: true },
          { value: 'ninguno',   label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'nauseas_vomitos',
    label: 'Náuseas o vómitos',
    icd10Code: 'R11',
    icd10Display: 'Náusea y vómito',
    questions: [
      {
        id: 'frecuencia',
        label: '¿Cuántas veces vomitaste en las últimas 24 horas?',
        type: 'single',
        options: [
          { value: 'ninguna',  label: 'Ninguna, solo náuseas' },
          { value: '1_3',      label: 'Entre 1 y 3 veces' },
          { value: 'mas_3',    label: 'Más de 3 veces', redFlag: true },
        ],
      },
      {
        id: 'liquidos',
        label: '¿Podés retener líquidos?',
        type: 'single',
        options: [
          { value: 'si',  label: 'Sí' },
          { value: 'no',  label: 'No, vomito todo lo que tomo', redFlag: true },
        ],
      },
    ],
  },
  {
    id: 'diarrea',
    label: 'Diarrea',
    icd10Code: 'R19.7',
    icd10Display: 'Diarrea, no especificada',
    questions: [
      {
        id: 'frecuencia',
        label: '¿Cuántas deposiciones por día?',
        type: 'single',
        options: [
          { value: 'menos_4', label: 'Menos de 4' },
          { value: '4_8',     label: 'Entre 4 y 8' },
          { value: 'mas_8',   label: 'Más de 8', redFlag: true },
        ],
      },
      {
        id: 'signos',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'sangre',      label: 'Sangre o moco', redFlag: true },
          { value: 'fiebre',      label: 'Fiebre' },
          { value: 'deshidratado', label: 'Mucha sed, boca seca, orino poco', redFlag: true },
          { value: 'ninguno',     label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'falta_aire',
    label: 'Falta de aire',
    icd10Code: 'R06.0',
    icd10Display: 'Disnea',
    questions: [
      {
        id: 'cuando',
        label: '¿Cuándo te falta el aire?',
        type: 'single',
        options: [
          { value: 'esfuerzo_grande', label: 'Solo con esfuerzo grande' },
          { value: 'esfuerzo_leve',   label: 'Con esfuerzo leve, como caminar' },
          { value: 'reposo',          label: 'También estando quieto', redFlag: true },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'dolor_pecho', label: 'Dolor en el pecho', redFlag: true },
          { value: 'labios',      label: 'Labios o dedos azulados', redFlag: true },
          { value: 'silbidos',    label: 'Silbidos al respirar' },
          { value: 'ninguno',     label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'dolor_pecho',
    label: 'Dolor en el pecho',
    icd10Code: 'R07.4',
    icd10Display: 'Dolor en el pecho, no especificado',
    questions: [
      {
        id: 'caracter',
        label: '¿Cómo es el dolor?',
        type: 'single',
        options: [
          { value: 'opresivo',  label: 'Como un peso o presión', redFlag: true },
          { value: 'punzante',  label: 'Punzante' },
          { value: 'quema',     label: 'Ardor, como acidez' },
        ],
      },
      {
        id: 'irradiacion',
        label: '¿Se corre a algún lado?',
        type: 'multi',
        options: [
          { value: 'brazo',    label: 'Al brazo izquierdo', redFlag: true },
          { value: 'mandibula', label: 'A la mandíbula o el cuello', redFlag: true },
          { value: 'espalda',  label: 'A la espalda' },
          { value: 'ninguno',  label: 'No se corre', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'erupcion',
    label: 'Manchas o sarpullido en la piel',
    icd10Code: 'R21',
    icd10Display: 'Erupción cutánea y otras erupciones no especificadas',
    questions: [
      {
        id: 'extension',
        label: '¿Dónde lo tenés?',
        type: 'single',
        options: [
          { value: 'una_zona',  label: 'En una sola zona' },
          { value: 'varias',    label: 'En varias zonas' },
          { value: 'todo',      label: 'En casi todo el cuerpo', redFlag: true },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'picazon',   label: 'Pica mucho' },
          { value: 'fiebre',    label: 'Fiebre' },
          { value: 'hinchazon', label: 'Hinchazón en cara, labios o lengua', redFlag: true },
          { value: 'ampollas',  label: 'Ampollas', redFlag: true },
          { value: 'ninguno',   label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'mareos',
    label: 'Mareos',
    icd10Code: 'R42',
    icd10Display: 'Mareo y desvanecimiento',
    questions: [
      {
        id: 'tipo',
        label: '¿Cómo es el mareo?',
        type: 'single',
        options: [
          { value: 'giro',       label: 'Como si todo girara' },
          { value: 'inestable',  label: 'Inestabilidad al caminar' },
          { value: 'desmayo',    label: 'Sensación de que me voy a desmayar', redFlag: true },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'perdida',   label: 'Perdí el conocimiento', redFlag: true },
          { value: 'habla',     label: 'Dificultad para hablar', redFlag: true },
          { value: 'oido',      label: 'Zumbido o pérdida de audición' },
          { value: 'ninguno',   label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'dolor_oido',
    label: 'Dolor de oído',
    icd10Code: 'H92.0',
    icd10Display: 'Otalgia',
    questions: [
      {
        id: 'lado',
        label: '¿En qué oído?',
        type: 'single',
        options: [
          { value: 'derecho',  label: 'Derecho' },
          { value: 'izquierdo', label: 'Izquierdo' },
          { value: 'ambos',    label: 'Los dos' },
        ],
      },
      {
        id: 'signos',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'secrecion', label: 'Le sale líquido o pus', redFlag: true },
          { value: 'fiebre',    label: 'Fiebre' },
          { value: 'audicion',  label: 'Escucho menos' },
          { value: 'ninguno',   label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'dolor_espalda',
    label: 'Dolor de espalda o cintura',
    icd10Code: 'M54.5',
    icd10Display: 'Lumbago no especificado',
    questions: [
      {
        id: 'origen',
        label: '¿Empezó después de algo puntual?',
        type: 'single',
        options: [
          { value: 'esfuerzo', label: 'Después de un esfuerzo o mal movimiento' },
          { value: 'golpe',    label: 'Después de un golpe o caída', redFlag: true },
          { value: 'solo',     label: 'Empezó solo, sin motivo claro' },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'pierna',   label: 'Se corre a la pierna' },
          { value: 'hormigueo', label: 'Hormigueo o debilidad en las piernas', redFlag: true },
          { value: 'esfinteres', label: 'Dificultad para controlar orina o materia fecal', redFlag: true },
          { value: 'ninguno',  label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
  {
    id: 'cansancio',
    label: 'Cansancio o debilidad',
    icd10Code: 'R53.83',
    icd10Display: 'Otra fatiga',
    questions: [
      {
        id: 'impacto',
        label: '¿Cuánto te limita?',
        type: 'single',
        options: [
          { value: 'poco',   label: 'Puedo hacer mi vida normal' },
          { value: 'bastante', label: 'Me cuesta bastante el día a día' },
          { value: 'mucho',  label: 'Casi no me puedo levantar', redFlag: true },
        ],
      },
      {
        id: 'acompanantes',
        label: '¿Alguno de estos?',
        type: 'multi',
        options: [
          { value: 'peso',     label: 'Bajé de peso sin proponérmelo', redFlag: true },
          { value: 'fiebre',   label: 'Fiebre' },
          { value: 'sueno',    label: 'Duermo mal' },
          { value: 'ninguno',  label: 'Ninguno de estos', exclusive: true },
        ],
      },
    ],
  },
]

/**
 * Salida de emergencia para lo que el catálogo no cubre. Sin esto, un paciente
 * con un motivo no listado no puede avanzar, que es peor que una respuesta sin
 * codificar. Va explícitamente sin `icd10Code` para que el profesional vea que
 * este motivo NO está codificado, y para que no ensucie ninguna métrica.
 */
export const OTHER_SYMPTOM = {
  id: 'otro',
  label: 'Otro motivo',
  icd10Code: null,
  icd10Display: null,
  freeText: true,
  freeTextLabel: '¿Qué te pasa? Contanos en pocas palabras',
  questions: [],
}

/** Todos los síntomas seleccionables, con "Otro motivo" siempre al final. */
export const ALL_SYMPTOMS = [...SYMPTOMS, OTHER_SYMPTOM]

export function getSymptom(id) {
  return ALL_SYMPTOMS.find(s => s.id === id) ?? null
}

/** Preguntas efectivas para un síntoma: las comunes primero, después las suyas. */
export function questionsFor(symptom) {
  if (!symptom || symptom.freeText) return COMMON_QUESTIONS
  return [...COMMON_QUESTIONS, ...symptom.questions]
}
