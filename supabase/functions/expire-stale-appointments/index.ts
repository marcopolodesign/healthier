import { createClient } from 'jsr:@supabase/supabase-js@2'

// Turno expiration policy (confirmed by product owner 2026-07-08):
// A booked (status='confirmed') appointment whose scheduled_at is more than 2 hours
// in the past — and that never progressed past 'confirmed' (neither patient nor
// professional ever entered the call) — is auto-expired to status='no_show'.
//
// If the expired consultation was paid, refund_pending is flagged true for manual
// admin review. No MercadoPago refund API is called and no money moves automatically.

const EXPIRE_AFTER_MS = 2 * 60 * 60 * 1000 // 2 hours

Deno.serve(async (req: Request) => {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const cutoff = new Date(Date.now() - EXPIRE_AFTER_MS).toISOString()

  const { data: stale, error } = await supabase
    .from('consultations')
    .select('id, payment_status')
    .eq('status', 'confirmed')
    .lt('scheduled_at', cutoff)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
  if (!stale?.length) {
    return new Response(JSON.stringify({ expired: 0, refundPending: 0 }))
  }

  const staleIds = stale.map((c) => c.id as string)
  const refundIds = stale
    .filter((c) => c.payment_status === 'paid')
    .map((c) => c.id as string)

  const { error: expireError } = await supabase
    .from('consultations')
    .update({ status: 'no_show' })
    .in('id', staleIds)

  if (expireError) {
    return new Response(JSON.stringify({ error: expireError.message }), { status: 500 })
  }

  if (refundIds.length > 0) {
    await supabase
      .from('consultations')
      .update({ refund_pending: true })
      .in('id', refundIds)
  }

  return new Response(JSON.stringify({ expired: staleIds.length, refundPending: refundIds.length }))
})
