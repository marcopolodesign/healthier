// Corre `cerrarDescuentoPorConsulta` (lo mismo que hace mp-webhook cuando MP
// resuelve un pago pendiente) contra STAGING. Lo usa verificar-beneficio-socio.mjs:
// el webhook real necesita la firma de MP, que no tenemos local.
//
//   deno run -A scripts/cerrar-descuento-cli.ts <consultationId> <approved|rejected|pending|...> <mpPaymentId>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cerrarDescuentoPorConsulta } from '../supabase/functions/_shared/descuentoSocio.ts'

const [consultationId, status, mpPaymentId] = Deno.args
const url = Deno.env.get('HEALTHIER_STAGING_SUPABASE_URL')!
const key = Deno.env.get('HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY')!
if (!url || url.includes('aixjejdoofervrkggbkd')) throw new Error('Sólo staging')
const db = createClient(url, key, { auth: { persistSession: false } })
const r = await cerrarDescuentoPorConsulta(db, consultationId, status, mpPaymentId ?? null)
console.log(JSON.stringify(r))
