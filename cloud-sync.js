/* PDV Cloud sync - Supabase Auth + persistence for products, customers and sales. */
(() => {
  if (window.PDVCloud) { console.warn('PDVCloud já foi inicializado; evitando instância duplicada.'); return; }
  const cfg = window.PDV_SUPABASE_CONFIG || {};
  let client = null;
  let cloudReady = false;
  let syncInProgress = Promise.resolve();
  const setStatus = (text, state='local') => {
    const label=document.getElementById('cloud-status-text');
    const dot=document.getElementById('cloud-status-dot');
    const box=document.getElementById('cloud-status');
    if (box && label && dot) {
      box.classList.remove('hidden'); label.textContent=text;
      dot.className='w-2 h-2 rounded-full '+(state==='online'?'bg-emerald-400':state==='error'?'bg-rose-400':'bg-slate-400');
    }
  };
  const fail = (error, action) => { if (error) throw new Error(`${action}: ${error.message || error.details || 'erro desconhecido'}`); };
  async function init() {
    if (!cfg.enabled || !cfg.url || !cfg.anonKey) { setStatus('Banco local'); return false; }
    if (!window.supabase?.createClient) { setStatus('Biblioteca Supabase indisponível','error'); return false; }
    try {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const {data,error}=await client.auth.getSession(); fail(error,'Sessão');
      cloudReady=!!data.session;
      setStatus(cloudReady?'Sessão Supabase ativa':'Banco configurado • faça login',cloudReady?'online':'local');
      if (cloudReady) { try { await loadCalcPrices(); } catch (e) { console.warn('Não foi possível carregar preços das calculadoras:',e); } }
      return cloudReady;
    } catch(e) { console.error('PDV Cloud init',e); setStatus('Erro de conexão Supabase','error'); return false; }
  }
  const productToDb = p => ({id:String(p.id),name:String(p.name||''),category:String(p.category||'OUTROS'),price:Number(p.price)||0,icon:p.icon||null,stock:p.stock==null?null:Number(p.stock),controls_stock:!!p.controlsStock,active:p.active!==false,updated_at:new Date().toISOString()});
  const productFromDb = p => ({id:p.id,name:p.name,category:p.category,price:Number(p.price)||0,icon:p.icon||'fa-box',stock:p.stock==null?undefined:Number(p.stock),controlsStock:!!p.controls_stock,active:p.active!==false});
  const customerToDb = c => ({id:String(c.id),name:String(c.name||''),cpf:c.cpf||null,phone:c.phone||null,type:c.type,monthly_limit:Number(c.monthlyLimit)||0,monthly_used:Number(c.monthlyUsed)||0,monthly_usage_month:c.monthlyUsageMonth||null,credit_balance:Number(c.creditBalance)||0,active:c.active!==false,updated_at:new Date().toISOString()});
  const customerFromDb = c => ({id:c.id,name:c.name,cpf:c.cpf||'',phone:c.phone||'',type:c.type,monthlyLimit:Number(c.monthly_limit)||0,monthlyUsed:Number(c.monthly_used)||0,monthlyUsageMonth:c.monthly_usage_month||null,creditBalance:Number(c.credit_balance)||0,active:c.active!==false,createdAt:c.created_at});
  // Preços centrais das calculadoras: um único registro compartilhado no Supabase.
  async function loadCalcPrices() {
    if (!client) await init();
    if (!client || !cloudReady) return null;
    const {data:{user},error:ue}=await client.auth.getUser(); fail(ue,'Autenticação dos preços');
    if (!user) return null;
    const {data,error}=await client.from('calculator_prices').select('prices').eq('id','default').maybeSingle();
    fail(error,'Leitura dos preços das calculadoras');
    if (data?.prices && typeof data.prices==='object' && typeof calcPrices!=='undefined') {
      calcPrices={...DEFAULT_CALC_PRICES,...data.prices};
      localStorage.setItem('pdv_calc_prices',JSON.stringify(calcPrices));
      if (typeof renderCalcPricesAdmin==='function') renderCalcPricesAdmin();
      if (typeof calculatePrintCost==='function') calculatePrintCost();
      if (typeof calculateBannerCost==='function') calculateBannerCost();
      if (typeof calculateFinishCost==='function') calculateFinishCost();
    }
    return data?.prices || null;
  }
  async function saveCalcPrices(prices) {
    if (!client || !cloudReady) throw new Error('Entre com uma conta autenticada no Supabase antes de salvar preços.');
    const {data:{user},error:ue}=await client.auth.getUser(); fail(ue,'Autenticação dos preços');
    if (!user) throw new Error('Sessão Supabase não autenticada.');
    const {data:profile,error:pe}=await client.from('profiles').select('role,active').eq('id',user.id).single(); fail(pe,'Verificação do administrador');
    if (!profile?.active || profile.role!=='ADMIN') throw new Error('Somente um administrador ativo pode alterar os preços.');
    const safePrices={};
    Object.keys(DEFAULT_CALC_PRICES).forEach(key=>{ const value=Number(prices?.[key]); if(!Number.isFinite(value)||value<0) throw new Error('Preço inválido: '+key); safePrices[key]=value; });
    const row={id:'default',prices:safePrices,updated_by:user.id,updated_at:new Date().toISOString()};
    const {data: savedRow, error}=await client.from('calculator_prices').upsert(row,{onConflict:'id'}).select('id,prices,updated_by,updated_at').single();
    fail(error,'Gravação dos preços das calculadoras');
    if (!savedRow || savedRow.id!=='default' || !savedRow.prices) throw new Error('O Supabase não confirmou a gravação dos preços. Confira as permissões da tabela calculator_prices.');
    for (const key of Object.keys(DEFAULT_CALC_PRICES)) { if (Number(savedRow.prices[key]) !== safePrices[key]) throw new Error('O Supabase não confirmou o valor de '+key+'. Atualize a página e tente novamente.'); }
    calcPrices={...DEFAULT_CALC_PRICES,...savedRow.prices};
    localStorage.setItem('pdv_calc_prices',JSON.stringify(calcPrices));
    setStatus('Banco online • preços compartilhados','online');
    return calcPrices;
  }
  async function loadAuxiliaryData() {
    if (!client) await init();
    if (!client || !cloudReady) return null;
    const queries = await Promise.allSettled([
      client.from('suppliers').select('*').eq('active',true),
      client.from('customer_contacts').select('*'),
      client.from('customer_addresses').select('*'),
      client.from('supplier_addresses').select('*')
    ]);
    const get = (idx) => queries[idx]?.status === 'fulfilled' ? queries[idx].value : {data:null,error:queries[idx]?.reason};
    const sr=get(0), cc=get(1), ca=get(2), sa=get(3);
    // As tabelas auxiliares podem ainda não existir em instalações antigas.
    // Nesse caso não interrompemos o login; após executar a migration SQL, os dados passam a carregar normalmente.
    const missing = [sr,cc,ca,sa].some(r=>r.error && /relation .* does not exist|could not find the table/i.test(r.error.message||''));
    if (missing) { console.warn('Tabelas auxiliares do Excel ainda não foram criadas. Execute supabase_import_auxiliary.sql.'); return null; }
    fail(sr.error,'Leitura de fornecedores'); fail(cc.error,'Leitura de contatos'); fail(ca.error,'Leitura de endereços de clientes'); fail(sa.error,'Leitura de endereços de fornecedores');
    if (sr.data?.length && typeof suppliers!=='undefined') { suppliers=sr.data; localStorage.setItem('pdv_suppliers',JSON.stringify(suppliers)); }
    if (cc.data?.length && typeof customerContacts!=='undefined') { customerContacts=cc.data; localStorage.setItem('pdv_customer_contacts',JSON.stringify(customerContacts)); }
    if (ca.data?.length && typeof customerAddresses!=='undefined') { customerAddresses=ca.data; localStorage.setItem('pdv_customer_addresses',JSON.stringify(customerAddresses)); }
    if (sa.data?.length && typeof supplierAddresses!=='undefined') { supplierAddresses=sa.data; localStorage.setItem('pdv_supplier_addresses',JSON.stringify(supplierAddresses)); }
    return {suppliers:sr.data||[],customerContacts:cc.data||[],customerAddresses:ca.data||[],supplierAddresses:sa.data||[]};
  }

  async function syncAuxiliaryData() {
    if (!client || !cloudReady) throw new Error('Supabase não está conectado. Faça login antes de sincronizar os cadastros auxiliares.');
    const job=async()=>{
      const {data:{user},error:ue}=await client.auth.getUser(); fail(ue,'Sessão'); if(!user) throw new Error('Sessão expirada');
      const {data:profile,error:pe}=await client.from('profiles').select('role,active').eq('id',user.id).single(); fail(pe,'Perfil');
      if(!profile?.active || profile.role!=='ADMIN') throw new Error('Somente um administrador ativo pode importar/exportar fornecedores, contatos e endereços.');

      const datasets = [
        ['suppliers', typeof suppliers!=='undefined' ? suppliers : [], 'fornecedores'],
        ['customer_contacts', typeof customerContacts!=='undefined' ? customerContacts : [], 'contatos de clientes'],
        ['customer_addresses', typeof customerAddresses!=='undefined' ? customerAddresses : [], 'endereços de clientes'],
        ['supplier_addresses', typeof supplierAddresses!=='undefined' ? supplierAddresses : [], 'endereços de fornecedores']
      ];
      const maps = {
        suppliers: r=>({id:String(r.id),name:String(r.name||r.nome||''),supplier_type:r.supplierType||r.supplier_type||r.tipo_fornecedor||r.tipo_de_fornecedor||r.tipo||null,active:r.active!==false,email:r.email||null,phone:r.phone||r.telefone||null,mobile:r.mobile||r.celular||null,notes:r.notes||r.observacao||null,updated_at:new Date().toISOString()}),
        customer_contacts: r=>({id:String(r.id),customer_id:String(r.customer_id||r.cliente_id||r.codigo||''),contact_type:r.contact_type||r.tipo_contato||r.tipo_de_contato||r.tipo||null,name:r.name||r.nome||null,contact:r.contact||r.contato||null,cargo:r.cargo||null,notes:r.notes||r.observacao||null,updated_at:new Date().toISOString()}),
        customer_addresses: r=>({id:String(r.id),customer_id:String(r.customer_id||r.cliente_id||r.codigo||''),address_type:r.address_type||r.tipo_endereco||r.tipo||null,cep:r.cep||null,logradouro:r.logradouro||r.rua||r.endereco||null,numero:r.numero||null,complemento:r.complemento||null,bairro:r.bairro||null,cidade:r.cidade||null,uf:r.uf||null,updated_at:new Date().toISOString()}),
        supplier_addresses: r=>({id:String(r.id),supplier_id:String(r.supplier_id||r.fornecedor_id||r.codigo||''),address_type:r.address_type||r.tipo_endereco||r.tipo||null,cep:r.cep||null,logradouro:r.logradouro||r.rua||r.endereco||null,numero:r.numero||null,complemento:r.complemento||null,bairro:r.bairro||null,cidade:r.cidade||null,uf:r.uf||null,updated_at:new Date().toISOString()})
      };
      for (const [table, list, label] of datasets) {
        const rows=list.map(maps[table]).filter(r=>r.id && (table==='suppliers' ? r.name : (table.includes('customer') ? r.customer_id : r.supplier_id)));
        if (!rows.length) continue;
        const r=await client.from(table).upsert(rows,{onConflict:'id'});
        fail(r.error,'Gravação de '+label);
      }
      setStatus('Banco online • cadastros auxiliares sincronizados','online');
    };
    syncInProgress=syncInProgress.then(job,job); return syncInProgress;
  }

  async function loadData() {
    if (!client) await init();
    if (!client) throw new Error('Cliente Supabase não inicializado');
    const {data:{user},error:authError}=await client.auth.getUser(); fail(authError,'Autenticação');
    if (!user) throw new Error('Sessão não autenticada');
    const [pr,cr,sr]=await Promise.all([
      client.from('products').select('*').eq('active',true),
      client.from('customers').select('*').eq('active',true),
      client.from('sales').select('*').order('sale_date',{ascending:false}).limit(2000)
    ]);
    fail(pr.error,'Leitura de produtos'); fail(cr.error,'Leitura de clientes'); fail(sr.error,'Leitura de vendas');
    if (pr.data?.length && typeof catalog!=='undefined') { catalog=pr.data.map(productFromDb); localStorage.setItem('pdv_catalog',JSON.stringify(catalog)); }
    if (cr.data?.length && typeof customers!=='undefined') { customers=cr.data.map(customerFromDb); localStorage.setItem('pdv_customers',JSON.stringify(customers)); }
    if (sr.data?.length && typeof salesHistory!=='undefined') {
      const items=await client.from('sale_items').select('*').in('sale_id',sr.data.map(s=>s.id)); fail(items.error,'Leitura dos itens');
      const bySale={}; (items.data||[]).forEach(i=>(bySale[i.sale_id]??=[]).push({id:i.product_id,name:i.product_name,quantity:Number(i.quantity),price:Number(i.unit_price),total:Number(i.total)}));
      salesHistory=sr.data.map(s=>({id:s.id,date:s.sale_date,operatorUsername:s.operator_username,operatorName:s.operator_name,customer:s.customer||'Consumidor Final',customerId:s.customer_id,customerType:s.customer_type,subtotal:Number(s.subtotal),discount:Number(s.discount),total:Number(s.total),payMethod:s.pay_method,items:bySale[s.id]||[]}));
      localStorage.setItem('pdv_sales_history',JSON.stringify(salesHistory));
    }
    try { await loadAuxiliaryData(); } catch(e) { console.warn('Não foi possível carregar cadastros auxiliares:',e); }
    cloudReady=true; setStatus('Banco online • dados carregados','online');
  }
  // Salva um único produto imediatamente no Supabase e só confirma após retorno do banco.
  async function saveProduct(product) {
    if (!client || !cloudReady) throw new Error('Entre com uma conta autenticada no Supabase antes de salvar produtos.');
    const {data:{user},error:ue}=await client.auth.getUser(); fail(ue,'Autenticação do produto');
    if (!user) throw new Error('Sessão Supabase não autenticada.');
    const {data:profile,error:pe}=await client.from('profiles').select('role,active').eq('id',user.id).single();
    fail(pe,'Verificação do administrador');
    if (!profile?.active || profile.role!=='ADMIN') throw new Error('Somente um administrador ativo pode alterar produtos.');
    const row=productToDb(product);
    const {data:saved,error}=await client.from('products').upsert(row,{onConflict:'id'}).select('*').single();
    fail(error,'Gravação do produto');
    if (!saved || String(saved.id)!==String(product.id) || Number(saved.price)!==Number(product.price)) {
      throw new Error('O Supabase não confirmou o preço do produto. Confira a tabela products e as permissões RLS.');
    }
    setStatus('Banco online • produto sincronizado','online');
    return productFromDb(saved);
  }

  async function syncData() {
    if (!client || !cloudReady) return;
    const job=async()=>{
      const {data:{user},error:ue}=await client.auth.getUser(); fail(ue,'Sessão'); if(!user) throw new Error('Sessão expirada');
      const {data:profile,error:pe}=await client.from('profiles').select('role,active').eq('id',user.id).single(); fail(pe,'Perfil');
      if(!profile?.active) throw new Error('Perfil inativo');
      // Sincronização dos registros já carregados no PDV, usando IDs estáveis.
      if(typeof catalog!=='undefined' && profile.role==='ADMIN') { const rows=catalog.map(productToDb); if(rows.length){const r=await client.from('products').upsert(rows,{onConflict:'id'});fail(r.error,'Gravação de produtos');} }
      if(typeof customers!=='undefined' && profile.role==='ADMIN') { const rows=customers.map(customerToDb); if(rows.length){const r=await client.from('customers').upsert(rows,{onConflict:'id'});fail(r.error,'Gravação de clientes');} }
      setStatus('Banco online • sincronizado','online');
    };
    syncInProgress=syncInProgress.then(job,job); return syncInProgress;
  }
  async function syncSale(s) {
    if (!client || !cloudReady) throw new Error('Sessão Supabase não autenticada');
    const {data:{user},error:ue}=await client.auth.getUser(); fail(ue,'Sessão'); if(!user) throw new Error('Sessão expirada');
    const row={id:String(s.id),sale_date:s.date||new Date().toISOString(),operator_id:user.id,operator_username:s.operatorUsername||null,operator_name:s.operatorName||null,customer:s.customer||null,customer_id:s.customerId||null,customer_type:s.customerType||'CONSUMIDOR',subtotal:Number(s.subtotal)||0,discount:Number(s.discount)||0,total:Number(s.total)||0,pay_method:String(s.payMethod||'PIX')};
    const wr=await client.from('sales').upsert(row,{onConflict:'id'}); fail(wr.error,'Gravação de venda');
    const its=(s.items||[]).map(i=>({sale_id:String(s.id),product_id:i.id?String(i.id):null,product_name:String(i.name||i.productName||'Item'),quantity:Number(i.quantity)||1,unit_price:Number(i.price??i.unitPrice)||0,total:Number(i.total??((Number(i.price??i.unitPrice)||0)*(Number(i.quantity)||1))) }));
    if(its.length){const ins=await client.from('sale_items').insert(its);fail(ins.error,'Gravação dos itens');}
    setStatus('Banco online • venda sincronizada','online');
  }
  async function showStatus(){
    if(!client) await init();
    if(!client){alert('Confira a URL, a chave pública e o carregamento da biblioteca Supabase.');return;}
    const {data:{user},error}=await client.auth.getUser();
    if(error) alert('Erro: '+error.message); else alert(user?`Sessão autenticada: ${user.email||user.id}`:'Supabase configurado, mas não há sessão autenticada.');
  }
  window.PDVCloud={init,loadData,loadAuxiliaryData,syncAuxiliaryData,loadCalcPrices,saveCalcPrices,saveProduct,syncData,syncSale,showStatus,setStatus,get client(){return client;},get ready(){return cloudReady;}};
  window.addEventListener('DOMContentLoaded',()=>{init();});
})();
