#!/usr/bin/env node
/**
 * Verifica las reglas de `medical_documents` (migración 174) con sesiones
 * simuladas del paciente, del profesional y de un tercero:
 *
 *   node scripts/verificar-documentos.mjs            # staging (default)
 *   node scripts/verificar-documentos.mjs prod       # sólo cuando la 174 esté en prod
 *
 * Qué prueba: el paciente carga estudios propios y de SU mascota; una mascota
 * ajena y una especialidad fuera del catálogo se rechazan; el profesional con
 * consulta compartida lee (incluido lo de la mascota) pero no edita; un
 * tercero no ve nada. Todo corre dentro de una transacción que no se
 * confirma: no deja filas.
 *
 * Necesita en la base: paciente@healthier.app con al menos una mascota y una
 * consulta con profesional@healthier.app (es el seed de staging).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2].replace(/^["']|["']$/g, '')])
)
const REF = process.argv[2] === 'prod' ? 'aixjejdoofervrkggbkd' : 'itjhrvlzuqvyhqtffumc'

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (body?.message) throw new Error(body.message)
  return body
}

const [ids] = await q(`
  select (select id from profiles where email='paciente@healthier.app') paciente,
         (select id from profiles where email='profesional@healthier.app') profesional,
         (select p.id from pets p join profiles pr on pr.id=p.owner_id
           where pr.email='paciente@healthier.app' and p.deleted_at is null limit 1) mascota`)
if (!ids?.paciente || !ids?.profesional || !ids?.mascota) {
  console.error('❌ Faltan datos de prueba (paciente, profesional o mascota):', ids)
  process.exit(1)
}
const { paciente: PACIENTE, profesional: PROFESIONAL, mascota: MASCOTA } = ids

const [fila] = await q(`begin;
create temp table r(caso text, ok boolean, detalle text) on commit drop;
grant all on r to authenticated;
-- mascota ajena (del profesional), creada como postgres
insert into pets(id, owner_id, nombre) values ('00000000-0000-0000-0000-00000000a174','${PROFESIONAL}','Ajena');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"${PACIENTE}","role":"authenticated"}', true);

-- 1. paciente inserta análisis con especialidad
insert into medical_documents(patient_id,file_name,file_url,category,especialidad,titulo)
values ('${PACIENTE}','rx.png','x','analisis','odontologia','Radiografía muela');
insert into r values ('paciente inserta analisis', true, null);

-- 2. paciente inserta estudio de SU mascota
insert into medical_documents(patient_id,file_name,file_url,category,pet_id,titulo)
values ('${PACIENTE}','eco.pdf','x','veterinaria','${MASCOTA}','Eco Toto');
insert into r values ('paciente inserta estudio de su mascota', true, null);

-- 3. paciente intenta con mascota ajena → debe fallar
do $$ begin
  begin
    insert into medical_documents(patient_id,file_name,file_url,category,pet_id)
    values ('${PACIENTE}','x','x','veterinaria','00000000-0000-0000-0000-00000000a174');
    insert into r values ('mascota ajena rechazada', false, 'SE INSERTÓ');
  exception when others then
    insert into r values ('mascota ajena rechazada', true, sqlerrm);
  end;
  -- 4. especialidad inválida
  begin
    insert into medical_documents(patient_id,file_name,file_url,category,especialidad)
    values ('${PACIENTE}','x','x','analisis','cardiologia');
    insert into r values ('especialidad invalida rechazada', false, 'SE INSERTÓ');
  exception when others then
    insert into r values ('especialidad invalida rechazada', true, sqlerrm);
  end;
end $$;

insert into r select 'paciente ve los suyos', count(*) >= 2, count(*)::text from medical_documents;

-- 5. profesional con consulta compartida
select set_config('request.jwt.claims','{"sub":"${PROFESIONAL}","role":"authenticated"}', true);
insert into r select 'profesional ve docs del paciente', count(*) >= 2, count(*)::text from medical_documents where patient_id='${PACIENTE}';
insert into r select 'profesional ve el de la mascota', count(*) >= 1, count(*)::text from medical_documents where pet_id='${MASCOTA}';
do $$ begin
  update medical_documents set titulo='hack' where patient_id='${PACIENTE}';
  insert into r select 'profesional no puede editar', not exists(select 1 from medical_documents where titulo='hack'), null;
end $$;

-- 6. un tercero sin consulta compartida
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into r select 'tercero no ve nada', count(*) = 0, count(*)::text from medical_documents where patient_id='${PACIENTE}';

reset role;
select json_agg(r) from r;
`)
const casos = fila.json_agg ?? []
let mal = 0
for (const c of casos) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.caso}${c.detalle ? ` — ${c.detalle}` : ''}`)
  if (!c.ok) mal++
}
if (!casos.length || mal) { console.error(`\n❌ ${mal || 'sin'} casos fallidos`); process.exit(1) }
console.log(`\n✅ ${casos.length} casos OK en ${REF === 'itjhrvlzuqvyhqtffumc' ? 'staging' : 'producción'}`)
