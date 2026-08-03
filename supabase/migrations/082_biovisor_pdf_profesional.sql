-- El profesional puede ABRIR el PDF original que subió su paciente al BioVisor.
--
-- Hasta acá podía ver los parámetros extraídos (política
-- `professionals_read_patient_reports` sobre `diagnostic_reports`, migración
-- 036) pero no el estudio del que salieron: `patient-docs` es privado y su
-- única política es `patient_docs_owner`, que exige
-- `auth.uid() = (storage.foldername(name))[1]` — o sea, sólo el paciente. Sin
-- una política de lectura, `createSignedUrl` falla y el link no abre nada.
--
-- Regla (Mateo, 2026-07-31): lo ve el profesional que tenga **alguna consulta
-- existente** con ese paciente. No es abierto a todos los profesionales. Es la
-- misma regla que ya rige el acceso a los parámetros y al perfil del paciente,
-- así que se reutiliza `has_shared_consultation` (SECURITY DEFINER, migración
-- 005) en vez de escribir un EXISTS nuevo: una sola definición de "atiendo a
-- este paciente" para todo el sistema.
--
-- Alcance deliberadamente acotado a la subcarpeta `biovisor`. La bóveda del
-- paciente vive en el mismo bucket pero un nivel más arriba
-- (`<patientId>/<archivo>` contra `<patientId>/biovisor/<archivo>`), y es
-- privada: abrir el bucket entero le daría al profesional todos los documentos
-- personales del paciente, que no es lo que se pidió ni lo que el paciente
-- espera al subir algo a su bóveda.

drop policy if exists "patient_docs_biovisor_shared_professional" on storage.objects;

create policy "patient_docs_biovisor_shared_professional"
  on storage.objects
  for select
  using (
    bucket_id = 'patient-docs'
    and (storage.foldername(name))[2] = 'biovisor'
    -- El primer segmento tiene que ser un UUID antes de castearlo: un objeto
    -- con un path inesperado haría fallar la política entera, y una política
    -- que revienta bloquea lecturas legítimas.
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and public.has_shared_consultation(((storage.foldername(name))[1])::uuid)
  );
