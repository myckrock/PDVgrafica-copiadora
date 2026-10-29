(() => {
  const cfg = window.PDV_SUPABASE_CONFIG || {};
  let client = null;
  let cloudReady = false;
  let authListenerStarted = false;

  function setStatus(text, state='local') {
    const box=document.getElementById('cloud-status');
    const label=document.getElementById('cloud-status-text');
    const dot=document.getElementById('cloud-status-dot');
    if (!box || !label || !dot) return;
    box.classList.remove('hidden');
    label.textContent=text;
    dot.className='w-2 h-2 rounded-full '+(state==='online'?'bg-emerald-400':state==='error'?'bg-rose-400':'bg-slate-400');
  }

  function isConfigured() {
    return !!(cfg.enabled && cfg.url && !String(cfg.url).startsWith('COLE_') && cfg.anonKey && !String(cfg.anonKey).startsWith('COLE_'));
  }

  function normalizeProduct(r) {
    if (!r) return null;
    return {
      ...r,
      id: r.id,
      name: r.name || '',
      category: r.category || 'IMPRESSAO',
      price: Number(r.price) || 0,
      icon: r.icon || 'fa-box',
      stock: r.stock,
      controlsStock: r.controls_stock ?? r.controlsStock ?? false,
      active: r.active !== false,
      calcEnabled: r.calc_enabled ?? r.calcEnabled ?? false
    };
  }

  function normalizeCustomer(r) {
    if (!r) return null;
    return {
      ...r,
      id: r.id,
      name: r.name || '',
      cpf: r.cpf || '',
      phone: r.phone || '',
      type: r.type || 'MENSALISTA',
      monthlyLimit: Number(r.monthly_limit ?? r.monthlyLimit ?? 0) || 0,
      monthlyUsed: Number(r.monthly_used ?? r.monthlyUsed ?? 0) || 0,
      monthlyUsageMonth: r.monthly_usage_month ?? r.monthlyUsageMonth ?? new Date().toISOString().slice(0,7),
      creditBalance: Number(r.credit_balance ?? r.creditBalance ?? 0) || 0,
      active: r.active !== false,
      createdAt: r.created_at ?? r.createdAt ?? new Date().toISOString()
    };
  }

  function normalizeSale(s, itemsBySale) {
    if (!s) return null;
    const dbItems = itemsBySale.get(String(s.id)) || [];
    const items = dbItems.map(i => ({
      id: i.product_id || i.id,
      name: i.product_name || i.name || 'Item',
      qty: Number(i.qty) || 1,
      unitPrice: Number(i.unit_price ?? i.unitPrice ?? 0) || 0,
      totalPrice: Number(i.total_price ?? i.totalPrice ?? ((Number(i.qty)||1) * Number(i.unit_price||0))) || 0
    }));
    return {
      id: s.id,
      date: s.sale_date || s.date || s.created_at || new Date().toISOString(),
      operatorUsername: s.operator_username || s.operatorUsername || '',
      operatorName: s.operator_name || s.operatorName || '',
      customer: s.customer || 'Consumidor Final',
      customerId: s.customer_id || s.customerId || null,
      customerType: s.customer_type || s.customerType || 'CONSUMIDOR',
      observation: s.observation || '',
      items,
      subtotal: Number(s.subtotal) || 0,
      discount: Number(s.discount) || 0,
      total: Number(s.total) || 0,
      payMethod: s.pay_method || s.payMethod || 'PIX'
    };
  }

  async function init() {
    if (!isConfigured()) {
      cloudReady = false;
      setStatus('Banco local');
      return false;
    }
    if (!window.supabase?.createClient) {
      cloudReady = false;
      setStatus('Supabase indisponível','error');
      return false;
    }
    try {
      if (!client) {
        client = window.supabase.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
      }

      if (!authListenerStarted) {
        authListenerStarted = true;
        client.auth.onAuthStateChange((event, session) => {
          cloudReady = !!session;
          setStatus(session ? 'Banco online' : 'Banco configurado • faça login', session ? 'online' : 'local');
        });
      }

      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw error;
      cloudReady = !!session;
      setStatus(session ? 'Banco online' : 'Banco configurado • faça login', session ? 'online' : 'local');
      return !!session;
    } catch (e) {
      console.error('PDV Cloud init:', e);
      cloudReady = false;
      setStatus('Erro no banco','error');
      return false;
    }
  }

  async function requireClient() {
    if (!client) await init();
    if (!client) throw new Error('Supabase não inicializado.');
    return client;
  }

  async function loadData() {
    const cloud = await requireClient();
    const results = await Promise.allSettled([
      cloud.from('products').select('*').eq('active', true),
      cloud.from('customers').select('*').eq('active', true),
      cloud.from('sales').select('*').order('sale_date', { ascending: false }),
      cloud.from('profiles').select('id,username,full_name,role,active,created_at,updated_at')
    ]);

    const [productsR, customersR, salesR, profilesR] = results;

    if (productsR.status === 'fulfilled' && !productsR.value.error && Array.isArray(productsR.value.data)) {
      const data = productsR.value.data.map(normalizeProduct);
      localStorage.setItem('pdv_catalog', JSON.stringify(data));
      if (Array.isArray(window.catalog)) window.catalog = data;
    } else if (productsR.status === 'rejected' || productsR.value?.error) {
      console.warn('Não foi possível carregar produtos:', productsR.value?.error || productsR.reason);
    }

    if (customersR.status === 'fulfilled' && !customersR.value.error && Array.isArray(customersR.value.data)) {
      const data = customersR.value.data.map(normalizeCustomer);
      localStorage.setItem('pdv_customers', JSON.stringify(data));
      if (Array.isArray(window.customers)) window.customers = data;
    } else if (customersR.status === 'rejected' || customersR.value?.error) {
      console.warn('Não foi possível carregar clientes:', customersR.value?.error || customersR.reason);
    }

    if (salesR.status === 'fulfilled' && !salesR.value.error && Array.isArray(salesR.value.data)) {
      const sales = salesR.value.data;
      const ids = sales.map(s => s.id).filter(Boolean);
      const itemsBySale = new Map();
      if (ids.length) {
        for (let i=0; i<ids.length; i+=500) {
          const chunk = ids.slice(i, i+500);
          const r = await cloud.from('sale_items').select('*').in('sale_id', chunk);
          if (!r.error && Array.isArray(r.data)) {
            r.data.forEach(item => {
              const key = String(item.sale_id);
              if (!itemsBySale.has(key)) itemsBySale.set(key, []);
              itemsBySale.get(key).push(item);
            });
          } else if (r.error) {
            console.warn('Não foi possível carregar itens das vendas:', r.error);
          }
        }
      }
      const data = sales.map(s => normalizeSale(s, itemsBySale)).filter(Boolean);
      localStorage.setItem('pdv_sales_history', JSON.stringify(data));
      if (Array.isArray(window.salesHistory)) window.salesHistory = data;
    } else if (salesR.status === 'rejected' || salesR.value?.error) {
      console.warn('Não foi possível carregar vendas:', salesR.value?.error || salesR.reason);
    }

    if (profilesR.status === 'fulfilled' && !profilesR.value.error && Array.isArray(profilesR.value.data)) {
      const data = profilesR.value.data;
      localStorage.setItem('pdv_users', JSON.stringify(data.map(p => ({
        id:p.id, username:p.username || '', fullname:p.full_name || p.username || '', role:p.role || 'OPERATOR', active:p.active !== false
      }))));
    }

    // O carregamento do banco nunca deve derrubar um login válido por causa de uma tabela auxiliar.
    cloudReady = true;
    setStatus('Banco online','online');
    return true;
  }

  async function loadCalcPrices() {
    const cloud = await requireClient();
    const r = await cloud.from('calculator_prices').select('*').eq('id','default').maybeSingle();
    if (r.error) {
      console.warn('Não foi possível carregar preços das calculadoras:', r.error);
      return null;
    }
    if (!r.data) return null;
    const row = r.data;
    const prices = row.prices && typeof row.prices === 'object' ? row.prices : {};
    const aliases = {
      printBase:['printBase','print_base'], a3:['a3'], photo:['photo'], couche:['couche'], color:['color'], colorHigh:['colorHigh','color_high'],
      duplex:['duplex'], ilhose:['ilhose','ilhoses','ilhose_price'], bastao:['bastao'], finishSmall:['finishSmall','finish_small'], finishLarge:['finishLarge','finish_large'],
      plastA4:['plastA4','plast_a4'], plastA3:['plastA3','plast_a3'], refile:['refile']
    };
    const out = {};
    for (const [key, names] of Object.entries(aliases)) {
      for (const n of names) {
        if (row[n] != null) { out[key] = Number(row[n]); break; }
        if (prices[n] != null) { out[key] = Number(prices[n]); break; }
      }
    }
    localStorage.setItem('pdv_calc_prices', JSON.stringify(out));
    if (typeof window.calcPrices === 'object' && window.calcPrices) Object.assign(window.calcPrices, out);
    return out;
  }

  async function saveCalcPrices(prices) {
    const cloud = await requireClient();
    const row = { id:'default', ...prices, prices };
    const r = await cloud.from('calculator_prices').upsert(row, { onConflict:'id' }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function saveProduct(product) {
    const cloud = await requireClient();
    const row = {
      id: product.id,
      name: product.name,
      category: product.category,
      price: Number(product.price) || 0,
      icon: product.icon || 'fa-box',
      stock: product.stock ?? null,
      controls_stock: !!product.controlsStock,
      active: product.active !== false,
      calc_enabled: !!product.calcEnabled
    };
    const r = await cloud.from('products').upsert(row, { onConflict:'id' }).select().single();
    if (r.error) throw r.error;
    return normalizeProduct(r.data);
  }

  async function saveCustomer(customer) {
    const cloud = await requireClient();
    const row = {
      id: customer.id,
      name: customer.name,
      cpf: customer.cpf || null,
      phone: customer.phone || null,
      type: customer.type || 'MENSALISTA',
      monthly_limit: Number(customer.monthlyLimit) || 0,
      monthly_used: Number(customer.monthlyUsed) || 0,
      monthly_usage_month: customer.monthlyUsageMonth || new Date().toISOString().slice(0,7),
      credit_balance: Number(customer.creditBalance) || 0,
      active: customer.active !== false,
      created_at: customer.createdAt || new Date().toISOString()
    };
    const r = await cloud.from('customers').upsert(row, { onConflict:'id' }).select().single();
    if (r.error) throw r.error;
    return normalizeCustomer(r.data);
  }

  async function addCustomerCredit(id, value, description='Recarga de crédito') {
    const cloud = await requireClient();
    const current = await cloud.from('customers').select('*').eq('id',id).single();
    if (current.error) throw current.error;
    const balance = Number(current.data.credit_balance || 0) + Number(value || 0);
    const upd = await cloud.from('customers').update({ credit_balance: balance }).eq('id',id).select().single();
    if (upd.error) throw upd.error;
    try {
      const tx = await cloud.from('credit_transactions').insert({ customer_id:id, amount:Number(value)||0, transaction_type:'CREDITO', description }).select().single();
      if (tx.error) console.warn('Registro de transação de crédito não gravado:',tx.error);
    } catch(e) { console.warn('Registro de transação de crédito:',e); }
    return normalizeCustomer(upd.data);
  }

  async function finalizeSale(order) {
    const cloud = await requireClient();
    const saleRow = {
      id: order.id,
      sale_date: order.date || new Date().toISOString(),
      operator_username: order.operatorUsername || null,
      operator_name: order.operatorName || null,
      customer: order.customer || 'Consumidor Final',
      customer_id: order.customerId || null,
      customer_type: order.customerType || 'CONSUMIDOR',
      observation: order.observation || null,
      subtotal: Number(order.subtotal) || 0,
      discount: Number(order.discount) || 0,
      total: Number(order.total) || 0,
      pay_method: order.payMethod || 'PIX'
    };
    const sale = await cloud.from('sales').insert(saleRow).select().single();
    if (sale.error) throw sale.error;

    const items = (order.items || []).map(i => ({
      sale_id: order.id,
      product_id: i.id || null,
      product_name: i.name || 'Item',
      qty: Number(i.qty) || 1,
      unit_price: Number(i.unitPrice) || 0,
      total_price: Number(i.totalPrice) || 0
    }));
    if (items.length) {
      const r = await cloud.from('sale_items').insert(items);
      if (r.error) {
        // Evita deixar uma venda sem itens.
        await cloud.from('sales').delete().eq('id',order.id);
        throw r.error;
      }
    }

    let customer = null;
    if (order.customerId) {
      const c = await cloud.from('customers').select('*').eq('id',order.customerId).single();
      if (c.error) throw c.error;
      const current = normalizeCustomer(c.data);
      const patch = {};
      if (order.customerType === 'MENSALISTA') {
        patch.monthly_used = Number(current.monthlyUsed || 0) + Number(order.total || 0);
      } else if (order.customerType === 'CREDITO_ANTECIPADO') {
        const next = Number(current.creditBalance || 0) - Number(order.total || 0);
        if (next < -0.0001) throw new Error('Crédito insuficiente para concluir a venda.');
        patch.credit_balance = Math.max(0,next);
      }
      if (Object.keys(patch).length) {
        const upd = await cloud.from('customers').update(patch).eq('id',order.customerId).select().single();
        if (upd.error) throw upd.error;
        customer = normalizeCustomer(upd.data);
      } else customer = current;
    }
    return { sale: sale.data, customer };
  }

  async function syncData() {
    const cloud = await requireClient();
    const products = JSON.parse(localStorage.getItem('pdv_catalog') || '[]');
    const customers = JSON.parse(localStorage.getItem('pdv_customers') || '[]');
    if (products.length) for (const p of products) await saveProduct(p);
    if (customers.length) for (const c of customers) await saveCustomer(c);
    await loadData();
    return true;
  }

  async function syncAuxiliaryData() {
    const cloud = await requireClient();
    const tables = [
      ['suppliers','pdv_suppliers'],
      ['customer_contacts','pdv_customer_contacts'],
      ['customer_addresses','pdv_customer_addresses'],
      ['supplier_addresses','pdv_supplier_addresses']
    ];
    for (const [table,key] of tables) {
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      if (!rows.length) continue;
      const r = await cloud.from(table).upsert(rows, {onConflict:'id'});
      if (r.error) throw r.error;
    }
    return true;
  }

  async function updateOwnAdminAccount({fullname, username, email, password}) {
    const cloud = await requireClient();
    const {data:{user},error:userError}=await cloud.auth.getUser();
    if(userError) throw userError;
    if(!user) throw new Error('Sessão Supabase não autenticada.');
    const patch={full_name:fullname,username};
    const pr=await cloud.from('profiles').update(patch).eq('id',user.id).select('id,username,full_name,role,active').single();
    if(pr.error) throw pr.error;
    let emailChanged=false;
    if(email && email!==user.email){
      const ur=await cloud.auth.updateUser({email});
      if(ur.error) throw ur.error;
      emailChanged=true;
    }
    if(password){
      const ur=await cloud.auth.updateUser({password});
      if(ur.error) throw ur.error;
    }
    return {...pr.data,email:emailChanged?email:user.email,emailChanged};
  }

  async function showStatus() {
    if (!isConfigured()) {
      alert('O banco online ainda não foi configurado.\n\nPreencha supabase-config.js e habilite enabled: true.');
      return;
    }
    await init();
    const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
    alert(user ? `Banco online conectado.\nUsuário: ${user.email || user.id}` : 'Banco configurado, mas nenhuma sessão Supabase está autenticada.');
  }

  window.PDVCloud = {
    init, showStatus, loadData, loadCalcPrices, saveCalcPrices, saveProduct, saveCustomer,
    addCustomerCredit, finalizeSale, syncData, syncAuxiliaryData, updateOwnAdminAccount,
    setStatus,
    get client(){return client;},
    get ready(){return cloudReady;}
  };

  window.addEventListener('DOMContentLoaded', () => { setTimeout(init, 50); });
})();
