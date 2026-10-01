import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({error:"Não autenticado"}), {status:401});

  const token = authHeader.replace("Bearer ", "");
  const { data: { user: requester } } = await admin.auth.getUser(token);
  if (!requester) return new Response(JSON.stringify({error:"Sessão inválida"}), {status:401});

  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", requester.id).single();
  if (!profile || profile.role !== "ADMIN" || profile.active !== true) {
    return new Response(JSON.stringify({error:"Somente o administrador pode criar usuários."}), {status:403});
  }

  const body = await req.json();
  const { email, password, full_name, username, role = "OPERATOR" } = body;
  if (!email || !password || !full_name || !username) {
    return new Response(JSON.stringify({error:"Campos obrigatórios ausentes."}), {status:400});
  }

  if (role === "ADMIN") {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "ADMIN");
    if ((count ?? 0) > 0) return new Response(JSON.stringify({error:"Já existe um administrador."}), {status:409});
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name, username, role }
  });
  if (createError || !created.user) return new Response(JSON.stringify({error:createError?.message || "Erro ao criar usuário"}), {status:400});

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id, full_name, username, role, active: true
  });
  if (profileError) return new Response(JSON.stringify({error:profileError.message}), {status:400});

  return new Response(JSON.stringify({ok:true, id:created.user.id}), {headers:{"Content-Type":"application/json"}});
});
