# RCTA / Innovamed — estado de la integración y camino a certificar

Complementa `docs/rcta-integration.md`, que es la **referencia de la API**
(endpoints, esquemas, contrato). Este documento es el **estado**: qué funciona
hoy, qué falta, y qué hace falta para que Innovamed nos habilite producción.

Última verificación contra la API: **2026-07-28**.

---

## Dónde estamos

**La integración está construida y el sandbox responde.** Esto es más de lo que
se creía: durante semanas figuró como "bloqueado por credenciales", y las
credenciales ya estaban configuradas.

| | Estado |
|---|---|
| Edge Function `rcta-issue` | ✅ Construida |
| UI (`PrescriptionCreator`, badges de estado RCTA) | ✅ Construida |
| Accesible desde la videollamada | ✅ Desde el 2026-07-28 |
| Credenciales de homologación en Supabase secrets | ✅ Configuradas |
| Conectividad con el sandbox | ✅ Verificada — `GET /apirecipe/GetFinanciadores` → **200** |
| Código de medicamento (`regNo`) en el payload | ✅ Autocompletado contra `GetMedicamento` (2026-07-28) |
| Cobertura (financiador + afiliado) en el payload | ✅ Selector contra `GetFinanciadores` (2026-07-28) |
| **Emitir en homologación** | ⛔ **Bloqueado por Innovamed — sandbox en solo lectura** |
| Credenciales de producción | ❌ Requieren contrato + RENAPDIS + 4 pruebas |

### Sobre las credenciales

Las que Innovamed reenvió el 2026-07-28 son **idénticas** a las ya configuradas
— verificado comparando el SHA-256 de cada valor contra el digest que expone
Supabase, sin rotar nada. Los tres secrets son:

- `RCTA_API_URL` = `https://apirecipe.hml.qbitos.com` (sin barra final; la
  función le agrega `/apirecipe/...`)
- `RCTA_API_KEY` = el JWT de homologación
- `RCTA_CLIENT_APP_ID` = `597`

> ⚠️ **El token de homologación venció el 2026-07-06.** El sandbox **no aplica**
> el claim `exp`: una llamada real el 2026-07-28 devolvió `200 OK` con datos.
> Funciona, pero es una dependencia frágil — conviene pedirle a Innovamed la
> política de renovación antes de apoyar una demo en esto.

---

## Lo que falta para poder certificar

Innovamed pide **cuatro recetas de prueba**, tres de ellas con financiador:

| # | Financiador | Nº de afiliado | `idFinanciador` en el sandbox |
|---|---|---|---|
| 1 | OSDE | `23200126801` | **28** (tiene 21 planes) |
| 2 | Luis Pasteur | `23701900080` | **9** |
| 3 | Accord Salud | `23256785` | **96** |
| 4 | Particular (sin financiador) | — | — |

Los tres IDs están confirmados contra `GET /apirecipe/GetFinanciadores` (900
financiadores en total en el sandbox).

### ⛔ Bloqueo actual: el sandbox de Innovamed no acepta escrituras

`POST /apirecipe/Receta` devuelve **`QBI2 OPERACION INVALIDA`** con el detalle
**"The MySQL server is running with the --read-only option so it cannot execute
this statement"**. Los `GET` siguen respondiendo `200`.

Probado el 2026-07-28 con el caso OSDE y con el particular: **fallan idéntico**, y
ninguno se quejó de `regNo`, `cobertura` ni domicilio — o sea que el payload pasó
la validación de campos y murió recién al escribir en su base.

**Es infraestructura de Innovamed, no nuestra.** Hay que pedirle al equipo de
soporte de integraciones (en copia del mail del 2026-07-28) que habiliten
escritura en homologación. Hasta entonces las 4 pruebas de certificación no se
pueden correr, por más que el resto esté listo.

---

### ✅ Resuelto — `regNo` del medicamento

`medicamentos[].regNo` tiene que ser un código real del catálogo de Innovamed
(`GET /apirecipe/GetMedicamento/{search}`). Un nombre escrito a mano se rechaza
siempre con **`QBI105` — "CODIGO INFORMADO INEXISTENTE"**.

**Resuelto el 2026-07-28.** `MedicationSearch` busca contra `GetMedicamento` a
través de la Edge Function `rcta-catalog` (proxy, porque el token no puede viajar
al navegador) y guarda `reg_no` + `presentacion` + `nombre_droga`. Se permite
igual texto libre para la historia clínica, avisando que esa medicación no se va
a poder emitir. `rcta-issue` valida antes de llamar y devuelve `422` con un
mensaje accionable en vez del `QBI105` críptico.

La buena noticia es que el camino feliz ya está probado end-to-end contra el
sandbox con un código real (`AMIXEN 500mg comp.x21`, `regNo: 35771` → `200 OK`
con `idReceta` y PDF). No hay incógnita técnica: falta capturar el dato.

**Trabajo:** autocompletado contra `GetMedicamento` en el creador de recetas,
columna `reg_no` en `clinical_medications`, y mandarlo en el payload.

### ✅ Resuelto — cobertura

**Resuelto el 2026-07-28.** `FinanciadorPicker` modela **tres** estados, no dos,
porque significan cosas distintas al emitir:

| Estado | Qué significa | Qué se manda |
|---|---|---|
| sin definir | todavía no se preguntó | — |
| `financiador` | tiene obra social | `cobertura` con `idFinanciador` + `numero` |
| `particular` | explícitamente sin cobertura | **se omite** `cobertura` |

Confundir "no sabemos" con "es particular" haría emitir recetas particulares a
pacientes que sí tienen obra social. Una constraint en la base impide que
`particular` conviva con financiador o afiliado.

**El financiador no es obligatorio**: la cuarta prueba de certificación es
justamente una receta sin datos de financiador.

Según el swagger, la forma es (anidada dentro de `paciente`):

```jsonc
"cobertura": {
  "idFinanciador": "28",
  "plan": "210",         // opcional
  "planId": 0,           // opcional
  "numero": "23200126801",
  "dniTitular": "..."    // opcional
}
```

**De dónde sacar el dato:** `consultations.obra_social_name` y
`consultations.affiliate_number` ya existen y se editan desde el detalle de la
consulta. Pero guardan el **nombre** de la obra social, no el `idFinanciador`
numérico que pide la API.

### Trabajo pendiente

1. **Pedirle a Innovamed que habiliten escritura en homologación.** Es lo único
   que bloquea hoy.
2. **Completar los datos de las cuentas demo**: el profesional y el paciente de
   prueba no tienen DNI ni fecha de nacimiento, y RCTA los exige. Sin eso las
   pruebas no se pueden correr *a través de la app* (aunque el payload sea
   correcto).
3. **Correr las 4 pruebas** y guardar los números de receta — es lo que Innovamed
   va a querer ver.
4. **Las 63 consultas del backfill** tienen obra social escrita a mano sin
   `idFinanciador`. La app avisa y corta al emitir, pero conviene re-seleccionar
   las que se vayan a usar.

---

## Lo que depende de Mateo, no del código

Para que Innovamed entregue las claves de **producción** hacen falta tres cosas,
y ninguna se resuelve programando:

1. **Firmar el contrato.** Innovamed mandó el modelo de carta oferta el
   2026-07-28 y quedó esperando conformidad para arrancar el proceso de firmas.
2. **Registrarse como recetario en RENAPDIS** —
   https://www.argentina.gob.ar/receta-electronica
3. **Pasar la certificación** con las 4 recetas de arriba.

El punto 3 sí depende del trabajo listado en la sección anterior. Los puntos 1 y
2 se pueden avanzar en paralelo desde ya.

---

## Contactos

- El equipo de soporte de integraciones de Innovamed quedó en copia del mail del
  2026-07-28 para dudas técnicas.
- El equipo de administración de Innovamed tiene el contrato con precio
  actualizado.

---

## Referencias

- Referencia de la API: `docs/rcta-integration.md`
- Buenas prácticas: `docs/rcta-buenas-practicas.md`
- Swagger (sandbox): https://apirecipe.hml.qbitos.com/swagger/index.html
- Acceso institucional: https://innovamed.com.ar/rcta-institucional
- Receta electrónica / RENAPDIS: https://www.argentina.gob.ar/receta-electronica
