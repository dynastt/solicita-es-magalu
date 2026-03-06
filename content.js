(function(){
'use strict';
if(document.getElementById('__sol__')) return;

// ═══ TOKEN ════════════════════════════════════════════
let _tok=null,_tokTs=0;
let _tokenRenovando=false;
let _tokenSessaoExpirou=false;
let _tokenUltimoErro=0;

// Intercepta fetch/XHR pra capturar token automaticamente (sem depender de outra extensão)
(function(){
  const origFetch=window.fetch;
  window.fetch=function(input,init){
    init=init||{};
    const h=init.headers||{};
    const auth=h.Authorization||h.authorization||'';
    if(auth){
      const full=auth.startsWith('Bearer ')?auth:'Bearer '+auth;
      if(full!==_tok){_tok=full;_tokTs=Date.now();window.__MGT__=_tok;window.__MGTS__=_tokTs;_tokenSessaoExpirou=false;_tokenUltimoErro=0;uiToken();}
    }
    return origFetch.apply(this,arguments);
  };
  const origSet=XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader=function(k,v){
    if(k.toLowerCase()==='authorization'&&v){
      const full=v.startsWith('Bearer ')?v:'Bearer '+v;
      if(full!==_tok){_tok=full;_tokTs=Date.now();window.__MGT__=_tok;window.__MGTS__=_tokTs;_tokenSessaoExpirou=false;_tokenUltimoErro=0;uiToken();}
    }
    return origSet.apply(this,arguments);
  };
})();

function syncTok(){
  const t=window.__MGT__;
  if(t&&t!==_tok){
    _tok=t;_tokTs=window.__MGTS__||Date.now();
    // Se tinha sessão expirada, limpa o flag — usuário agiu no site
    if(_tokenSessaoExpirou){
      _tokenSessaoExpirou=false;
      _tokenUltimoErro=0;
      log('Sessão restaurada ✓','ok');
    }
    uiToken();
  }
}
window.addEventListener('__mgt__',e=>{
  _tok=e.detail;_tokTs=Date.now();
  _tokenSessaoExpirou=false;_tokenUltimoErro=0;
  uiToken();
});
setInterval(syncTok,800);
function getTok(){return _tok;}
function tokMins(){
  try{const p=(_tok||'').replace('Bearer ','').split('.');if(p.length!==3)return null;
  const pl=JSON.parse(atob(p[1]));return pl.exp?Math.round((pl.exp*1000-Date.now())/60000):null;}
  catch{return null;}
}

// Renovação silenciosa via iframe
async function _renovarTokenSilencioso(){
  if(_tokenRenovando) return false;
  // Se sessão está morta, não tenta de novo por 5 minutos
  if(_tokenSessaoExpirou && Date.now()-_tokenUltimoErro < 5*60*1000) return false;
  _tokenRenovando=true;
  try{
    const code=await new Promise((resolve,reject)=>{
      const state=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
      const iframe=document.createElement('iframe');
      iframe.style.cssText='display:none;position:fixed;top:-9999px;';
      document.body.appendChild(iframe);
      const timeout=setTimeout(()=>{
        try{document.body.removeChild(iframe);}catch(_){}
        reject(new Error('Timeout ao renovar token'));
      },20000);
      const monitor=setInterval(()=>{
        try{
          const url=iframe.contentWindow.location.href;
          // Detecta se foi redirecionado pro login — sessão expirou
          if(url.includes('baap-sso-login')||url.includes('/login')){
            clearInterval(monitor);clearTimeout(timeout);
            try{document.body.removeChild(iframe);}catch(_){}
            reject(new Error('SESSAO_EXPIROU'));
            return;
          }
          const c=url.match(/code=([a-f0-9-]+)/)?.[1];
          if(c){clearInterval(monitor);clearTimeout(timeout);try{document.body.removeChild(iframe);}catch(_){}resolve(c);}
        }catch(_){}
      },50);
      iframe.src=`https://baap-sso-api.magazineluiza.com.br/auth?application_id=61df0c4efa2156a81962dd3c&url_callback=https://gestaoativos.magazineluiza.com.br&state=${state}`;
    });
    const res=await fetch(`https://baap-sso-api.magazineluiza.com.br/token/${code}`,{credentials:'include',headers:{'accept':'application/json, text/plain, */*'}});
    const data=await res.json();
    if(data?.value?.access_token){
      _tok='Bearer '+data.value.access_token;
      _tokTs=Date.now();
      window.__MGT__=_tok;
      window.__MGTS__=_tokTs;
      _tokenSessaoExpirou=false;
      _tokenUltimoErro=0;
      uiToken();
      log('Token renovado automaticamente ✓','ok');
      return true;
    }
  }catch(e){
    if(e.message==='SESSAO_EXPIROU'){
      // Sessão morreu — avisa uma vez e para de tentar
      if(!_tokenSessaoExpirou){
        log('Sessão expirou — clique em qualquer menu do portal para restaurar','warn');
        uiToken();
      }
      _tokenSessaoExpirou=true;
      _tokenUltimoErro=Date.now();
    } else {
      // Timeout — tenta mais uma vez silenciosamente antes de desistir
      _tokenRenovando=false;
      const retry=await _renovarTokenSilencioso();
      if(!retry) _tokenUltimoErro=Date.now();
      return retry;
    }
  }finally{
    _tokenRenovando=false;
  }
  return false;
}

// Verifica e renova token se necessário — chamado antes de cada operação importante
async function ensureToken(){
  const m=tokMins();
  // Só renova se token existe, expiração é legível E está perto de acabar
  if(_tok && m!==null && m<2){
    await _renovarTokenSilencioso();
  }
}

// Auto-renovação — checa a cada 1 minuto
setInterval(async()=>{
  const m=tokMins();
  // Só renova se token existe, expiração é legível E está perto de acabar
  if(_tok && m!==null && m<=1){
    await _renovarTokenSilencioso();
  }
},60000);

// ═══ HELPERS ══════════════════════════════════════════
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad=(c,n=4)=>String(c).padStart(n,'0');
const norm=c=>(c||'').toString().replace(/\D/g,'').replace(/^0+/,'');

// ═══ STATE ════════════════════════════════════════════
const API='https://gestao-ativos-api.magazineluiza.com.br';
const S={running:false,stop:false,results:[],startTime:null};

// ═══ API ══════════════════════════════════════════════
async function _refreshOn401(){
  log('Token 401 - renovando...','warn');
  await _renovarTokenSilencioso();
}

async function req(method,ep,body,retry){
  retry=retry||0;
  await ensureToken();
  const auth=getTok();
  if(!auth)throw new Error('Token nao capturado.');
  const opts={method:method,headers:{'Content-Type':'application/json','Authorization':auth}};
  if(body)opts.body=JSON.stringify(body);
  const res=await fetch(API+ep,opts);
  if(res.status>=200&&res.status<300){
    const t=await res.text();
    try{return JSON.parse(t);}catch(e){return t;}
  }
  if(res.status===401&&retry<3){await _refreshOn401();return req(method,ep,body,retry+1);}
  const txt=await res.text().catch(()=>'');
  throw new Error('HTTP '+res.status+': '+txt.slice(0,120));
}

// ═══ CSS ══════════════════════════════════════════════
function injectCSS(){
  if(document.getElementById('__sol_css__'))return;
  if(!document.head)return setTimeout(injectCSS,10);
  const s=document.createElement('style');
  s.id='__sol_css__';
  s.textContent=[
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');",
    ":root{--bg:#0d0d0d;--s1:#161616;--s2:#1e1e1e;--s3:#282828;--b1:rgba(255,255,255,0.07);--b2:rgba(255,255,255,0.12);--t1:#f0f0f0;--t2:#a0a0a0;--t3:#606060;--blue:#3b82f6;--green:#22c55e;--red:#ef4444;--redlt:rgba(239,68,68,0.12);--bluelt:rgba(59,130,246,0.12);}",
    "#__sol__{position:fixed;top:0;right:0;width:340px;height:100vh;background:var(--bg);border-left:1px solid var(--b1);font-family:'Inter',sans-serif;color:var(--t1);z-index:2147483646;display:flex;flex-direction:column;overflow:hidden;transition:transform .28s;}",
    "#__sol__.off{transform:translateX(100%);}",
    "#__sol_tab__{position:fixed;top:50%;right:0;transform:translateY(-50%);background:var(--s2);border:1px solid var(--b1);border-right:none;border-radius:8px 0 0 8px;padding:12px 7px;cursor:pointer;z-index:2147483645;writing-mode:vertical-lr;font-size:10px;font-weight:700;color:var(--t2);letter-spacing:1.5px;display:none;}",
    ".solh{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid var(--b1);flex-shrink:0;}",
    ".solh-l{display:flex;align-items:center;gap:10px;}",
    ".solh-ico{width:32px;height:32px;background:var(--bluelt);border:1px solid rgba(59,130,246,0.3);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;}",
    ".solh-title{font-size:13px;font-weight:700;}.solh-sub{font-size:10px;color:var(--t3);margin-top:1px;}",
    ".solh-btns{display:flex;gap:4px;}",
    ".solh-btn{background:none;border:none;color:var(--t3);cursor:pointer;width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s;}",
    ".solh-btn:hover{background:var(--s3);color:var(--t1);}.solh-btn.cb:hover{background:var(--redlt);color:#fca5a5;}",
    ".sol-tok{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:11px;border-bottom:1px solid var(--b1);flex-shrink:0;}",
    ".sol-tok-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}",
    ".sol-tok.ok .sol-tok-dot{background:var(--green);box-shadow:0 0 6px var(--green);}",
    ".sol-tok.w .sol-tok-dot{background:#f59e0b;animation:blink 1.2s infinite;}",
    ".sol-tok.ex .sol-tok-dot{background:var(--red);animation:blink .8s infinite;}",
    "@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}",
    ".sol-tok.ok{color:var(--t2);}.sol-tok.w,.sol-tok.ex{color:#fcd34d;}",
    ".sols{flex:1;overflow-y:auto;padding:14px 14px 10px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;}",
    ".sol-card{background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px 13px;}",
    ".sol-card-label{font-size:9.5px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}",
    ".sol-ta{width:100%;background:var(--s2);border:1px solid var(--b1);border-radius:7px;color:var(--t1);font-size:12px;font-family:'JetBrains Mono',monospace;padding:9px 10px;box-sizing:border-box;resize:vertical;outline:none;line-height:1.6;}",
    ".sol-ta:focus{border-color:rgba(59,130,246,.5);}.sol-ta::placeholder{color:var(--t3);}",
    ".sol-hints{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;}",
    ".sol-hint{font-size:9.5px;color:var(--t3);background:var(--s3);border-radius:4px;padding:2px 7px;font-family:'JetBrains Mono',monospace;}",
    ".sol-row{display:flex;gap:8px;margin-bottom:8px;}.sol-row:last-child{margin-bottom:0;}",
    ".sol-sel-wrap{flex:1;position:relative;}",
    ".sol-sel{width:100%;background:var(--s2);border:1px solid var(--b1);border-radius:7px;color:var(--t1);font-size:12px;padding:9px 28px 9px 10px;appearance:none;outline:none;cursor:pointer;}",
    ".sol-sel:focus{border-color:rgba(59,130,246,.5);}",
    ".sol-sa{position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--t3);font-size:10px;}",
    ".sol-inp{flex:1;background:var(--s2);border:1px solid var(--b1);border-radius:7px;color:var(--t1);font-size:12px;font-family:'JetBrains Mono',monospace;padding:9px 10px;box-sizing:border-box;outline:none;}",
    ".sol-inp:focus{border-color:rgba(59,130,246,.5);}.sol-inp::placeholder{color:var(--t3);}",
    ".sol-modo{display:flex;background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:3px;gap:3px;margin-bottom:10px;}",
    ".sol-modo-btn{flex:1;padding:6px 0;border:none;border-radius:6px;font-family:'Inter',sans-serif;font-size:10.5px;font-weight:600;cursor:pointer;transition:all .18s;color:var(--t3);background:none;}",
    ".sol-modo-btn.active{background:var(--blue);color:#fff;box-shadow:0 2px 8px rgba(59,130,246,.35);}",
    ".sol-gemco-wrap{transition:all .18s;}",
    ".sol-btn{width:100%;padding:11px;border-radius:8px;border:none;font-family:'Inter',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:7px;}",
    ".sol-btn-run{background:var(--blue);color:#fff;}.sol-btn-run:hover{background:#2563eb;}",
    ".sol-btn-stop{background:var(--redlt);border:1px solid rgba(239,68,68,.3);color:#fca5a5;display:none;}",
    ".sol-div{height:1px;background:var(--b1);margin:2px 0;}",
    ".sol-st{font-size:11px;color:var(--t3);text-align:center;padding:4px 0;min-height:20px;}.sol-st.on{color:#93c5fd;}",
    ".sol-pw{height:3px;background:var(--s3);border-radius:2px;overflow:hidden;display:none;}.sol-pw.on{display:block;}",
    ".sol-pb{height:100%;background:var(--blue);border-radius:2px;transition:width .3s;width:0%;}",
    ".sol-log{border-top:1px solid var(--b1);flex-shrink:0;}",
    ".sol-lh{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 6px;cursor:pointer;user-select:none;}",
    ".sol-ll{font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:1.2px;display:flex;align-items:center;gap:6px;}",
    ".sol-lcount{background:var(--s3);color:var(--t3);font-size:9px;font-weight:700;padding:1px 5px;border-radius:9px;}",
    ".sol-lclr{background:none;border:none;color:var(--t3);font-size:10.5px;cursor:pointer;padding:2px 7px;border-radius:5px;}",
    ".sol-lclr:hover{color:var(--red);}",
    ".sol-lb{max-height:150px;overflow-y:auto;padding:4px 12px 10px;scrollbar-width:thin;}",
    ".sol-le{font-size:10.5px;font-family:'JetBrains Mono',monospace;padding:2px 0 2px 8px;border-left:2px solid;margin-bottom:3px;line-height:1.4;}",
    ".sol-le.info{border-color:rgba(99,102,241,.6);color:#a5b4fc;}",
    ".sol-le.ok{border-color:rgba(34,197,94,.5);color:#86efac;}",
    ".sol-le.warn{border-color:rgba(245,158,11,.5);color:#fcd34d;}",
    ".sol-le.err{border-color:rgba(239,68,68,.5);color:#fca5a5;}",
    ".aa-ov{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);z-index:2147483647;display:flex;align-items:center;justify-content:center;}",
    ".aa-modal{background:var(--s1);border:1px solid var(--b2);border-radius:14px;padding:22px 20px 18px;max-width:420px;width:92%;box-shadow:0 24px 60px rgba(0,0,0,.8);}",
    ".aa-res-modal{max-width:460px;width:95%;}",
    ".aa-m-ico{font-size:36px;text-align:center;margin-bottom:8px;}",
    ".aa-m-ttl{font-size:15px;font-weight:700;text-align:center;margin-bottom:6px;}",
    ".aa-m-msg{font-size:12.5px;color:var(--t2);text-align:center;line-height:1.55;margin-bottom:14px;white-space:pre-line;}",
    ".aa-m-btns{display:flex;gap:7px;}",
    ".aa-mb{flex:1;padding:10px;border-radius:8px;border:none;font-family:'Inter',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer;transition:all .15s;}",
    ".aa-mb.p{background:var(--blue);color:#fff;}.aa-mb.p:hover{background:#2563eb;}",
    ".aa-mb.s{background:var(--s3);border:1px solid var(--b1);color:var(--t2);}",
    ".aa-mb.d{background:var(--redlt);border:1px solid rgba(239,68,68,.3);color:#fca5a5;}",
    ".aa-res-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;}",
    ".aa-res-cell{background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:8px 4px;text-align:center;}",
    ".aa-res-val{font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace;}",
    ".aa-res-lbl{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-top:1px;}",
    ".aa-rtable{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:10px;}",
    ".aa-rtable thead th{text-align:left;color:var(--t3);font-size:9.5px;font-weight:600;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid var(--b1);}",
    ".aa-rtable tbody td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.03);}",
    ".aa-rtable tbody tr.ok td{background:rgba(34,197,94,.06);}",
    ".aa-rtable tbody tr.fail td{background:rgba(239,68,68,.06);}",
    ".tag-ok{color:var(--green);font-weight:700;font-size:10.5px;}",
    ".tag-fail{color:var(--red);font-weight:700;font-size:10.5px;}"
  ].join('\n');
  document.head.appendChild(s);
}

// ═══ PAINEL ══════════════════════════════════════════
function buildPanel(){
  if(document.getElementById('__sol__'))return;
  if(!document.body)return setTimeout(buildPanel,10);
  const root=document.createElement('div');
  root.id='__sol__';
  root.innerHTML=
    '<div class="solh">' +
      '<div class="solh-l">' +
        '<div class="solh-ico">\u{1F4E4}</div>' +
        '<div><div class="solh-title">Solicitar Ativos</div><div class="solh-sub">v2 \u00B7 MAGALU</div></div>' +
      '</div>' +
      '<div class="solh-btns">' +
        '<button class="solh-btn" id="sol-min">\u2212</button>' +
        '<button class="solh-btn cb" id="sol-close">\u2715</button>' +
      '</div>' +
    '</div>' +
    '<div class="sol-tok w" id="sol-tok"><div class="sol-tok-dot"></div><span id="sol-tok-txt">Aguardando token...</span></div>' +
    '<div class="sols">' +
      '<div class="sol-card">' +
        '<div class="sol-card-label">Modo de execucao</div>' +
        '<div class="sol-modo">' +
          '<button class="sol-modo-btn active" id="sol-modo-unico">Gemco \u00DAnico</button>' +
          '<button class="sol-modo-btn" id="sol-modo-filial">Gemco por Filial</button>' +
        '</div>' +
        '<div class="sol-card-label">Filiais de destino + quantidade</div>' +
        '<textarea class="sol-ta" id="sol-ta" rows="6" placeholder="550 1\n350 2\n123 3"></textarea>' +
        '<div class="sol-hints" id="sol-hints"><span class="sol-hint">550 1</span><span class="sol-hint">350 2</span><span class="sol-hint">123 5</span></div>' +
      '</div>' +
      '<div class="sol-card">' +
        '<div class="sol-card-label">Configuracao</div>' +
        '<div class="sol-gemco-wrap" id="sol-gemco-wrap"><div class="sol-row"><input class="sol-inp" id="sol-gemco" placeholder="Gemco (ex: 2936932)"/></div></div>' +
        '<div class="sol-row">' +
          '<div class="sol-sel-wrap">' +
            '<select class="sol-sel" id="sol-origin"><option value="0038">Origem: CD38</option><option value="0991">Origem: CD991</option></select>' +
            '<span class="sol-sa">\u25BE</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="sol-btn sol-btn-run" id="sol-run">Iniciar Solicitacoes</button>' +
      '<button class="sol-btn sol-btn-stop" id="sol-stop">Parar</button>' +
      '<div class="sol-div"></div>' +
      '<div class="sol-st" id="sol-st">Pronto para iniciar.</div>' +
      '<div class="sol-pw" id="sol-pw"><div class="sol-pb" id="sol-pb"></div></div>' +
    '</div>' +
    '<div class="sol-log">' +
      '<div class="sol-lh" id="sol-lh"><span class="sol-ll">Logs <span class="sol-lcount" id="sol-lc">0</span></span><button class="sol-lclr" id="sol-lclr">limpar</button></div>' +
      '<div class="sol-lb" id="sol-lb"><div class="sol-le info">Aguardando...</div></div>' +
    '</div>';
  document.body.appendChild(root);

  const tab=document.createElement('button');
  tab.id='__sol_tab__';tab.textContent='SOL';
  document.body.appendChild(tab);

  const setM=w=>document.body.style.setProperty('margin-right',w,'important');
  setM('340px');document.body.style.transition='margin-right .28s';

  document.getElementById('sol-close').onclick=e=>{e.stopPropagation();root.classList.add('off');tab.style.display='flex';setM('0');};
  tab.onclick=()=>{root.classList.remove('off');tab.style.display='none';setM('340px');};

  let mini=false;
  document.getElementById('sol-min').onclick=e=>{
    e.stopPropagation();mini=!mini;
    root.querySelectorAll('.sols,.sol-log,.sol-tok').forEach(el=>el.style.display=mini?'none':'');
    root.style.height=mini?'52px':'100vh';setM(mini?'0':'340px');
    document.getElementById('sol-min').textContent=mini?'\u25A1':'\u2212';
  };

  // Toggle de modo
  function setModo(unico){
    document.getElementById('sol-modo-unico').classList.toggle('active',unico);
    document.getElementById('sol-modo-filial').classList.toggle('active',!unico);
    const gemcoWrap=document.getElementById('sol-gemco-wrap');
    gemcoWrap.style.display=unico?'':'none';
    const ta=document.getElementById('sol-ta');
    const hints=document.getElementById('sol-hints');
    if(unico){
      ta.placeholder='550 1\n350 2\n123 3';
      hints.innerHTML='<span class="sol-hint">550 1</span><span class="sol-hint">350 2</span><span class="sol-hint">123 5</span>';
    } else {
      ta.placeholder='550 1 2936932\n350 2 1234567\n123 3 9876543';
      hints.innerHTML='<span class="sol-hint">550 1 2936932</span><span class="sol-hint">350 2 1234567</span>';
    }
  }
  document.getElementById('sol-modo-unico').onclick=()=>setModo(true);
  document.getElementById('sol-modo-filial').onclick=()=>setModo(false);

  document.getElementById('sol-run').onclick=start;
  document.getElementById('sol-stop').onclick=()=>{S.stop=true;setSt('Parando...');log('Interrompido.','warn');};

  let logOpen=true;
  document.getElementById('sol-lh').onclick=()=>{logOpen=!logOpen;document.getElementById('sol-lb').style.display=logOpen?'':'none';};
  document.getElementById('sol-lclr').onclick=e=>{e.stopPropagation();document.getElementById('sol-lb').innerHTML='';_lc=0;document.getElementById('sol-lc').textContent='0';};

  setInterval(uiToken,8000);
}

function uiToken(){
  const el=document.getElementById('sol-tok'),tx=document.getElementById('sol-tok-txt');
  if(!el||!tx)return;
  if(!getTok()){el.className='sol-tok w';tx.textContent='Aguardando token — faca qualquer acao no site';return;}
  if(_tokenSessaoExpirou){el.className='sol-tok w';tx.textContent='Sessao expirou — clique em qualquer menu';return;}
  const m=tokMins();
  if(m!==null&&m<2){el.className='sol-tok ex';tx.textContent='Token expirando em '+m+'min...';}
  else{el.className='sol-tok ok';tx.textContent=m!==null?'Token ativo - '+m+' min':'Token ativo';}
}

function setSt(t,on){const el=document.getElementById('sol-st');if(!el)return;el.textContent=t;el.className='sol-st'+(on!==false?' on':'');}
function setProg(p){const w=document.getElementById('sol-pw'),b=document.getElementById('sol-pb');if(!w||!b)return;if(p===null){w.classList.remove('on');return;}w.classList.add('on');b.style.width=p+'%';}
let _lc=0;
function log(msg,type){
  type=type||'info';
  const lb=document.getElementById('sol-lb');if(!lb)return;
  _lc++;const lc=document.getElementById('sol-lc');if(lc)lc.textContent=_lc;
  const t=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const d=document.createElement('div');d.className='sol-le '+type;
  d.textContent=t+'  '+msg;lb.appendChild(d);lb.scrollTop=lb.scrollHeight;
  if(lb.children.length>200)lb.removeChild(lb.children[0]);
}

function modal(cfg){
  return new Promise(function(res){
    const ov=document.createElement('div');ov.className='aa-ov';
    const m=document.createElement('div');m.className='aa-modal'+(cfg.wide?' '+cfg.wide:'');
    const ico=cfg.icone||(cfg.tipo==='err'?'⚠️':cfg.tipo==='ok'?'✅':'ℹ️');
    const tc=cfg.tipo==='err'?'#fca5a5':cfg.tipo==='ok'?'#86efac':cfg.tipo==='warn'?'#fcd34d':'#93c5fd';
    let h='<div class="aa-m-ico">'+ico+'</div><div class="aa-m-ttl" style="color:'+tc+'">'+cfg.titulo+'</div>';
    if(cfg.mensagem)h+='<div class="aa-m-msg">'+cfg.mensagem+'</div>';
    if(cfg.html)h+=cfg.html;
    h+='<div class="aa-m-btns">';
    (cfg.btns||[]).forEach(function(b){h+='<button class="aa-mb '+(b.cls||'s')+'" data-v="'+b.v+'">'+b.t+'</button>';});
    h+='</div>';
    m.innerHTML=h;ov.appendChild(m);document.body.appendChild(ov);
    m.querySelectorAll('[data-v]').forEach(function(btn){btn.addEventListener('click',function(){ov.remove();res(btn.dataset.v);});});
    ov.addEventListener('click',function(e){if(e.target===ov){ov.remove();res(null);}});
  });
}

function parseFiliais(text,modoGemcoPorFilial){
  const result=[];
  text.split('\n').forEach(function(line){
    line=line.trim();if(!line||line.startsWith('#'))return;
    if(modoGemcoPorFilial){
      // Formato esperado: FILIAL QTD GEMCO
      const m=line.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
      if(m){result.push({filial:m[1],filialPad:pad(m[1]),qtd:parseInt(m[2]),gemco:m[3]});return;}
      // Aceita também com qtd=1 implícita: FILIAL GEMCO (2 tokens onde 2º tem 5+ dígitos)
      const m2=line.match(/^(\d+)\s+(\d{5,})$/);
      if(m2){result.push({filial:m2[1],filialPad:pad(m2[1]),qtd:1,gemco:m2[2]});return;}
    } else {
      // Formato: FILIAL QTD  (sem x)
      const m=line.match(/^(\d+)\s+(\d+)$/);
      if(m){result.push({filial:m[1],filialPad:pad(m[1]),qtd:parseInt(m[2])});return;}
      // Só filial (qtd=1)
      const m2=line.match(/^(\d+)$/);
      if(m2){result.push({filial:m2[1],filialPad:pad(m2[1]),qtd:1});}
    }
  });
  return result;
}

async function start(){
  const raw=document.getElementById('sol-ta').value||'';
  const origin=document.getElementById('sol-origin').value||'0038';
  const modoUnico=document.getElementById('sol-modo-unico').classList.contains('active');
  const modoPorFilial=!modoUnico;

  const jobs=parseFiliais(raw,modoPorFilial);

  let gemcoUnico='';
  if(modoUnico){
    gemcoUnico=(document.getElementById('sol-gemco').value||'').trim();
    if(!gemcoUnico){await modal({tipo:'err',icone:'🔍',titulo:'Gemco nao informado',mensagem:'Informe o codigo Gemco do produto.',btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  }

  if(!getTok()){await modal({tipo:'err',icone:'🔐',titulo:'Token nao capturado',mensagem:'Faca qualquer acao no site primeiro.',btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  if(!jobs.length){
    const exemplo=modoPorFilial?'550 1 2936932\n350 2 1234567':'550 1\n350 2';
    await modal({tipo:'err',icone:'📝',titulo:'Nenhuma filial',mensagem:'Informe ao menos uma filial:\n'+exemplo,btns:[{t:'Ok',v:'ok',cls:'p'}]});return;
  }
  if(modoPorFilial){
    const semGemco=jobs.filter(j=>!j.gemco);
    if(semGemco.length){await modal({tipo:'err',icone:'🔍',titulo:'Gemco ausente',mensagem:'As linhas abaixo estao sem Gemco:\n'+semGemco.map(j=>'Filial '+j.filial).join('\n'),btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  }

  const gemcoResumo=modoUnico?gemcoUnico:jobs.map(j=>j.gemco).filter((v,i,a)=>a.indexOf(v)===i).join(', ');
  const preview=jobs.slice(0,5).map(function(j){return '- CD'+j.filial+' x'+j.qtd+(modoPorFilial?' ('+j.gemco+')':'');}).join('\n')+(jobs.length>5?'\n... e mais '+(jobs.length-5):'');
  const conf=await modal({icone:'📤',tipo:'info',titulo:'Confirmar Solicitacoes',mensagem:'Gemco: '+gemcoResumo+'\nOrigem: CD'+norm(origin)+'\nFiliais ('+jobs.length+'):\n'+preview,btns:[{t:'Cancelar',v:'n',cls:'d'},{t:'Iniciar',v:'s',cls:'p'}]});
  if(conf!=='s')return;

  Object.assign(S,{running:true,stop:false,results:[],startTime:Date.now()});
  document.getElementById('sol-run').style.display='none';
  document.getElementById('sol-stop').style.display='flex';
  setProg(5);log('Iniciando '+jobs.length+' solicitacoes - '+(modoUnico?'Gemco '+gemcoUnico:'Gemco por filial'),'info');

  for(let i=0;i<jobs.length;i++){
    if(S.stop)break;
    const job=jobs[i];
    const gemco=modoUnico?gemcoUnico:job.gemco;
    setSt('Solicitacao '+(i+1)+'/'+jobs.length+' - Filial '+job.filial);
    setProg(5+Math.round(i/jobs.length*88));
    log('Filial '+job.filial+' x'+job.qtd+' Gemco '+gemco+'...','info');
    try{
      const criada=await req('POST','/v1/solicitations/branch',{origin:'',destiny:job.filialPad,receivingBranch:{code:'',complement:'',number:'',postalCode:'',publicPlace:''},observation:''});
      if(!criada||!criada.solicitationId)throw new Error('API nao retornou solicitationId');
      const solId=criada.solicitationId;
      await req('POST','/v1/solicitations/branch/'+solId+'/asset',{assets:[{itemCode:gemco,amount:job.qtd}]});
      await req('PATCH','/v1/solicitations/branch/'+solId,{observation:'',origin:origin,status:'CREATED'});
      S.results.push({filial:job.filial,qtd:job.qtd,gemco:gemco,solId:solId,status:'ok'});
      log('OK Filial '+job.filial+' - Sol #'+solId,'ok');
    }catch(e){
      S.results.push({filial:job.filial,qtd:job.qtd,gemco:gemco,solId:null,status:'fail',motivo:e.message});
      log('ERRO Filial '+job.filial+': '+e.message,'err');
      const d=await modal({tipo:'err',titulo:'Erro - Filial '+job.filial,mensagem:e.message+'\n\nO que deseja fazer?',btns:[{t:'Parar',v:'stop',cls:'d'},{t:'Pular',v:'skip',cls:'s'},{t:'Tentar novamente',v:'retry',cls:'p'}]});
      if(d==='stop'){S.stop=true;break;}
      if(d==='retry'){i--;continue;}
    }
    await sleep(600);
  }

  S.running=false;
  document.getElementById('sol-run').style.display='flex';
  document.getElementById('sol-stop').style.display='none';
  setProg(100);setTimeout(function(){setProg(null);},600);
  setSt(S.stop?'Interrompido.':'Processo finalizado!',false);
  await modalResultado(gemcoUnico,origin,modoPorFilial);
}

async function modalResultado(gemcoUnico,origin,modoPorFilial){
  const oks=S.results.filter(function(r){return r.status==='ok';});
  const fails=S.results.filter(function(r){return r.status==='fail';});
  const mostrarGemcoCol=modoPorFilial;
  const thGemco=mostrarGemcoCol?'<th>Gemco</th>':'';
  let tab='<table class="aa-rtable"><thead><tr><th>Filial</th><th>Qtd</th>'+thGemco+'<th>Sol.</th><th>Status</th></tr></thead><tbody>';
  [...oks,...fails].forEach(function(r){
    const tdGemco=mostrarGemcoCol?'<td style="font-size:10px">'+r.gemco+'</td>':'';
    tab+='<tr class="'+(r.status==='ok'?'ok':'fail')+'"><td><strong>'+r.filial+'</strong></td><td>x'+r.qtd+'</td>'+tdGemco+'<td style="font-size:10px">'+(r.solId||'-')+'</td><td>'+(r.status==='ok'?'<span class="tag-ok">OK</span>':'<span class="tag-fail">Falhou</span>')+'</td></tr>';
    if(r.status==='fail')tab+='<tr class="fail"><td colspan="'+(mostrarGemcoCol?5:4)+'" style="font-size:9.5px;color:#fca5a5;padding:2px 8px 6px">'+r.motivo+'</td></tr>';
  });
  tab+='</tbody></table>';
  const gemcoResumoLabel=modoPorFilial?'(por filial)':gemcoUnico;
  const v=await modal({
    icone:fails.length===0?'🎉':'⚠️',
    titulo:fails.length===0?'Todas criadas!':'Concluido com erros',
    tipo:fails.length===0?'ok':'warn',
    wide:'aa-res-modal',
    html:'<div class="aa-res-sum">'+
      '<div class="aa-res-cell"><div class="aa-res-val" style="color:#93c5fd">'+S.results.length+'</div><div class="aa-res-lbl">Total</div></div>'+
      '<div class="aa-res-cell"><div class="aa-res-val" style="color:var(--green)">'+oks.length+'</div><div class="aa-res-lbl">OK</div></div>'+
      '<div class="aa-res-cell"><div class="aa-res-val" style="color:'+(fails.length?'var(--red)':'var(--green)')+'">'+fails.length+'</div><div class="aa-res-lbl">Falhas</div></div>'+
      '</div>'+
      '<div style="font-size:10.5px;color:var(--t3);text-align:center;margin-bottom:10px">Gemco: '+gemcoResumoLabel+' - Origem: CD'+norm(origin)+'</div>'+
      '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--b1);border-radius:8px;margin-bottom:12px;">'+tab+'</div>',
    btns:[{t:'Copiar',v:'copy',cls:'s'},{t:'Fechar',v:'close',cls:'p'}]
  });
  if(v==='copy'){
    const lines=['SOLICITACOES - '+new Date().toLocaleString('pt-BR'),'Gemco: '+gemcoResumoLabel+' Origem: CD'+norm(origin),'Total: '+S.results.length+' OK: '+oks.length+' Falhas: '+fails.length,''];
    S.results.forEach(function(r){lines.push(r.status==='ok'?'OK '+r.filial+' x'+r.qtd+' Gemco:'+r.gemco+' Sol#'+r.solId:'ERRO '+r.filial+' x'+r.qtd+' Gemco:'+r.gemco+' '+r.motivo);});
    navigator.clipboard.writeText(lines.join('\n'));
  }
}

// ═══ INIT ════════════════════════════════════════════
injectCSS();
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(buildPanel,600);});}
else{setTimeout(buildPanel,600);}
syncTok();

})();
