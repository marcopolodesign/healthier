/**
 * mp-refresh-tokens — Periodic sweep to refresh MercadoPago OAuth tokens
 * before they expire (access_token lifetime is 180 days — SECCIÓN A.5).
 *
 * POST /mp-refresh-tokens
 *   Protected by any of:
 *     - header `x-cron-secret` === MP_WEBHOOK_SECRET (reused pragmatically, same
 *       pattern as other internal-only functions), OR
 *     - header `x-cron-secret` === MP_CRON_SECRET (dedicated cron secret, only
 *       checked when that env var is set), OR
 *     - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
 *
 *   Finds every mp_accounts row with active=true AND
 *   (expires_at IS NULL OR expires_at < now() + 30 days), refreshes each one via
 *   the shared _shared/mpRefresh.ts helper, and persists the new
 *   access_token/refresh_token/expires_at. On invalid_grant, deactivates the
 *   account (active=false) and unsets professional_profiles.mp_connected — the
 *   professional must reconnect via mp-connect and is blocked from new bookings
 *   until then.
 *
 * NOTE — scheduling: this function is NOT wired to pg_cron in any migration.
 * The repo's own precedent (migrations/048_appointment_expiration.sql, for
 * expire-stale-appointments) explicitly avoids committing a cron.schedule()
 * call that embeds a literal secret/anon-key in the job body — that has to be
 * registered once, manually, via the Supabase SQL editor. Same applies here.
 * The critical path is covered regardless: mp-payment (C2.6) and mp-webhook
 * both refresh inline via the same shared helper right before they need a
 * fresh token, so a missed weekly sweep does not break payments — it just
 * means the proactive 30-day-ahead refresh doesn't happen until the next
 * manual/cron run.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureFreshMpToken, SWEEP_REFRESH_MARGIN_MS, type MpAccountRow } from "../_shared/mpRefresh.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!;
const MP_CRON_SECRET = Deno.env.get("MP_CRON_SECRET");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth: internal-only ────────────────────────────────────────────────────
  const cronSecret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization");
  const isWebhookSecretValid = Boolean(MP_WEBHOOK_SECRET) && cronSecret === MP_WEBHOOK_SECRET;
  const isCronSecretValid = Boolean(MP_CRON_SECRET) && cronSecret === MP_CRON_SECRET;
  const isServiceRoleAuth = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isWebhookSecretValid && !isCronSecretValid && !isServiceRoleAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SUPABASE_SERVICE_ROLE_KEY
    );

    const cutoff = new Date(Date.now() + SWEEP_REFRESH_MARGIN_MS).toISOString();

    const { data: accounts, error: fetchErr } = await supabase
      .from("mp_accounts")
      .select("professional_id, access_token, refresh_token, expires_at, active")
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.lt.${cutoff}`);

    if (fetchErr) {
      console.error("mp-refresh-tokens: failed to fetch mp_accounts:", fetchErr.message);
      return new Response(
        JSON.stringify({ data: null, error: "Failed to fetch mp_accounts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = {
      total: accounts?.length ?? 0,
      refreshed: 0,
      deactivated: 0,
      skipped: 0,
      failed: 0,
    };

    for (const account of (accounts ?? []) as MpAccountRow[]) {
      try {
        const result = await ensureFreshMpToken(supabase, account, SWEEP_REFRESH_MARGIN_MS);
        if (result.invalidGrant) {
          results.deactivated++;
        } else if (result.refreshed) {
          results.refreshed++;
        } else {
          results.skipped++;
        }
      } catch (err) {
        console.error(`mp-refresh-tokens: unexpected error refreshing ${account.professional_id}:`, err);
        results.failed++;
      }
    }

    console.log("mp-refresh-tokens: sweep complete", JSON.stringify(results));

    return new Response(
      JSON.stringify({ data: results, error: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("mp-refresh-tokens error:", err);
    return new Response(
      JSON.stringify({ data: null, error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
