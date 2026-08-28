# RCTA — buenas prácticas

Reglas para trabajar con la receta electrónica (Innovamed / QBI2) sin repetir
errores que ya costaron tiempo. Todo lo de acá salió de pruebas reales contra el
sandbox, no de leer la documentación.

- **Referencia de la API** (endpoints, esquemas): `docs/rcta-integration.md`
- **Estado y camino a certificar**: `docs/rcta-estado-y-certificacion.md`
- **Qué valida realmente Innovamed**: `docs/rcta-que-valida-innovamed.md`

---

## 1. Qué es un "financiador" y por qué importa

**Financiador = la obra social o prepaga que cubre la receta.** OSDE, Swiss
Medical, Luis Pasteur, PAMI. En la jerga de Innovamed no se dice "obra social",
se dice financiador.

Importa porque **una receta con cobertura y una particular son recetas
distintas**: la farmacia le cobra a la obra social en un caso y al paciente en el
otro. Innovamed necesita saber cuál es.

**La regla:** Innovamed no acepta el *nombre* de la obra social. Necesita el
**`idFinanciador`**, un número de su propio catálogo (hay ~900). "OSDE" no sirve;
`28` sí.

Ese catálogo se pide con `GET /apirecipe/GetFinanciadores?clienteAppId=...` y
cambia con el tiempo. **Nunca hardcodear IDs** — hay que consultarlo y dejar que
el profesional elija de esa lista.

> Hoy Healthier guarda `consultations.obra_social_name` como **texto libre**, que
> es exactamente lo que la API no acepta. Convertir ese campo en un selector
> alimentado por `GetFinanciadores`, y guardar el ID, es trabajo pendiente.

**`QBI25` — "EL AFILIADO ES REQUERIDO SI SE INFORMA EL FINANCIADOR"** (visto
2026-08-03): si la receta lleva `cobertura.idFinanciador`, el `numero` de
afiliado es obligatorio — mandarlo vacío es rechazo seguro. Es la misma regla
de siempre: **un campo vacío no es lo mismo que un campo omitido**. `rcta-issue`
corta antes con `RCTA_AFILIADO_FALTANTE` (422) y mensaje accionable, y el
`FinanciadorPicker` avisa en rojo cuando hay obra social sin afiliado. La
alternativa de "degradar" a receta particular cuando falta el afiliado se
descartó a propósito: el paciente declaró cobertura, y una receta particular le
haría perder el descuento del medicamento sin que nadie lo decida.

---

## 2. Nunca inventes códigos: ni de medicamento ni de financiador

Los dos errores más caros de la integración son el mismo error de fondo —
mandar texto libre donde la API espera un código de su catálogo.

**`QBI105` — "CODIGO INFORMADO INEXISTENTE"**: `medicamentos[].regNo` tiene que
ser un código real del catálogo de Innovamed (`GET /apirecipe/GetMedicamento/
{search}`). Un nombre de medicamento escrito a mano se rechaza siempre.

La receta se emite bien **con** el código: probado end-to-end contra el sandbox
(`AMIXEN 500mg comp.x21`, `regNo: 35771` → `200 OK`, con `idReceta` y PDF).

**La regla, para los dos casos:** todo campo que la API describa como código o ID
se elige de un autocompletado contra su endpoint correspondiente y se guarda el
código, no el texto que vio el usuario. Si en la UI hay un input de texto libre
para algo que la API codifica, eso es un bug esperando a la primera receta real.

---

## 3. Guardá el código, mostrá el nombre

Corolario del punto anterior, pero vale decirlo aparte porque es lo que se hace
mal por default: la tabla guarda **`id_financiador` / `reg_no`**, y el nombre
legible es un acompañante para mostrar. No al revés.

Guardar solo el nombre obliga a adivinar el código después, y adivinar es lo que
produce `QBI105`.

---

## 4. El domicilio de atención no es opcional

**`QBI248` — "DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN"**: el
sandbox rechaza la receta si no hay dirección de atención. El swagger no dice qué
campo mira exactamente, así que `rcta-issue` la manda en **todos** los campos
plausibles (`medico.lugarAtencion`, `direccionConsultorio`, `nombreConsultorio`,
y el objeto `lugarAtencion.domicilio`). Confirmado que así se limpia el error.

**No sacar ninguno de esos campos "porque parece redundante".** Está duplicado a
propósito.

Consecuencia práctica: un profesional sin `professional_profiles.address` **no
puede emitir recetas**. Vale validarlo antes de dejarlo intentar, en vez de que
descubra el error recién al emitir.

---

## 5. `clienteAppId` va en lugares distintos según el verbo

Query param en los GET, campo del body en POST/PUT/DELETE. No hay header de
institución ni de tenant. Es fácil de equivocar y el error que devuelve no es
obvio.

---

## 6. Los tokens vienen vencidos y la API no aplica el `exp`

El JWT de sandbox venció el **2026-07-06** y sin embargo las llamadas siguen
devolviendo `200` (verificado el 2026-07-28, 22 días después).

**Lo mismo pasa con el token de producción.** El que Innovamed entregó el
2026-08-28 trae `exp` = 2026-08-28 12:21 UTC — o sea, ya vencido cuando llegó —
y además `iss` / `aud` = `Test.com`. Igual responde `200` contra
`apirecipe.qbitos.com`. Ninguna de esas tres señales es motivo para rechazar
unas claves: **la única prueba válida es llamar a la API.**

**No confíes en eso.** Que hoy no se aplique no significa que no se aplique
mañana. Si algo falla con `401`, lo primero a revisar es el vencimiento antes de
buscar bugs en el payload. Está pendiente pedirle a Innovamed la política de
renovación del token de producción.

---

## 7. Sandbox y producción son URLs distintas, no un flag

| Ambiente | Base URL | `clienteAppId` | Dónde está configurado |
|---|---|---|---|
| Homologación | `https://apirecipe.hml.qbitos.com` | `597` | Supabase **staging** (`itjhrvlzuqvyhqtffumc`) |
| Producción | `https://apirecipe.qbitos.com` | `343` | Supabase **producción** (`aixjejdoofervrkggbkd`) |

Va en el secret `RCTA_API_URL`, **sin barra final** — la función le agrega
`/apirecipe/...`. Una barra de más rompe la URL y el error no lo dice.

**La URL y el `clienteAppId` van juntos, no se mezclan.** Cruzarlos devuelve
`QBI29 — VERIFIQUE EL CLIENTE APP ID INGRESADO` (HTTP 404): el `343` no existe
en homologación y el `597` no existe en producción. Ese error es la forma más
rápida de saber que un ambiente quedó mal armado.

**Producción es producción.** Desde el 2026-08-28 el proyecto de prod apunta a
la API real: cada emisión es una receta legalmente válida. Las pruebas van a
staging, que se queda en homologación a propósito.

---

## 8. Las credenciales viven del lado servidor. Siempre.

Los tres secrets (`RCTA_API_URL`, `RCTA_API_KEY`, `RCTA_CLIENT_APP_ID`) van en
**Supabase secrets**, nunca en el `.env` del front: cualquier variable `VITE_*`
se compila dentro del bundle y es pública. El token de RCTA firma recetas
médicas legalmente válidas.

**Antes de rotar un secret, verificá si hace falta.** Supabase muestra un
**hash** en `secrets list`, no el valor: comparar el SHA-256 del valor nuevo
contra ese digest dice si ya está configurado, sin tocar nada. Rotar a ciegas un
secret compartido rompe a quien lo esté usando en paralelo.

---

## 9. Emitir una receta es un acto médico, no un `POST`

Una receta RCTA es **legalmente válida** y queda asociada a la matrícula del
profesional. De ahí se desprenden algunas cosas que en otro contexto serían
opcionales:

- **Nunca emitir automáticamente.** Siempre con una acción explícita del
  profesional.
- **Nunca reintentar en silencio.** Si la emisión falla, se muestra el error; un
  reintento automático puede duplicar una receta.
- `rcta-issue` ya rechaza con `409` una medicación que ya está `issued`. No
  saltear esa guarda.
- Los estados (`pending` / `issued` / `error`) se muestran en la UI. Un fallo
  silencioso hace que el profesional crea que recetó cuando no lo hizo.

---

## 10bis. Los catálogos de los dos ambientes NO son el mismo

Verificado el 2026-08-28 comparando `GetFinanciadores` en los dos ambientes:
**835 financiadores en producción, 900 en homologación, y 381 ids que apuntan a
entidades distintas.** El `537` es "Prueba PAMI" en el sandbox y "Andina ART" en
producción; el `534` es "CONVENIO PRUEBA EXTERNO" y "OSEP Catamarca".

Consecuencia: **un `financiador_id` guardado desde el sandbox puede emitir una
receta contra la obra social equivocada.** Los ids bajos coinciden (OSDE `28`,
Luis Pasteur `9`, Accord Salud `96` son iguales en los dos), pero eso es suerte,
no garantía.

Los `regNo` de medicamentos sí resultaron estables entre ambientes en las
muestras probadas (`30127` = ACTRON cáps. x10 en los dos), pero el **orden y el
contenido de los resultados de búsqueda difieren**, así que tampoco vale copiar
un código de una corrida de sandbox a producción sin verificarlo.

Regla práctica: **datos de prueba emitidos contra homologación no se reutilizan
en producción.** Ni el financiador, ni el medicamento, ni la receta.

---

## 11. Para pasar a producción no alcanza con que ande

Innovamed pide tres cosas, y dos no son código:

1. Contrato firmado.
2. Registro como recetario en **RENAPDIS**
   (https://www.argentina.gob.ar/receta-electronica).
3. Certificar con 4 recetas de prueba (3 con financiador + 1 particular).

Estado y detalle de las 4 pruebas: `docs/rcta-estado-y-certificacion.md`.
