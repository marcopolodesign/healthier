# RCTA (Innovamed QBI2) — Electronic Prescription Integration

> **RCTA = *receta electrónica* (electronic medical prescription).** Innovamed's internal product name for this microservice is "Recipe" / "QBI2 Recipe" — this is **not** a cooking-recipe or nutrition API. It issues legally-valid Argentine electronic prescriptions (medications, medical practices/studies, and other prescriptions), backed by a "mandataria" (pharmacy network intermediary).

Source: Innovamed Confluence (`DQBI2` space) + live OpenAPI spec at
`https://apirecipe.hml.qbitos.com/swagger/v1/swagger.json`, read and verified 2026-07-07.

---

## 1. Environments

| Environment | Base URL |
|---|---|
| Production | `https://apirecipe.qbitos.com` |
| Homologación (sandbox) | `https://apirecipe.hml.qbitos.com` |

Swagger UI (sandbox): `https://apirecipe.hml.qbitos.com/swagger/index.html`

Support: `soporte.it@innovamed.com.ar`

## 2. Auth

Every call needs **both**:

1. `Authorization: Bearer <token>` header — a long-lived JWT issued by Innovamed per client.
2. `clienteAppId` (int) — identifies the client app within Innovamed's system. Passed as a **query param** on GET endpoints, and as a **body field** on POST/PUT/DELETE endpoints. There is no separate institution/tenant header.

Sandbox credentials for Healthier (United Healthcare Argentina):

| Field | Value |
|---|---|
| `idClientApp` / `clienteAppId` | `597` |
| Admin email (Innovamed backoffice, not used for API calls) | `Info@unitedhealth.com.ar` |

Actual token value lives in `website/.env` as `RCTA_API_KEY` and as a Supabase Edge Function secret — never commit it.

> **Token expiry note:** the sandbox JWT's `exp` claim decodes to **2026-07-06 16:02 -03**. A live test against `GET /apirecipe/GetFinanciadores` on 2026-07-07 still returned `200 OK` with real data, so the sandbox does not appear to hard-enforce `exp` — but confirm the renewal/rotation policy with Innovamed support before depending on this token for a live demo more than a few days out.

## 3. Endpoint catalog

All paths are prefixed `/apirecipe`.

### Lookups (read-only — use these to build autocomplete UIs instead of free text)

| Method | Path | Purpose | Key params |
|---|---|---|---|
| GET | `/GetDiagnostico` | ICD-10 diagnosis search | `text` |
| GET | `/GetFinanciadores` | Funder/insurer (obra social) list | `clienteAppId` |
| GET | `/GetMedicamento/{search}` | Medication search (matches presentación + monodroga) + coverage check | `search` (path), `numeroPagina`, `clienteAppId`, `idFinanciador`, `afiliadoCredencial`, `afiliadoDni`, `planId`, `plan` |
| GET | `/GetPracticas` | Medical practice/study search | `search`, `numeroPagina`, `clienteAppId`, `tipo`, `categoria` |
| GET | `/Receta/UltimaCobertura` | Last coverage + date by patient DNI/sexo | `dni`, `sexo`, `clienteAppId` |
| GET | `/ConsultaPromocion` | Promo lookup for a medication | `nroDoc`, `idFinanciador`, `regNo`, `clienteAppId` |

### Prescriptions — medications (`Receta`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/Receta` | Generate one or more prescriptions → PDF + hash. Body: `RecetaRequestDto`. |
| PUT | `/Receta` | Persist a receta to Innovamed's DB **without** sending to the mandataria or generating a PDF. Body: `PersistirRecetaRequestDto`. |
| GET | `/Receta/S3Link` | Get the PDF S3 link for a receta by hash. Body: `S3LinkRequestDto` (yes, GET with body). |
| DELETE | `/Receta/{idRecetaHash}` | Cancel/anular a prescription. Body: `RecetaAnularRequestDto` (`clienteAppId`). |

### Prescriptions — practices / studies / other

| Method | Path | Purpose |
|---|---|---|
| POST | `/prescribirPractica` | Generate one or more non-medication practice prescriptions. Body: `PracticaRequestDto`. |
| DELETE | `/Practica/{hashPrescripcion}` | Cancel a practice prescription. |
| POST | `/OtrasPrescripciones` | Generate other (non-standard) prescriptions. Body: `OtrasPrescripcionesRequestDto`. |
| DELETE | `/OtrasPrescripciones/{hashPrescripcion}` | Cancel one. |

### Admin / backoffice (not needed for the patient-facing flow)

`POST /admin/Credenciales`, `POST /admin/Financiador`, `POST|GET|DELETE /admin/Logo` — client/funder/logo management on Innovamed's side.

## 4. `POST /apirecipe/Receta` — the core call

### Request: `RecetaRequestDto`

```jsonc
{
  "clienteAppId": 597,                 // required
  "diagnostico": "string",             // general diagnosis — free text or CIE-10 code
  "medicamentos": [
    {
      "nombreProducto": "string",
      "nombreDroga": "string",
      "presentacion": "string",
      "cantidad": 1,                   // int — quantity to prescribe
      "permiteSustitucion": "S",       // 'S' generic ok, 'N' no substitution, null/empty = allow
      "regNo": "string",               // medication registry number (from GetMedicamento)
      "tratamiento": 0,                // 0 normal, 1 prolonged treatment
      "diagnostico": "string",         // per-medication diagnosis, free text
      "codigoDiagnostico": "string",   // per-medication CIE-10 code
      "posologia": "string",           // dosage instructions, free text
      "observaciones": "string",
      "forzarDuplicado": false,
      "promoId": "string"
    }
  ],
  "paciente": {
    "apellido": "string", "nombre": "string",
    "tipoDoc": "DNI",                  // Pasaporte | DNI | LE | LC | CI
    "nroDoc": "string",
    "sexo": "F",                       // F | M | X
    "fechaNacimiento": "YYYY-MM-DD",
    "cobertura": { "idFinanciador": "string", "plan": "string", "planId": 0, "numero": "string", "dniTitular": "string" },
    "localidad": "string", "provincia": "string", "email": "string", "telefono": "string",
    "pais": "string",                  // required if tipoDoc = Pasaporte
    "cuil": "string",
    "domicilio": { "calle": "string", "numero": "string", "piso": "string", "dpto": "string", "codigoPostal": "string", "localidad": "string", "municipio": "string", "provincia": "string", "pais": "string" },
    "ocultarPaciente": false
  },
  "medico": {
    "apellido": "string", "nombre": "string",
    "tipoDoc": "DNI", "nroDoc": "string",
    "especialidad": "string",
    "sexo": "M",
    "fechaNacimiento": "YYYY-MM-DD",
    "email": "string",
    "telefono": "string",              // required if tipoDoc = Pasaporte
    "pais": "string",
    "matricula": { "tipo": "MN", "numero": "string", "provincia": "string", "profesion": "string", "especialidad": "string" },
    "profesion": "string",
    "lugarAtencion": "string"
  },
  "subemisor": {                       // optional — a branch/org using the client app to prescribe (e.g. a clinic chain location)
    "nombre": "string", "cuit": "string", "direccion": "string", "logoLink": "string", "logoBase64": "string"
  },
  "indicaciones": "string",
  "observaciones": "string",
  "leyenda": "string",
  "imprimirDiagnostico": "S",           // 'S' show diagnosis on PDF (default), 'N' hide
  "fechaEmision": "UTC datetime",        // only if backdating
  "recetasPostadatas": { "cantidad": 0, "diasAPosdatar": 0, "fechas": ["DD/MM/AAAA"] },  // batch/dated recipes
  "lugarAtencion": { "nombreConsultorio": "string", "domicilio": {}, "datosContacto": "string", "email": "string", "logo": "string" }
}
```

### Response: `RecetaPdfResponse`

```jsonc
{
  "recetas": [
    { "id": "string", "fecha": "string", "idReceta": "string", "nroCUIR": ["string"], "s3Link": "string (PDF url)", "verificador": "string", "linkECommerce": "string" }
  ],
  "errores": [ { "error": "string", "mensaje": "string", "medicamento": ["string"] } ],
  "response": [ /* echoed RecetaResponseDto per prescription */ ],
  "accionPDF": { "accionId": 0, "descripcion": "string", "recetas": [ { "idReceta": "string", "medicamentos": ["string"] } ] },
  "idTransaccion": "string"
}
```

`recetas` can contain more than one item when `recetasPostadatas` requests multiple dated copies. `errores` can be non-empty even on HTTP 200 (partial failure per medication) — check it.

### Error responses (400/404/500)

`MensajeInvalidoDto`: `{ error, mensaje, medicamento: [] }`
`MensajeInvalidoResponse`: `{ error, mensaje, requestId }` (used by admin endpoints)

### Business-rule errors discovered by live testing (not documented in swagger)

- **`QBI248` — "DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN"**: the sandbox rejects a `Receta` if no consultation address is present. Swagger doesn't say which field it checks, so `rcta-issue` sends the professional's `professional_profiles.address` on every plausible field (`medico.lugarAtencion` as a string, top-level `direccionConsultorio`/`nombreConsultorio` strings, and the full `lugarAtencion` object with a best-effort parsed `domicilio`) — confirmed this clears the error.
- **`QBI105` — "CODIGO INFORMADO INEXISTENTE (PRODUCTO / DROGA / PRESENTACION)"**: `medicamentos[].regNo` must be a real product code from Innovamed's catalog (`GET /apirecipe/GetMedicamento/{search}`) — free-text medication names are rejected. **Healthier does not currently capture `regNo`** (`clinical_medications` has no such column, and `PrescriptionCreator.jsx` uses a free-text medication field). Confirmed the full happy path works end-to-end with a real `regNo` (tested directly against the sandbox: `AMIXEN 500mg comp.x21`, `regNo: "35771"` → `200 OK`, real `idReceta` + PDF `s3Link` returned). **Next step to fully unblock `rcta-issue` in production**: replace the free-text medication input in `PrescriptionCreator.jsx` with an autocomplete against `GetMedicamento`, store the selected `regNo` on `clinical_medications`, and have `rcta-issue` send it instead of a client-generated string.

## 5. Healthier ↔ RCTA field mapping

| Healthier source | RCTA field | Notes |
|---|---|---|
| `profiles.full_name` | `paciente.nombre` / `paciente.apellido` | Needs splitting — last whitespace-separated token = `apellido`, rest = `nombre` (best-effort; no first/last split columns exist today). |
| `profiles.dni` (migration `045_sisa_fields.sql`) | `paciente.nroDoc` | `tipoDoc` defaults to `'DNI'` (Argentina). |
| `profiles.gender` (`masculino`/`femenino`/`no_binario`/`prefiero_no_decir`, migration `006`) | `paciente.sexo` (`F`/`M`/`X`) | Map `femenino→F`, `masculino→M`, else `X`. |
| `profiles.birth_date` | `paciente.fechaNacimiento` | ⚠️ the pre-existing scaffold read a non-existent `date_of_birth` column — actual column is `birth_date`. |
| `profiles.phone` | `paciente.telefono` | |
| `clinical_medications.professional_license_type` (`MN`/`MP` only, migration `033`) | `medico.matricula.tipo` | RCTA also accepts `OP`, not currently used here. |
| `clinical_medications.professional_license_number` | `medico.matricula.numero` | |
| `professional_profiles.specialty` | `medico.especialidad` / `medico.matricula.especialidad` | |
| `medico.matricula.provincia` | — | Not captured in Healthier today (only required for provincial licenses). Leave null. |
| `clinical_medications.medication_name` | `medicamentos[].nombreProducto` | |
| `clinical_medications.concentration` / `presentation` | `medicamentos[].presentacion` | Concatenate — RCTA has one `presentacion` string field. |
| `clinical_medications.quantity` | `medicamentos[].cantidad` | Must coerce to `int`; Healthier stores it as free text (e.g. "30 comp."). |
| `clinical_medications.cie10_code` / `cie10_display` | `medicamentos[].codigoDiagnostico` / `diagnostico` | |
| `clinical_medications.notes` | `medicamentos[].posologia` / `observaciones` | |
| `professional_profiles.address` | `medico.lugarAtencion` (string) + top-level `direccionConsultorio`/`lugarAtencion.domicilio` (object) | Required — see `QBI248` in §4.1. `professional_profiles.user_id` is `unique`, so PostgREST embeds it as a single object, not an array — index it directly (`med.professional.professional_profiles`), not `[0]`. |
| — (not captured) | `medicamentos[].regNo` | Required — see `QBI105` in §4.1. Needs a `GetMedicamento` autocomplete + a new `regNo` column (future work). |

## 6. Gap vs. the pre-existing `rcta-issue` scaffold (fixed as part of this integration)

The scaffold in `website/supabase/functions/rcta-issue/index.ts` was written before these docs existed, as a placeholder. Corrections applied:

| Was (placeholder) | Now (real contract) |
|---|---|
| `POST ${RCTA_API_URL}/prescriptions` | `POST ${RCTA_API_URL}/apirecipe/Receta` |
| `X-Institution-Id` header | removed — `clienteAppId` sent in body instead |
| `{ prescriber, patient, medication, diagnosis }` payload | `{ clienteAppId, paciente, medico, medicamentos[], diagnostico }` |
| Response read as `{ prescriptionId, pdfUrl, issuedAt }` | Reads `recetas[0].idReceta` / `recetas[0].s3Link` / `recetas[0].fecha`, surfaces `errores[]` |
| Read `profiles.date_of_birth` (doesn't exist) | Reads `profiles.birth_date` |

## 7. Env vars

| Var | Where | Value (sandbox) |
|---|---|---|
| `RCTA_API_URL` | `website/.env` + Supabase Edge Function secret | `https://apirecipe.hml.qbitos.com` |
| `RCTA_API_KEY` | `website/.env` + Supabase Edge Function secret | sandbox JWT (see §2) |
| `RCTA_CLIENT_APP_ID` | `website/.env` + Supabase Edge Function secret | `597` |

Set Edge Function secrets from `website/`:
```
npx supabase secrets set RCTA_API_URL=... RCTA_API_KEY=... RCTA_CLIENT_APP_ID=597
npx supabase functions deploy rcta-issue
```

## 8. Pricing (reference, from original scaffold comment)

~$50.000 ARS/mes por médico (institucional). Apply for production access: `innovamed.com.ar/rcta-institucional`.
