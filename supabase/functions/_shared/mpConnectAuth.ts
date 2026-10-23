/**
 * mpConnectAuth.ts — helpers compartidos por mp-connect y pharmacy-mp-connect.
 *
 * Las dos funciones son `verify_jwt = false` (el callback lo llama Mercado
 * Pago, sin JWT de Supabase), así que el gateway no valida nada: cada acción
 * que actúa en nombre de alguien (authorize, disconnect) tiene que validar el
 * token ACÁ. El callback no, porque se autentica con el `state` firmado.
 */
import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** El usuario dueño del JWT del header `Authorization`, o null si no hay o no vale. */
export async function userFromRequest(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) return null;
  const { data: { user }, error } = await serviceClient().auth.getUser(jwt);
  return error || !user ? null : user;
}

/**
 * true si el pedido es una navegación del browser (un link viejo, un tab con
 * el bundle de antes del 2026-10-23) y no un fetch. A esos no se les contesta
 * un JSON crudo: se los manda de vuelta a la app con un aviso.
 */
export function isBrowserNavigation(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (req.headers.get("sec-fetch-mode") === "navigate") return true;
  return (req.headers.get("accept") ?? "").includes("text/html");
}
