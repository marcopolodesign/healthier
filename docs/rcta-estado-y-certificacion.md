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
| **Cobertura (financiador + afiliado) en el payload** | ❌ **Falta — bloquea la certificación** |
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

**El bloqueo:** el payload que arma `rcta-issue` hoy **no manda cobertura**. El
objeto `paciente` incluye nombre, documento, sexo, fecha de nacimiento y teléfono
— pero no el campo `cobertura`, que es donde va el financiador.

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

### Trabajo concreto pendiente

1. **Guardar el `idFinanciador`, no solo el nombre.** Agregar la columna y un
   selector que consulte `GET /apirecipe/GetFinanciadores` en vez de texto libre.
   Sin esto no hay forma de mandar la cobertura correcta.
2. **Sumar `cobertura` al payload** de `rcta-issue`, con el caso "particular"
   (omitir el campo) contemplado.
3. **Correr las 4 pruebas** y guardar los números de receta que devuelva el
   sandbox, que es lo que Innovamed va a querer ver.

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
- Swagger (sandbox): https://apirecipe.hml.qbitos.com/swagger/index.html
- Acceso institucional: https://innovamed.com.ar/rcta-institucional
- Receta electrónica / RENAPDIS: https://www.argentina.gob.ar/receta-electronica
