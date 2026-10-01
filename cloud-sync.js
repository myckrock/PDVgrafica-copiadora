(() => {
  const cfg = window.PDV_SUPABASE_CONFIG || {};
  let client = null;
  let cloudReady = false;

  function setStatus(text, state='local') {
    const box=document.getElementById('cloud-status');
    const label=document.getElementById('cloud-status-text');
    const dot=document.getElementById('cloud-status-dot');
    if (!box || !label || !dot) return;
    box.classList.remove('hidden');
    label.textContent=text;
    dot.className='w-2 h-2 rounded-full '+(state==='online'?'bg-emerald-400':state==='error'?'bg-rose-400':'bg-slate-400');
  }

  async function init() {
    if (!cfg.enabled || !cfg.url || cfg.url.startsWith('COLE_') || !cfg.anonKey || cfg.anonKey.startsWith('COLE_')) {
      setStatus('Banco local');
      return false;
    }
    if (!window.supabase?.createClient) {
      setStatus('Supabase indisponível','error');
      return false;
    }
    try {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        setStatus('Banco configurado • faça login','local');
        return false;
      }
      cloudReady = true;
      setStatus('Banco online','online');
      return true;
    } catch (e) {
      console.error('PDV Cloud:', e);
      setStatus('Erro no banco','error');
      return false;
    }
  }

  async function showStatus() {
    if (!cfg.enabled) {
      alert('O banco online ainda não foi configurado.\n\nPreencha supabase-config.js com a URL e a chave pública do seu projeto Supabase e depois habilite enabled: true.');
      return;
    }
    if (!cloudReady) await init();
    const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
    alert(user ? `Banco online conectado.\nUsuário: ${user.email || user.id}` : 'Banco configurado, mas nenhuma sessão Supabase está autenticada.');
  }

  // A sincronização de dados será ativada depois da migração da autenticação.
  // Isso evita expor dados do PDV através de uma chave pública sem RLS adequado.
  window.PDVCloud = { init, showStatus, get client(){return client;}, get ready(){return cloudReady;} };

  window.addEventListener('DOMContentLoaded', () => { setTimeout(init, 50); });
})();
