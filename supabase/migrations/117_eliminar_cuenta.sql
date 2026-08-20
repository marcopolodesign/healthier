-- Guideline 5.1.1(v) de Apple exige poder eliminar la cuenta desde la app,
-- no solo desactivarla temporalmente. Pero clinical_entries/conditions/
-- allergies/observations/medications tienen retención legal de 10 años
-- (Ley 26.529 Art. 18, ver block_clinical_delete()) y profiles.id -> auth.users.id
-- es ON DELETE CASCADE — un hard-delete real del usuario de auth arrastraría
-- profiles y, si hay historia clínica real, chocaría contra ese trigger y
-- fallaría la operación entera. Por eso el patrón acá es: anonimizar profiles
-- (nunca borrarla) + banear auth.users por un período largo, en vez de un
-- delete real. deleted_at marca cuándo se ejecutó, para no reprocesar.

alter table profiles add column if not exists deleted_at timestamptz;
