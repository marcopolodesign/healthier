# Grupo familiar — contrato para la app (y para quien toque esto)

> Migración **181** (`supabase/migrations/181_grupo_familiar_con_perfiles.sql`),
> aplicada en staging y producción el 2026-09-30. Website hecho; **la app falta**.
> Control automático: `node scripts/verificar-grupo-familiar.mjs` (staging) y
> `--entorno produccion` (sin consulta, no cobra ni avisa a nadie).

## El modelo

Decisión de Mateo: *"Menores de edad es perfil sin log in. Pero también puedo yo
solicitar una atención para ellos — para mantener su HC distinta de la mía. Puede
ser también para personas mayores. Tienen que ser perfiles con todo lo que
implica un perfil y estar vinculados. No es con contraseña; de querer ingresar se
manda un pin de acceso."*

| Pieza | Qué es |
|---|---|
| **Familiar** | Un `profiles` normal con `role = 'patient'` y `titular_id` = quien lo creó. Tiene su `auth.users` **sin contraseña**, con mail interno `familiar-<uuid>@familia.healthier.app`. Su historia clínica, consultas y estudios son SUYOS. |
| **`profiles.email` del familiar** | Es el **del titular**, a propósito: los mails de la consulta (reserva, cierre, receta) le llegan a quien la pidió. Si el titular cambia de correo, sus familiares lo siguen (trigger). 🔴 Buscar perfiles por mail puede devolver varias filas: filtrar `titular_id IS NULL`. |
| **`family_members`** | Pasa a ser el **vínculo**: `patient_id` = titular, `familiar_id` = perfil del familiar, `relationship` = parentesco, `puede_gestionar`. Los campos de siempre (`full_name`, `dni`, `phone`, `insurance_name`, `insurance_num`) se copian al perfil del familiar por trigger. |
| **Push** | `enviar_push_tipo()` redirige al `titular_id`: todo aviso de una consulta del familiar le llega al teléfono del titular, sin tocar cada aviso. |
| **`consultations.solicitado_por`** | Default `auth.uid()`. Para la consulta de un familiar es el titular. |
| **Customer.io** | `cio.people` excluye a los familiares (`titular_id IS NULL`). |

### Permisos (RLS)

- `es_titular_de(titular, familiar)` y `puedo_actuar_como(paciente)` —SECURITY
  DEFINER, leen sólo `family_members`, sin recursión sobre `profiles`—.
- Se **sumaron** policies (no se reescribió ninguna): el titular lee y edita el
  perfil del familiar; lee/crea/actualiza sus `consultations`; lee su HC
  (`clinical_*`, `clinical_notes` externas, `nutrition_plans`, `activity_plans`);
  maneja sus `diagnostic_reports`, `medical_documents` y `consultation_arrivals`;
  lee códigos de cierre, órdenes y eventos de sus consultas; y escribe en
  `patient-docs/<familiarId>/…`.
- El familiar logueado con PIN es un paciente más: ve lo suyo con las policies de
  siempre, y puede leer el perfil de su titular (sólo lectura).
- El profesional ve al paciente de la consulta = el familiar. **No** ve al titular.
- `finalize_consultation` y `proteger_payment_status_consultations` aceptan al
  titular. La bonificación (`payment_exempt`) que cuenta es la del titular.
- Edge Functions (`daily-token`, `mp-payment`, `mp-capture`, `mp-refund`) usan
  `_shared/familia.ts → puedeActuarComo()`: el titular paga, entra a la sala,
  cancela y pide reembolso por el familiar. Tarjetas, créditos y `payments.patient_id`
  son **del titular** (el que paga).

## Cómo se hace cada cosa (lo que la app tiene que llamar)

### Listar el grupo

```ts
supabase.from('family_members')
  .select('*, familiar:profiles!familiar_id(id, full_name, birth_date, gender, dni, avatar_url)')
  .eq('patient_id', miId)
```

El id que importa para todo lo demás es **`familiar_id`**, no `family_members.id`.

### Crear un familiar

Igual que hoy: `insert` en `family_members` con `patient_id = miId` y los datos
del formulario. **No mandar `familiar_id`** (si viene, se ignora): el trigger crea
el usuario y el perfil y lo devuelve en la fila. Pedir `.select()` para tenerlo.

Fecha de nacimiento y sexo van **al perfil del familiar** (los pide la receta):

```ts
supabase.from('profiles').update({ birth_date, gender }).eq('id', familiarId)
```

Borrar la fila de `family_members` borra **el vínculo**, no el perfil (la HC no se
puede borrar).

### Reservar para un familiar (turno o consulta inmediata)

Lo único que cambia es **`patient_id`** al crear la consulta: el `familiar_id`
elegido. Todo lo demás igual —mismo `mp-payment` (con `authorizeOnly` en
on-demand), mismas tarjetas guardadas del titular—.

- El selector "¿Para vos o para alguien de tu grupo familiar?" va en la reserva
  (paso después de la modalidad, salvo veterinaria) y en el checkout de consulta
  inmediata. Sólo aparece si hay familiares. En el website:
  `components/patient/SelectorParaQuien.jsx`.
- Desde la ficha del familiar se entra con `?para=<familiarId>`.
- Los listados del titular (turnos, banner de "tu próximo turno", rehidratar la
  espera de on-demand) usan `patient_id IN (yo, ...mis familiares)` y muestran
  "Para <nombre>". Ver `consultationsService.getByPatient` / `getLiveOnDemand`.
- En la sala de espera, la pre-consulta pide y guarda los datos que faltan **en el
  perfil del familiar** (`consultation.patient`), no en el del titular.

### Estudios y documentos del familiar

Mismo `diagnosticReportService`: subir a `patient-docs/<familiarId>/biovisor/…`
y crear `diagnostic_reports` con `patient_id = familiarId`.

### Historia clínica del familiar

Las mismas lecturas que la HC propia, con `patient_id = familiarId`. Web:
`/paciente/historia-clinica?de=<familiarId>`.

### PIN de acceso (el familiar entra solo)

1. **Generarlo** (titular): `supabase.rpc('generar_pin_familiar', { p_familiar: familiarId })`
   → `{ pin: '123456', expiraAt }`. 6 dígitos, un solo uso, vence a los 15 min;
   generar otro invalida el anterior. Sólo lo puede generar su titular.
2. **Canjearlo** (pantalla "Entrar con código familiar", sin sesión):
   ```ts
   const { data } = await supabase.functions.invoke('acceso-familiar', { body: { pin } })
   await supabase.auth.verifyOtp({ token_hash: data.tokenHash, type: 'magiclink' })
   ```
   Errores: `400` (no son 6 números), `401` (inválido/vencido/usado), `429` (más
   de 10 intentos fallidos desde la misma IP en 15 min). La función no manda
   ningún mail.

Web: `/acceso-familiar` (link desde el login) y la ficha `/paciente/familiar/:id`.

### Super admin

`supabase.rpc('admin_grupos_familiares')` — web en
`/super-admin/usuarios/grupos-familiares`.

## Lo que quedó afuera (a propósito)

- **Pedir acceso desde el familiar** (que le llegue un aviso al titular para
  aprobar): la versión mínima es el PIN que genera el titular.
- **Emergencias (S.O.S.) para un familiar**: siguen siendo del titular.
- **Mascotas**: van por su lado (`pets`, migración 172).
- **Dos titulares para el mismo familiar** (mamá y papá): el modelo lo soporta
  (el vínculo es una tabla), pero hoy no hay forma de sumar un segundo titular a
  un familiar ya creado.
- El profesional ve como mail de contacto del familiar el del titular.
