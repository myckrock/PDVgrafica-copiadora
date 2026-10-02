import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Configuração da função incompleta." }, 500);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sessão ausente." }, 401);

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Sessão inválida ou expirada." }, 401);
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: actor, error: actorError } = await adminClient.from("profiles")
    .select("role,active").eq("id", authData.user.id).single();
  if (actorError || !actor?.active || actor.role !== "ADMIN") return json({ error: "Somente um administrador ativo pode criar usuários." }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const full_name = String(body?.full_name || "").trim();
  const username = String(body?.username || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const role = body?.role === "ADMIN" ? "ADMIN" : body?.role === "OPERATOR" ? "OPERATOR" : "";
  if (!full_name || !username || username.length > 60 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 72 || !role)
    return json({ error: "Informe nome, usuário, e-mail válido, senha de 8 a 72 caracteres e perfil permitido." }, 400);

  const { data: duplicateName } = await adminClient.from("profiles").select("id").ilike("username", username).limit(1);
  if (duplicateName?.length) return json({ error: "Este nome de usuário já está cadastrado." }, 409);
  if (role === "ADMIN") {
    const { data: admins, error: adminCheckError } = await adminClient.from("profiles").select("id").eq("role", "ADMIN").eq("active", true).limit(1);
    if (adminCheckError) return json({ error: "Não foi possível verificar o administrador existente." }, 500);
    if (admins?.length) return json({ error: "Já existe um administrador ativo." }, 409);
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name, username, role },
  });
  if (createError || !created.user) return json({ error: createError?.message || "Não foi possível criar a conta." }, 400);
  const { data: profile, error: profileError } = await adminClient.from("profiles").insert({
    id: created.user.id, full_name, username, email, role, active: true,
  }).select("id,full_name,username,email,role,active,created_at").single();
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return json({ error: profileError.message || "Falha ao criar o perfil." }, 500);
  }
  return json({ profile });
});
