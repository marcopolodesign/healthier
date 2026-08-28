# RCTA — qué valida Innovamed y qué nos toca a nosotros

Investigación del **2026-08-28**, disparada por una pregunta de Mateo el mismo día
que se activaron las credenciales de producción: *"¿qué chequea RCTA? ¿que los
profesionales usen esa dirección? ¿un profesional tiene que estar dado de alta en
RCTA primero?"*.

Complementa `rcta-buenas-practicas.md` (reglas), `rcta-integration.md` (contrato de
la API) y `rcta-estado-y-certificacion.md` (estado).

> ⚠️ **Caveat que atraviesa todo el documento.** Las 7 llamadas registradas en
> `rcta_issue_log` son **todas contra homologación** (`api_base_url` =
> `apirecipe.hml.qbitos.com`, `cliente_app_id` = 597 en las 7 — verificado por
> consulta directa). **Nunca se emitió una receta contra producción.** Todo lo que
> sigue sobre laxitud de validación está probado en el sandbox, y producción **no
> publica swagger** (`apirecipe.qbitos.com/swagger/v1/swagger.json` → 404), así que
> no hay forma de confirmar que valide igual sin emitir una receta real.

---

## 1. El domicilio de atención: valida presencia, no contenido

**Confirmado.** Sin dirección, la API responde `QBI248 — DEBE INFORMAR EL DOMICILIO
DONDE SE REALIZÓ LA ATENCIÓN`. Pero con dirección **no chequea nada del contenido**:
se emitió una receta (`idReceta 880006475818`, `outcome: issued`, `errores: []`) cuyo
`lugarAtencion.domicilio` era

```json
{"calle":"1990","numero":null,"localidad":"Avenida Santa Fe","provincia":"Barrio Norte","pais":"Argentina"}
```

—una calle en el campo `localidad`, un barrio en `provincia`, `numero` en `null`— y
**el PDF lo renderiza textual**, con la cola `localidad - provincia - pais` pegada al
final. O sea: no hay catálogo de localidades, no hay chequeo de coherencia, y la
basura sale impresa en un documento legalmente válido.

**No existe endpoint de geografía.** El swagger de homologación expone 19 paths y
ninguno es de provincias o localidades; 12 rutas plausibles probadas contra
producción devuelven 404 mientras `GetFinanciadores` devuelve 200. No están ocultas:
no existen.

En `Core.Dtos.DomicilioDto` los 11 campos son `string` y `nullable: true`, sin
`required`, `format`, `pattern` ni `enum`. En todo `RecetaRequestDto` el **único**
campo `required` es `clienteAppId`: la validación es enteramente server-side y no
documentada. Por eso `rcta-issue` sigue mandando la dirección en los cuatro campos a
la vez (`index.ts:284-296`) — es la decisión correcta y no hay que tocarla.

### 🔴 El bug que esto destapa: `parseAddress` rompe las tres direcciones reales

`parseAddress` (`rcta-issue/index.ts:647-657`) hace `address.split(',')` y asume el
formato `Calle Número, Localidad, Provincia`. Las direcciones reales vienen de un
geocoder, con 9-10 partes y **el número adelante**. Ejecutada sobre las tres
direcciones que hoy existen en producción:

| Especialidad | `calle` | `numero` | `localidad` | `provincia` |
|---|---|---|---|---|
| psicología (CABA) | `1990` | `null` | `Avenida Santa Fe` | `Barrio Norte` |
| medicina general (Neuquén) | `Centro Integral para la Salud` | `null` | `971` | `Ministro Alcorta` |
| pediatría (Trelew) | `333` | `null` | `Moreno Norte` | `Don Bosco` |

**Las tres dan basura y `numero` queda siempre en `null`.** No es un caso borde: es
el 100% de los profesionales que hoy podrían recetar. Como Innovamed no valida el
contenido, esto se imprime tal cual en la receta.

**Arreglo recomendado:** dejar de mandar el objeto `domicilio` y mandar sólo el
string de dirección, que sale bien. La API acepta las dos formas.

---

## 2. El alta del profesional: no en la API, sí en la ley

Las dos mitades dan respuestas opuestas, y la segunda es la que pesa.

### 2a. Del lado de la API: no hay alta y no valida la matrícula

**Confirmado.** El swagger expone 19 endpoints y **ninguno es de profesionales**: no
hay `POST /Medico`, ni alta, ni consulta, ni validación de matrícula. Los únicos
catálogos son diagnósticos, financiadores, medicamentos, prácticas y promociones.

**Y no valida la matrícula contra ningún padrón** — evidencia directa: las recetas de
certificación se emitieron con `matricula.numero` = `"123123"` y `"123456"` y DNIs
inventados, todas con `outcome: issued` y `errores: []`. El PDF imprime
`Matrícula Nac.:123123` tal cual. **Innovamed imprime lo que le mandamos.**

Dos matices que conviene no pasar por alto:

- Esto es homologación. Producción podría ser más estricta; no hay evidencia en
  ninguna dirección.
- El swagger describe el objeto `medico` como *"Si no se envía el id médico es
  obligatorio completar este objeto"*, pero **`idMedico` no aparece en ninguna parte
  del swagger**. Eso sugiere que Qbitos tiene un concepto interno de médico
  registrado que esta versión de la API no expone. Está preguntado.

### 2b. Del lado de la ley: la validación nos toca a nosotros

`argentina.gob.ar/receta-electronica/profesionales` dice textual:

> *"Las plataformas verificarán que los profesionales de la salud que prescriben
> medicamentos estén inscriptos en la Red Federal de Registros de Profesionales de la
> Salud (REFEPS) del SISA. (…) **El profesional será autenticado por el recetario
> electrónico que utilice.**"*

Healthier se registró en ReNaPDiS **como recetario**
(`docs/registro-recetarios-decreto-98-23.md:6`). ReNaPDiS registra plataformas, no
profesionales: el médico no se da de alta en ningún registro estatal, sólo necesita
matrícula activa informada por su provincia o colegio a REFEPS. **El que tiene que
verificar eso somos nosotros, no Innovamed.**

**Y hoy no está hecho.** `sisa-verify` existe y consulta
`sisa.msal.gov.ar/.../profesional/obtener`, pero corta con `503 SISA_NOT_CONFIGURED`
—faltan `SISA_USER` / `SISA_PASS`— y además se invoca desde un botón manual del super
admin, **no desde el camino de prescripción**.

> 🔴 **El riesgo, dicho de una vez:** si producción es tan laxa como homologación,
> hoy Healthier puede emitir una receta legalmente válida a nombre de una matrícula
> que no verificó nadie — ni nosotros ni Innovamed. Éste es el hallazgo que debería
> decidir si se deja recetar a médicos reales antes de destrabar SISA.

**Qué devuelve una matrícula inexistente:** no se sabe. No hay código QBI documentado
para ese caso. `QBI60` aparece cuando la matrícula **falta**, no cuando es inválida.

### 2c. El producto self-service sí tiene onboarding

`ayuda.innovamed.com.ar/registro` documenta el alta de médicos del producto directo de
Innovamed: DNI + foto del documento, consulta a SISA por DNI (con carga manual si no
aparece, o sea no bloqueante), tipo y número de matrícula + foto de la matrícula,
**domicilio de atención obligatorio**, y validación por su equipo en 48 horas.

Ese flujo **no aplica al camino institucional por API que usa Healthier**, pero
muestra que Innovamed considera el domicilio y la matrícula datos de *alta*, no de
receta. Sumado a que el pricing es por médico (~$50.000 ARS/mes,
`rcta-integration.md:215`), es razonable pensar que en algún lado hay una lista de
médicos declarados. **No es prueba de nada — está preguntado.**

---

## 3. Todos los códigos QBI conocidos, y cuáles manejamos

La fuente autoritativa no es un documento sino el mensaje del commit **`e024b56`**
(`website`, 2026-07-28), que salió de probar el sandbox sacando un campo por vez.

| Código | Qué exige | Ámbito | ¿Lo manejamos? |
|---|---|---|---|
| `QBI156` | DNI (paciente **y** médico) | ambos | ⚠️ Aviso en UI (`datosReceta.js`), sin guarda en `rcta-issue` |
| `QBI206` | Sexo (paciente **y** médico) | ambos | ⚠️ Igual |
| `QBI224` | Fecha de nacimiento del paciente | paciente | ⚠️ Igual |
| `QBI95` | Nombre y apellido del paciente | paciente | ❌ No está en `datosReceta.js` |
| `QBI60` | Matrícula presente | médico | ⚠️ UI sí, backend no |
| `QBI248` | Domicilio de atención | lugar | 🔴 **Sin guarda.** Manda `prof.address ?? null` |
| `QBI34` | Cantidad del medicamento | receta | ❌ No está en `datosReceta.js` |
| `QBI105` | `regNo` existente en catálogo | medicamento | ✅ `RCTA_SIN_CODIGO` (422) |
| `QBI25` | Afiliado requerido si hay financiador | cobertura | ✅ `RCTA_AFILIADO_FALTANTE` (422) |
| `QBI212` | Credencial del afiliado inhabilitada | cobertura | ✅ Se propaga (visto en vivo) |
| `QBI29` | `clienteAppId` inválido | config | ✅ Documentado |

Guardas que hoy tiene `rcta-issue`: `RCTA_ENCUENTROS_MEZCLADOS`, `RCTA_YA_EMITIDA`,
`RCTA_ESPECIALIDAD_SIN_PERMISO`, `RCTA_FINANCIADOR_SIN_CODIGO`,
`RCTA_AFILIADO_FALTANTE`, `RCTA_SIN_CODIGO`, `RCTA_NOT_CONFIGURED`. **Ninguna para
dirección, matrícula, DNI, sexo ni cantidad.**

**Lo que confirmadamente NO valida:** la especialidad (acepta vacía, sin código QBI),
la fecha de nacimiento del médico (6 de las 7 recetas salieron con `null`), el
contenido de la dirección, y la matrícula contra padrón.

### 🟡 La especialidad se manda en slug y sale impresa así

Se envía `especialidad: "medicina_general"` —el slug de la base— y el PDF imprime
`MÉDICO - MEDICINA_GENERAL`, con guion bajo, en una receta legal. Hay que mandar la
etiqueta legible del catálogo (`specialties.label`), no el slug.

---

## Confirmado vs. inferido

**Confirmado con evidencia dura:** todo el punto 1; la ausencia de endpoints de
profesionales y de geografía; que homologación acepta matrícula y domicilio falsos;
la tabla de códigos QBI; que nunca se emitió contra producción; que `sisa-verify`
nunca corrió; las citas de `argentina.gob.ar`.

**Inferido, no verificado — no tomar como cierto:**

- Que **producción** valide igual que homologación. No hay ni un dato.
- Que exista un padrón interno de médicos en Qbitos. Lo sugieren el `idMedico`
  fantasma, el pricing por médico y el onboarding self-service; ninguna es prueba.
- Qué campo mira exactamente `QBI248`.
- Que `QBI60` sea el código de matrícula: sale del commit `e024b56` y de
  `datosReceta.js:31`, sin log crudo que lo respalde.

**Corrección de dato:** `web.innovamed.com.ar/rcta-institucional` da 404. La URL viva es
`web.innovamed.com.ar/rcta-institucional`. Estaba mal en `rcta-integration.md:215` y
en `nextsteps.md`.

---

## Qué hacer, en orden

1. **Arreglar `parseAddress`** — o directamente dejar de mandar el objeto `domicilio`
   y mandar sólo el string, que sale bien. Afecta al 100% de los profesionales.
2. **Guarda `422` cuando falta la dirección**, simétrica a las tres que ya existen.
3. **Mandar la especialidad legible** en vez del slug.
4. **Destrabar las credenciales de SISA** — es el único punto con obligación
   normativa expresa sobre Healthier.

El mail con las preguntas abiertas para Innovamed está en
`docs/mail-innovamed-validaciones-2026-08-28.md`.
