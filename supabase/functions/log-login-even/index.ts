import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

Deno.serve(async (req: Request) => {

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt        = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!jwt) return json({ error: "Missing auth token" }, 401);

  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const rawIp     = req.headers.get("x-forwarded-for") ?? "";
  const ipAddress = rawIp.split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const { error: insertErr } = await sbAdmin
    .from("login_events")
    .insert({
      user_id:      user.id,
      logged_in_at: new Date().toISOString(),
      ip_address:   ipAddress,
      user_agent:   userAgent,
    });

  if (insertErr) {
    console.error("[log-login-event] Insert failed:", insertErr.message);
    return json({ error: "Failed to log event" }, 500);
  }

  console.log(`[log-login-event] Logged login for user ${user.id} from ${ipAddress}`);
  return json({ success: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}