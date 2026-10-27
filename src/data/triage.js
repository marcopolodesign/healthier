/**
 * Triage de la pre-consulta, uno por vertical (Mateo, 2026-10-27).
 *
 * Hasta acá todas las verticales usaban el catálogo de síntomas de Clínica
 * (`symptoms.js`): alguien que pedía una psicóloga tenía que elegir entre
 * "Fiebre" y "Dolor de pecho". Cada vertical arma ahora su propio recorrido con
 * lo que el paciente quiere contar y lo que el profesional necesita sí o sí
 * para atenderlo bien — nada más.
 *
 * Un triage tiene tres partes, que son los tres pasos del formulario:
 *
 *   motivo  — paso 1. `tipo: 'lista'` (elegir uno de `opciones`, cada una con su
 *             código CIE-10 y sus preguntas) o `tipo: 'abierto'` (un campo de
 *             texto, opcional o no). En psicología es abierto: el motivo se
 *             cuenta con palabras, no se elige de una lista.
 *   antes / despues — paso 2. Preguntas comunes de la vertical, antes y
 *             después de las propias del motivo elegido. Si no queda ninguna
 *             pregunta, el paso no se muestra.
 *   cierre  — paso 3 (medicación, alergias, peso). `null` lo saltea: una
 *             psicóloga no receta, así que no se le pregunta al paciente qué toma.
 *
 * Tipos de pregunta: 'single', 'multi', 'single_with_detail' (una opción pide
 * detalle), 'texto' (campo libre, `opcional`) y 'numero' (`unidad`, y
 * `opcionNoSe` para quien no lo sabe — ej. el peso de un chico).
 *
 * El payload que sale es el mismo `version: 2` de siempre (symptom + answers +
 * medication), así que el panel del profesional, el pedido de consulta
 * inmediata y la Edge Function `ondemand-despacho` lo leen sin cambios. La
 * pregunta con id `medicacion` va a `medication`; el resto, a `answers`.
 *
 * `redFlag` sigue sin decidir nada solo: destaca la respuesta para el
 * profesional. `aviso` le muestra un recuadro al paciente cuando elige esa opción
 * (frase, botones para llamar, emergencias y un cierre) y no frena el pedido.
 * Hoy ninguna opción lo usa: era de la pregunta de riesgo de salud mental, que
 * Mateo sacó el 2026-10-27. Queda el soporte por si vuelve.
 *
 * 🔴 Copia en `mobile/src/data/triage.ts`. Si se cambia una, se cambia la otra.
 */
import { SYMPTOMS, OTHER_SYMPTOM, COMMON_QUESTIONS, MEDICATION_QUESTION } from './symptoms'

// ── Preguntas que se repiten entre verticales ────────────────────────────────

const DURACION = COMMON_QUESTIONS.find(q => q.id === 'duracion')

const INTENSIDAD = COMMON_QUESTIONS.find(q => q.id === 'intensidad')

const ALERGIAS = {
  id: 'alergias',
  label: '¿Tenés alergia a algún medicamento?',
  type: 'single_with_detail',
  options: [
    { value: 'no', label: 'No' },
    { value: 'no_se', label: 'No sé' },
    { value: 'si', label: 'Sí', detailLabel: '¿A cuál?', detailRequired: true },
  ],
}

const otro = (freeTextLabel = '¿Qué te pasa? Contanos en pocas palabras') => ({ ...OTHER_SYMPTOM, freeTextLabel })

const sinAlarma = (id, label, opciones) => ({
  id,
  label,
  type: 'multi',
  options: [
    ...opciones.map(([value, label]) => ({ value, label, redFlag: true })),
    { value: 'ninguno', label: 'Ninguno de estos', exclusive: true },
  ],
})

// ── Clínica ──────────────────────────────────────────────────────────────────
// El catálogo de siempre. Suma alergias: es lo que el médico necesita antes de
// recetar y hoy lo tenía que preguntar en la llamada.

const CLINICA = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué te pasa?',
    ayuda: 'Elegí lo que más te molesta. El profesional lo lee antes de aceptar.',
    opciones: [...SYMPTOMS, OTHER_SYMPTOM],
  },
  antes: COMMON_QUESTIONS,
  despues: [],
  cierre: { titulo: 'Medicación y alergias', preguntas: [MEDICATION_QUESTION, ALERGIAS] },
}

// ── Pediatría ────────────────────────────────────────────────────────────────
// Contesta un adulto por un chico: todo en tercera persona. Lo que el pediatra
// necesita sí o sí es cómo está el chico (activo o decaído), si se hidrata, y
// el peso — sin peso no puede calcular una dosis.

const PEDIATRIA = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué le pasa?',
    ayuda: 'Elegí lo que más le molesta. El pediatra lo lee antes de aceptar.',
    opciones: [
      {
        id: 'fiebre', label: 'Fiebre', icd10Code: 'R50.9', icd10Display: 'Fiebre, no especificada',
        questions: [
          {
            id: 'temperatura', label: '¿Cuál fue la temperatura más alta que le tomaste?', type: 'single',
            options: [
              { value: 'no_medida', label: 'No se la tomé' },
              { value: 'menos_38',  label: 'Menos de 38°' },
              { value: '38_39',     label: 'Entre 38° y 39°' },
              { value: 'mas_39',    label: 'Más de 39°', redFlag: true },
            ],
          },
          sinAlarma('acompanantes', '¿Tiene alguno de estos junto con la fiebre?', [
            ['manchas', 'Manchas en la piel que no se van al apretarlas'],
            ['convulsion', 'Convulsiones'],
            ['rigidez_nuca', 'Rigidez en el cuello'],
          ]),
        ],
      },
      {
        id: 'tos', label: 'Tos o mocos', icd10Code: 'R05', icd10Display: 'Tos',
        questions: [
          {
            id: 'respiracion', label: '¿Cómo respira?', type: 'single',
            options: [
              { value: 'normal', label: 'Normal' },
              { value: 'silbido', label: 'Le silba el pecho al respirar', redFlag: true },
              { value: 'agitado', label: 'Respira rápido o se le hunde el pecho', redFlag: true },
            ],
          },
        ],
      },
      {
        id: 'dolor_garganta', label: 'Dolor de garganta', icd10Code: 'R07.0', icd10Display: 'Dolor de garganta',
        questions: [
          {
            id: 'tragar', label: '¿Puede tragar?', type: 'single',
            options: [
              { value: 'si', label: 'Sí' },
              { value: 'cuesta', label: 'Le cuesta' },
              { value: 'no', label: 'No puede tragar ni la saliva', redFlag: true },
            ],
          },
        ],
      },
      {
        id: 'dolor_oido', label: 'Dolor de oído', icd10Code: 'H92.0', icd10Display: 'Otalgia',
        questions: [
          {
            id: 'supuracion', label: '¿Le sale líquido del oído?', type: 'single',
            options: [{ value: 'no', label: 'No' }, { value: 'si', label: 'Sí' }],
          },
        ],
      },
      {
        id: 'nauseas_vomitos', label: 'Vómitos', icd10Code: 'R11', icd10Display: 'Náusea y vómito',
        questions: [
          {
            id: 'frecuencia', label: '¿Cuántas veces vomitó en las últimas 24 horas?', type: 'single',
            options: [
              { value: '1_2', label: '1 o 2' },
              { value: '3_5', label: 'Entre 3 y 5' },
              { value: 'mas_5', label: 'Más de 5', redFlag: true },
            ],
          },
        ],
      },
      {
        id: 'diarrea', label: 'Diarrea', icd10Code: 'R19.7', icd10Display: 'Diarrea, no especificada',
        questions: [
          {
            id: 'sangre', label: '¿Tiene sangre?', type: 'single',
            options: [{ value: 'no', label: 'No' }, { value: 'si', label: 'Sí', redFlag: true }],
          },
        ],
      },
      {
        id: 'dolor_abdominal', label: 'Dolor de panza', icd10Code: 'R10.4', icd10Display: 'Otros dolores abdominales y los no especificados',
        questions: [
          {
            id: 'tipo', label: '¿Cómo es el dolor?', type: 'single',
            options: [
              { value: 'va_y_viene', label: 'Va y viene' },
              { value: 'constante', label: 'Constante y cada vez más fuerte', redFlag: true },
            ],
          },
        ],
      },
      {
        id: 'erupcion', label: 'Granitos, manchas o ronchas', icd10Code: 'R21', icd10Display: 'Salpullido y otras erupciones cutáneas no específicas',
        questions: [
          {
            id: 'hinchazon', label: '¿Se le hinchan los labios, los ojos o la cara?', type: 'single',
            options: [{ value: 'no', label: 'No' }, { value: 'si', label: 'Sí', redFlag: true }],
          },
        ],
      },
      {
        id: 'llanto', label: 'Llanto o irritabilidad (bebés)', icd10Code: 'R68.1', icd10Display: 'Síntomas no específicos propios de la infancia',
        questions: [
          {
            id: 'consuelo', label: '¿Se calma en brazos?', type: 'single',
            options: [
              { value: 'si', label: 'Sí, se calma' },
              { value: 'no', label: 'No se calma con nada', redFlag: true },
            ],
          },
        ],
      },
      otro('¿Qué le pasa? Contanos en pocas palabras'),
    ],
  },
  antes: [
    { ...DURACION, label: '¿Hace cuánto que le pasa?' },
    {
      id: 'estado', label: '¿Cómo está?', type: 'single',
      options: [
        { value: 'activo', label: 'Activo, juega como siempre' },
        { value: 'decaido', label: 'Más decaído, pero responde' },
        { value: 'muy_decaido', label: 'Muy decaído, le cuesta despertarse o no responde', redFlag: true },
      ],
    },
    {
      id: 'hidratacion', label: '¿Toma líquido y hace pis?', type: 'single',
      options: [
        { value: 'normal', label: 'Como siempre' },
        { value: 'menos', label: 'Menos que lo habitual' },
        { value: 'casi_nada', label: 'Casi nada, o no hizo pis en más de 8 horas', redFlag: true },
      ],
    },
  ],
  despues: [],
  cierre: {
    titulo: 'Peso, medicación y alergias',
    preguntas: [
      { id: 'peso', label: '¿Cuánto pesa, más o menos?', ayuda: 'Con el peso, el pediatra calcula la dosis.', type: 'numero', unidad: 'kg', opcionNoSe: 'No sé', options: [] },
      {
        ...MEDICATION_QUESTION,
        label: '¿Le estás dando alguna medicación?',
        options: [
          { value: 'no', label: 'No' },
          { value: 'si', label: 'Sí', detailLabel: '¿Cuál y cuánto?', detailRequired: true },
        ],
      },
      { ...ALERGIAS, label: '¿Tiene alergia a algún medicamento?' },
    ],
  },
}

// ── Psicología ───────────────────────────────────────────────────────────────
// No hay lista de síntomas ni preguntas: el motivo se cuenta con palabras, y es
// opcional — mucha gente prefiere decirlo en la consulta. Sin cierre: la
// psicóloga no receta. (Hubo una pregunta de riesgo; Mateo la sacó, 2026-10-27.)

const MENTE = {
  motivo: {
    tipo: 'abierto',
    titulo: '¿Qué te trae?',
    ayuda: 'Es opcional. Si preferís, lo hablás directamente en la consulta.',
    label: 'Contanos con tus palabras',
    placeholder: 'Por ejemplo: estoy pasando un momento difícil en el trabajo y me cuesta dormir.',
    opcional: true,
    sinTexto: 'Prefiere contarlo en la consulta',
  },
  antes: [],
  despues: [],
  cierre: null,
}

// ── Psiquiatría ──────────────────────────────────────────────────────────────
// Receta, así que necesita saber qué toma y si es alérgico. Uno de los motivos
// más comunes de una consulta inmediata es haberse quedado sin la medicación.

const SENTIRSE_ASI = { ...DURACION, label: '¿Hace cuánto que te sentís así?' }

const PSIQUIATRIA = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué te trae?',
    ayuda: 'Elegí lo principal. El profesional lo lee antes de aceptar.',
    opciones: [
      { id: 'ansiedad', label: 'Ansiedad o ataques de pánico', icd10Code: 'R45.0', icd10Display: 'Nerviosismo', questions: [SENTIRSE_ASI] },
      { id: 'animo', label: 'Tristeza, desgano o ánimo bajo', icd10Code: 'R45.3', icd10Display: 'Desmoralización y apatía', questions: [SENTIRSE_ASI] },
      { id: 'sueno', label: 'Problemas para dormir', icd10Code: 'G47.0', icd10Display: 'Trastornos del inicio y del mantenimiento del sueño', questions: [SENTIRSE_ASI] },
      {
        id: 'receta', label: 'Renovar o ajustar mi medicación', icd10Code: 'Z76.0', icd10Display: 'Consulta para repetición de receta',
        questions: [
          {
            id: 'stock', label: '¿Cómo estás con la medicación?', type: 'single',
            options: [
              { value: 'sin', label: 'Ya se me terminó', redFlag: true },
              { value: 'pocos_dias', label: 'Me quedan pocos días' },
              { value: 'ajustar', label: 'Tengo, pero quiero ajustarla' },
            ],
          },
        ],
      },
      otro('¿Qué te trae? Contanos en pocas palabras'),
    ],
  },
  antes: [],
  despues: [
    {
      id: 'tratamiento', label: '¿Hacés tratamiento con un psiquiatra o un psicólogo?', type: 'single',
      options: [
        { value: 'psiquiatra', label: 'Sí, con un psiquiatra' },
        { value: 'psicologo', label: 'Sí, con un psicólogo' },
        { value: 'ambos', label: 'Con los dos' },
        { value: 'no', label: 'No' },
      ],
    },
  ],
  cierre: {
    titulo: 'Medicación y alergias',
    preguntas: [
      {
        ...MEDICATION_QUESTION,
        options: [
          { value: 'no', label: 'No' },
          { value: 'si', label: 'Sí', detailLabel: '¿Cuál, y en qué dosis?', detailRequired: true },
        ],
      },
      ALERGIAS,
    ],
  },
}

// ── Nutrición ────────────────────────────────────────────────────────────────

const z713 = { icd10Code: 'Z71.3', icd10Display: 'Consulta y supervisión dietética', questions: [] }

const NUTRICION = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué querés trabajar?',
    ayuda: 'Elegí lo principal.',
    opciones: [
      { id: 'bajar_peso', label: 'Bajar de peso', ...z713 },
      { id: 'subir_peso', label: 'Subir de peso o ganar masa muscular', ...z713 },
      { id: 'ordenar', label: 'Ordenar mi alimentación', ...z713 },
      { id: 'condicion', label: 'Comer bien con una condición de salud', ...z713 },
      { id: 'embarazo', label: 'Embarazo o lactancia', ...z713 },
      { id: 'deporte', label: 'Alimentación para el deporte', ...z713 },
      otro('¿Qué querés trabajar? Contanos en pocas palabras'),
    ],
  },
  tituloPreguntas: 'Contanos un poco más',
  antes: [],
  despues: [
    {
      id: 'condiciones', label: '¿Tenés alguna de estas?', type: 'multi',
      options: [
        { value: 'diabetes', label: 'Diabetes' },
        { value: 'colesterol', label: 'Colesterol alto' },
        { value: 'presion', label: 'Presión alta' },
        { value: 'celiaquia', label: 'Celiaquía' },
        { value: 'tiroides', label: 'Problemas de tiroides' },
        { value: 'ninguna', label: 'Ninguna de estas', exclusive: true },
      ],
    },
    {
      id: 'alergias_alimentarias', label: '¿Tenés alguna alergia o intolerancia a algún alimento?', type: 'single_with_detail',
      options: [
        { value: 'no', label: 'No' },
        { value: 'si', label: 'Sí', detailLabel: '¿Cuál?', detailRequired: true },
      ],
    },
  ],
  cierre: {
    titulo: 'Medicación',
    preguntas: [{ ...MEDICATION_QUESTION, label: '¿Tomás alguna medicación o suplemento?' }],
  },
}

// ── Kinesiología ─────────────────────────────────────────────────────────────
// El kinesiólogo necesita dónde, cómo empezó, y descartar lo que no es para
// kinesio (pérdida de fuerza, de control de esfínteres, fiebre).

const KINESIOLOGIA = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Dónde te duele?',
    ayuda: 'Elegí la zona principal.',
    opciones: [
      { id: 'cuello', label: 'Cuello', icd10Code: 'M54.2', icd10Display: 'Cervicalgia', questions: [] },
      { id: 'espalda_alta', label: 'Espalda (parte alta)', icd10Code: 'M54.6', icd10Display: 'Dolor en la columna dorsal', questions: [] },
      { id: 'dolor_espalda', label: 'Cintura o espalda baja', icd10Code: 'M54.5', icd10Display: 'Lumbago no especificado', questions: [] },
      { id: 'hombro', label: 'Hombro', icd10Code: 'M25.51', icd10Display: 'Dolor en articulación — hombro', questions: [] },
      { id: 'mano', label: 'Codo, muñeca o mano', icd10Code: 'M25.53', icd10Display: 'Dolor en articulación — antebrazo', questions: [] },
      { id: 'cadera', label: 'Cadera', icd10Code: 'M25.55', icd10Display: 'Dolor en articulación — pelvis y muslo', questions: [] },
      { id: 'rodilla', label: 'Rodilla', icd10Code: 'M25.56', icd10Display: 'Dolor en articulación — pierna', questions: [] },
      { id: 'tobillo', label: 'Tobillo o pie', icd10Code: 'M25.57', icd10Display: 'Dolor en articulación — tobillo y pie', questions: [] },
      {
        id: 'postquirurgico', label: 'Rehabilitación después de una cirugía', icd10Code: 'Z50.1', icd10Display: 'Otras terapias físicas',
        questions: [{ id: 'cirugia', label: '¿De qué te operaron y cuándo?', type: 'texto', placeholder: 'Por ejemplo: ligamento cruzado de la rodilla derecha, hace un mes', options: [] }],
      },
      otro('¿Qué te pasa? Contanos en pocas palabras'),
    ],
  },
  antes: [
    DURACION,
    {
      id: 'origen', label: '¿Cómo empezó?', type: 'single',
      options: [
        { value: 'lesion', label: 'Un golpe, una caída o una lesión' },
        { value: 'esfuerzo', label: 'Un movimiento o un esfuerzo' },
        { value: 'cirugia', label: 'Después de una cirugía' },
        { value: 'sin_causa', label: 'Sin una causa clara' },
      ],
    },
    INTENSIDAD,
  ],
  despues: [
    sinAlarma('alarma', '¿Tenés alguno de estos?', [
      ['fuerza', 'Hormigueo o pérdida de fuerza en brazos o piernas'],
      ['esfinteres', 'Problemas para controlar la orina o el intestino'],
      ['fiebre', 'Fiebre'],
    ]),
  ],
  cierre: null,
}

// ── Veterinaria ──────────────────────────────────────────────────────────────
// El paciente es la mascota. Sin códigos CIE-10: son de medicina humana.

const sinCodigo = { icd10Code: null, icd10Display: null, questions: [] }

const VETERINARIA = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué le pasa a tu mascota?',
    ayuda: 'Elegí lo que más te preocupa.',
    opciones: [
      { id: 'no_come', label: 'No come o come poco', ...sinCodigo },
      { id: 'vomitos', label: 'Vómitos', ...sinCodigo },
      { id: 'diarrea', label: 'Diarrea', ...sinCodigo },
      { id: 'decaimiento', label: 'Está decaído o cansado', ...sinCodigo },
      { id: 'piel', label: 'Picazón, caída de pelo o problemas de piel', ...sinCodigo },
      { id: 'herida', label: 'Una herida o un golpe', ...sinCodigo },
      { id: 'renguea', label: 'Renguea o le duele al moverse', ...sinCodigo },
      { id: 'respira', label: 'Tos o le cuesta respirar', ...sinCodigo },
      { ...otro('¿Qué le pasa? Contanos en pocas palabras'), icd10Code: null },
    ],
  },
  antes: [
    {
      id: 'especie', label: '¿Qué animal es?', type: 'single_with_detail',
      options: [
        { value: 'perro', label: 'Perro' },
        { value: 'gato', label: 'Gato' },
        { value: 'otro', label: 'Otro', detailLabel: '¿Cuál?', detailRequired: true },
      ],
    },
    {
      id: 'edad', label: '¿Qué edad tiene?', type: 'single',
      options: [
        { value: 'cachorro', label: 'Menos de 1 año' },
        { value: 'adulto', label: 'Entre 1 y 8 años' },
        { value: 'mayor', label: 'Más de 8 años' },
      ],
    },
    { ...DURACION, label: '¿Hace cuánto que le pasa?' },
  ],
  despues: [
    sinAlarma('alarma', '¿Le pasa alguno de estos?', [
      ['respira', 'Le cuesta mucho respirar'],
      ['convulsion', 'Convulsiones'],
      ['toxico', 'Pudo haber comido algo tóxico'],
      ['sangrado', 'Un sangrado que no para'],
    ]),
  ],
  cierre: {
    titulo: 'Peso y medicación',
    preguntas: [
      { id: 'peso', label: '¿Cuánto pesa, más o menos?', type: 'numero', unidad: 'kg', opcionNoSe: 'No sé', options: [] },
      { ...MEDICATION_QUESTION, label: '¿Le estás dando alguna medicación?' },
    ],
  },
}

// ── Preparación física ───────────────────────────────────────────────────────

const PREPARADOR = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué querés lograr?',
    ayuda: 'Elegí lo principal.',
    opciones: [
      { id: 'empezar', label: 'Empezar a entrenar', ...sinCodigo },
      { id: 'bajar_peso', label: 'Bajar de peso', ...sinCodigo },
      { id: 'fuerza', label: 'Ganar fuerza o masa muscular', ...sinCodigo },
      { id: 'carrera', label: 'Prepararme para una carrera o un deporte', ...sinCodigo },
      { id: 'volver', label: 'Volver a entrenar después de una lesión', ...sinCodigo },
      { ...otro('¿Qué querés lograr? Contanos en pocas palabras'), icd10Code: null },
    ],
  },
  tituloPreguntas: 'Contanos un poco más',
  antes: [],
  despues: [
    {
      id: 'frecuencia', label: '¿Cuántas veces por semana entrenás hoy?', type: 'single',
      options: [
        { value: '0', label: 'No entreno' },
        { value: '1_2', label: '1 o 2' },
        { value: '3_4', label: '3 o 4' },
        { value: '5_mas', label: '5 o más' },
      ],
    },
    {
      id: 'limitacion', label: '¿Tenés alguna lesión, dolor o condición de salud que te limite?', type: 'single_with_detail',
      options: [
        { value: 'no', label: 'No' },
        { value: 'si', label: 'Sí', detailLabel: '¿Cuál?', detailRequired: true },
      ],
    },
  ],
  cierre: null,
}

// ── Odontología ──────────────────────────────────────────────────────────────

const ODONTOLOGIA = {
  motivo: {
    tipo: 'lista',
    titulo: '¿Qué te pasa?',
    ayuda: 'Elegí lo que más te molesta.',
    opciones: [
      {
        id: 'dolor_dental', label: 'Dolor de muela o de un diente', icd10Code: 'K08.8', icd10Display: 'Otras afecciones especificadas de los dientes',
        questions: [{
          id: 'cuando', label: '¿Cuándo te duele más?', type: 'single',
          options: [
            { value: 'frio_dulce', label: 'Con frío, calor o dulce' },
            { value: 'masticar', label: 'Al masticar' },
            { value: 'siempre', label: 'Todo el tiempo, también de noche' },
          ],
        }],
      },
      { id: 'encias', label: 'Encías que sangran o duelen', icd10Code: 'K06.8', icd10Display: 'Otros trastornos especificados de la encía', questions: [] },
      { id: 'hinchazon', label: 'Hinchazón en la cara o en la boca', icd10Code: 'R22.0', icd10Display: 'Tumefacción localizada en la cabeza', questions: [] },
      { id: 'roto', label: 'Diente roto o un golpe', icd10Code: 'S02.5', icd10Display: 'Fractura de los dientes', questions: [] },
      { id: 'protesis', label: 'Problema con una prótesis, una corona o los brackets', ...sinCodigo },
      otro(),
    ],
  },
  antes: [DURACION, INTENSIDAD],
  despues: [
    sinAlarma('alarma', '¿Tenés alguno de estos?', [
      ['fiebre', 'Fiebre'],
      ['hinchazon', 'Hinchazón que llega al ojo o al cuello'],
      ['tragar', 'Dificultad para tragar o abrir la boca'],
    ]),
  ],
  cierre: { titulo: 'Medicación y alergias', preguntas: [MEDICATION_QUESTION, ALERGIAS] },
}

// ── Una vertical nueva, creada desde el super admin ──────────────────────────
// Sin catálogo propio todavía: campo abierto y medicación. Mejor eso que
// mostrarle síntomas clínicos a una especialidad que no tiene nada que ver.

const GENERICO = {
  motivo: {
    tipo: 'abierto',
    titulo: '¿Qué te pasa?',
    ayuda: 'El profesional lo lee antes de aceptar.',
    label: 'Contanos en pocas palabras',
    placeholder: 'Por ejemplo: qué te pasa, desde cuándo y qué te gustaría resolver.',
    opcional: false,
  },
  antes: [],
  despues: [],
  cierre: { titulo: 'Medicación', preguntas: [MEDICATION_QUESTION] },
}

export const TRIAGES = {
  clinica: CLINICA,
  pediatria: PEDIATRIA,
  mente: MENTE,
  psiquiatria: PSIQUIATRIA,
  nutricion: NUTRICION,
  fisico: KINESIOLOGIA,
  veterinaria: VETERINARIA,
  preparador: PREPARADOR,
  odontologia: ODONTOLOGIA,
}

// Valores viejos de `consultations.vertical` (antes de las verticales en la base).
const ALIAS = { salud: 'clinica', 'Psicología': 'mente', psicologia: 'mente', kinesiologia: 'fisico' }

/**
 * El triage de una vertical. Sin vertical, el de Clínica (es lo que había
 * hasta hoy en todas partes); con una vertical que no tiene triage propio, el
 * genérico.
 */
export function triageDe(verticalId) {
  if (!verticalId) return CLINICA
  const id = ALIAS[verticalId] ?? verticalId
  return TRIAGES[id] ?? GENERICO
}

/** Las preguntas del paso 2 para un motivo: comunes de antes, las del motivo, comunes de después. */
export function preguntasDe(triage, motivo) {
  const propias = motivo && !motivo.freeText ? (motivo.questions ?? []) : []
  return [...(triage.antes ?? []), ...propias, ...(triage.despues ?? [])]
}

/** Las preguntas del paso 3, o [] si la vertical no lo tiene. */
export function cierreDe(triage) {
  return triage.cierre?.preguntas ?? []
}
