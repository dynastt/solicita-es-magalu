(function(){
'use strict';
if(document.getElementById('__sol__')) return;

// ═══ TOKEN ════════════════════════════════════════════
let _tok=null,_tokTs=0,_tokExp=null;
let _tokenRenovando=false;
let _tokenSessaoExpirou=false;
let _tokenUltimoErro=0;
let _userName=null;

function extractUserFromToken(token){
  try{
    const p=(token||'').replace('Bearer ','').split('.');
    if(p.length!==3)return null;
    const pl=JSON.parse(atob(p[1]));
    if(pl.exp)_tokExp=pl.exp*1000;
    return pl.name||pl.nome||pl.given_name||pl.preferred_username||pl.sub||pl.email||null;
  }catch{return null;}
}

const NOMES_ACENTOS={
  'joao':'João','jose':'José','maria':'Maria','antonio':'Antônio',
  'marcos':'Marcos','ana':'Ana','paulo':'Paulo','sebastiao':'Sebastião',
  'fabricio':'Fabrício','vinicius':'Vinícius','vitor':'Vítor',
  'vitoria':'Vitória','patricia':'Patrícia','leticia':'Letícia','lucio':'Lúcio',
  'ines':'Inês','helia':'Hélia','beatriz':'Beatriz','regis':'Régis',
  'sergio':'Sérgio','monica':'Mônica','andreia':'Andréia','everton':'Éverton',
  'emerson':'Émerson','edson':'Édson','gabriel':'Gabriel','henrique':'Henrique',
  'guilherme':'Guilherme','caio':'Caio','julio':'Júlio','celia':'Célia',
  'valeria':'Valéria','debora':'Débora','barbara':'Bárbara','claudia':'Cláudia',
  'flavio':'Flávio','marcio':'Márcio','luciana':'Luciana','cesar':'César',
  'eugenio':'Eugênio','rodrigo':'Rodrigo','cristiano':'Cristiano'
};
function accentuateName(r){if(!r)return r;return NOMES_ACENTOS[r.toLowerCase()]||r.charAt(0).toUpperCase()+r.slice(1);}
function getFriendlyName(raw){
  if(!raw)return null;
  if(raw.includes('@'))raw=raw.split('@')[0];
  return accentuateName(raw.split(/[\s._-]/)[0]);
}

(function(){
  const origFetch=window.fetch;
  window.fetch=function(input,init){
    init=init||{};const h=init.headers||{};
    const auth=h.Authorization||h.authorization||'';
    if(auth){
      const full=auth.startsWith('Bearer ')?auth:'Bearer '+auth;
      if(full!==_tok){
        _tok=full;_tokTs=Date.now();window.__MGT__=_tok;window.__MGTS__=_tokTs;
        _tokenSessaoExpirou=false;_tokenUltimoErro=0;
        const u=extractUserFromToken(full);
        if(u){_userName=getFriendlyName(u);updateWelcome();}
        uiToken();
      }
    }
    return origFetch.apply(this,arguments);
  };
  const origSet=XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader=function(k,v){
    if(k.toLowerCase()==='authorization'&&v){
      const full=v.startsWith('Bearer ')?v:'Bearer '+v;
      if(full!==_tok){
        _tok=full;_tokTs=Date.now();window.__MGT__=_tok;window.__MGTS__=_tokTs;
        _tokenSessaoExpirou=false;_tokenUltimoErro=0;
        const u=extractUserFromToken(full);
        if(u){_userName=getFriendlyName(u);updateWelcome();}
        uiToken();
      }
    }
    return origSet.apply(this,arguments);
  };
})();

function syncTok(){
  const t=window.__MGT__;
  if(t&&t!==_tok){
    _tok=t;_tokTs=window.__MGTS__||Date.now();
    if(_tokenSessaoExpirou){_tokenSessaoExpirou=false;_tokenUltimoErro=0;log('Sessão restaurada ✓','ok');}
    const u=extractUserFromToken(t);
    if(u){_userName=getFriendlyName(u);updateWelcome();}
    uiToken();
  }
}
window.addEventListener('__mgt__',e=>{
  _tok=e.detail;_tokTs=Date.now();_tokenSessaoExpirou=false;_tokenUltimoErro=0;
  const u=extractUserFromToken(e.detail);
  if(u){_userName=getFriendlyName(u);updateWelcome();}
  uiToken();
});
setInterval(syncTok,800);
function getTok(){return _tok;}
function tokMins(){
  try{const p=(_tok||'').replace('Bearer ','').split('.');if(p.length!==3)return null;
  const pl=JSON.parse(atob(p[1]));return pl.exp?Math.round((pl.exp*1000-Date.now())/60000):null;}
  catch{return null;}
}
// segundos restantes com precisão
function tokSecs(){
  try{const p=(_tok||'').replace('Bearer ','').split('.');if(p.length!==3)return null;
  const pl=JSON.parse(atob(p[1]));return pl.exp?Math.round((pl.exp*1000-Date.now())/1000):null;}
  catch{return null;}
}

function updateWelcome(){
  const el=document.getElementById('sol-welcome-name');
  if(el&&_userName){
    el.textContent=_userName;
    const av=document.getElementById('sol-welcome-av');
    if(av)av.textContent=_userName[0].toUpperCase();
  }
  const toast=document.getElementById('sol-welcome-toast');
  if(toast&&!toast.dataset.shown&&_userName){
    toast.dataset.shown='1';
    const tn=document.getElementById('sol-toast-name');
    if(tn)tn.textContent=_userName;
    toast.classList.add('show');
    setTimeout(()=>toast.classList.add('hide'),3200);
    setTimeout(()=>toast.remove(),3800);
  }
}

async function _renovarTokenSilencioso(){
  if(_tokenRenovando)return false;
  if(_tokenSessaoExpirou&&Date.now()-_tokenUltimoErro<5*60*1000)return false;
  _tokenRenovando=true;
  try{
    const code=await new Promise((resolve,reject)=>{
      const state=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
      const iframe=document.createElement('iframe');
      iframe.style.cssText='display:none;position:fixed;top:-9999px;';
      document.body.appendChild(iframe);
      const timeout=setTimeout(()=>{try{document.body.removeChild(iframe);}catch(_){}reject(new Error('Timeout'));},20000);
      const monitor=setInterval(()=>{
        try{
          const url=iframe.contentWindow.location.href;
          if(url.includes('baap-sso-login')||url.includes('/login')){
            clearInterval(monitor);clearTimeout(timeout);
            try{document.body.removeChild(iframe);}catch(_){}
            reject(new Error('SESSAO_EXPIROU'));return;
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
      _tokTs=Date.now();window.__MGT__=_tok;window.__MGTS__=_tokTs;
      _tokenSessaoExpirou=false;_tokenUltimoErro=0;uiToken();
      log('Token renovado automaticamente ✓','ok');return true;
    }
  }catch(e){
    if(e.message==='SESSAO_EXPIROU'){
      if(!_tokenSessaoExpirou)log('Sessão expirou — clique em qualquer menu do portal para restaurar','warn');
      _tokenSessaoExpirou=true;_tokenUltimoErro=Date.now();
    }else{
      _tokenRenovando=false;
      const retry=await _renovarTokenSilencioso();
      if(!retry)_tokenUltimoErro=Date.now();
      return retry;
    }
  }finally{_tokenRenovando=false;}
  return false;
}
async function ensureToken(){const s=tokSecs();if(_tok&&s!==null&&s<120)await _renovarTokenSilencioso();}
setInterval(async()=>{const s=tokSecs();if(_tok&&s!==null&&s<=60)await _renovarTokenSilencioso();},15000);

// ═══ HELPERS ══════════════════════════════════════════
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad=(c,n=4)=>String(c).padStart(n,'0');
const norm=c=>(c||'').toString().replace(/\D/g,'').replace(/^0+/,'');

// ═══ STATE ════════════════════════════════════════════
const API='https://gestao-ativos-api.magazineluiza.com.br';
const S={running:false,stop:false,results:[],startTime:null};

// ═══ API ══════════════════════════════════════════════
async function _refreshOn401(){log('Token 401 - renovando...','warn');await _renovarTokenSilencioso();}
async function req(method,ep,body,retry){
  retry=retry||0;await ensureToken();
  const auth=getTok();if(!auth)throw new Error('Token nao capturado.');
  const opts={method,headers:{'Content-Type':'application/json','Authorization':auth}};
  if(body)opts.body=JSON.stringify(body);
  const res=await fetch(API+ep,opts);
  if(res.status>=200&&res.status<300){const t=await res.text();try{return JSON.parse(t);}catch{return t;}}
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
  s.textContent=`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  /* MELHORIA 7: tons mais escuros para contrastar com o portal branco */
  --mg-bg:       #b8bcc8;
  --mg-panel:    #c8ccd8;
  --mg-s1:       #bfc3cf;
  --mg-s2:       #b2b7c4;
  --mg-s3:       #a6abb9;
  --mg-s4:       #9ba0af;
  --mg-b1:       rgba(0,0,0,0.13);
  --mg-b2:       rgba(0,0,0,0.20);
  --mg-t1:       #0f1120;
  --mg-t2:       #3a4060;
  --mg-t3:       #6b7290;
  --mg-blue:     #0078e6;
  --mg-blue2:    #005bbf;
  --mg-grad:     linear-gradient(90deg,#f5a623 0%,#e8384f 22%,#c026d3 45%,#7c3aed 62%,#0078e6 78%,#00c896 100%);
  --mg-green:    #16a34a;
  --mg-green-lt: rgba(22,163,74,0.15);
  --mg-red:      #dc2626;
  --mg-red-lt:   rgba(220,38,38,0.10);
  --mg-orange:   #d97706;
  --mg-shadow:   0 2px 12px rgba(0,0,0,0.15);
  --mg-shadow-lg:0 12px 48px rgba(0,0,0,0.25),0 2px 8px rgba(0,0,0,0.12);
  --mg-radius:   14px;
  --mg-font:     'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --mg-mono:     'JetBrains Mono',monospace;
}

#__sol__ *,#__sol__ *::before,#__sol__ *::after{box-sizing:border-box;}
#__sol__ ::-webkit-scrollbar{width:4px;}
#__sol__ ::-webkit-scrollbar-track{background:transparent;}
#__sol__ ::-webkit-scrollbar-thumb{background:var(--mg-s3);border-radius:10px;}

/* ═══ PANEL ═══ */
#__sol__{
  position:fixed;top:20px;right:20px;
  width:380px;
  height:auto;
  max-height:calc(100vh - 40px);
  background:var(--mg-panel);
  border:1px solid var(--mg-b1);border-radius:16px;
  font-family:var(--mg-font);color:var(--mg-t1);
  z-index:2147483646;
  display:flex;flex-direction:column;
  box-shadow:var(--mg-shadow-lg);
  overflow:hidden;
  will-change:max-height;
  transition:max-height .34s cubic-bezier(.4,0,.2,1),
             opacity .28s ease,
             transform .28s cubic-bezier(.4,0,.2,1);
}
#__sol__.off{opacity:0;pointer-events:none;transform:scale(0.96) translateY(8px);}
/* Fix 1: barinha RGB fica DENTRO do border-radius */
#__sol__::before{
  content:'';position:absolute;top:0;left:0;right:0;height:3px;
  background:var(--mg-grad);z-index:5;
  border-radius:16px 16px 0 0;
  /* clip garante que não vaza para fora */
  overflow:hidden;
}

/* MINIMIZED — pill compacta, sem cortar nada */
#__sol__.minimized{
  max-height:64px !important;
  border-radius:26px !important;
}
/* esconde tudo menos header */
#__sol__.minimized .sol-body,
#__sol__.minimized .sol-log-section,
#__sol__.minimized .sol-tok-bar,
#__sol__.minimized .sol-welcome-inline{opacity:0;pointer-events:none;}
/* header vira pill: sem borda inferior, borda arredondada completa */
#__sol__.minimized .sol-header{
  border-bottom:none !important;
  border-radius:26px !important;
}
/* transições suaves */
#__sol__ .sol-body,
#__sol__ .sol-log-section,
#__sol__ .sol-tok-bar,
#__sol__ .sol-welcome-inline{
  transition:opacity .18s ease;
  will-change:opacity;
}
#__sol__::before{transition:none;}
#__sol_tab__{
  position:fixed;bottom:24px;right:24px;width:48px;height:48px;
  background:var(--mg-blue);border:none;border-radius:50%;
  cursor:pointer;z-index:2147483645;display:none;
  align-items:center;justify-content:center;
  box-shadow:0 4px 20px rgba(0,120,230,0.38);
  transition:transform .22s cubic-bezier(.4,0,.2,1),box-shadow .22s;color:#fff;font-size:18px;
}
#__sol_tab__:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(0,120,230,0.52);}
/* pulsa ao ser exibido pelo fechar */
@keyframes tab-pop{
  0%{transform:scale(0.5);opacity:0;}
  55%{transform:scale(1.35);opacity:1;}
  75%{transform:scale(0.92);}
  100%{transform:scale(1);}
}
#__sol_tab__.popping{animation:tab-pop 1.1s cubic-bezier(.34,1.56,.64,1) forwards;}

/* ═══ HEADER SPINNER — Uiverse.io by satyamchaudharydev (exato, só prefixado) ═══ */
.sol-spinner-wrap{
  width:32px;height:32px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;
}
.sol-spinner{
  position:relative;
  width:60px;height:60px;
  display:flex;justify-content:center;align-items:center;
  border-radius:50%;
  transform:translateX(-38px) scale(0.55);
}
.sol-spinner span{
  position:absolute;
  top:50%;
  left:var(--sol-left);
  width:35px;height:7px;
  background:var(--mg-blue);
  animation:sol-dominos 1s ease infinite;
  box-shadow:2px 2px 3px 0px rgba(0,0,0,0.3);
}
.sol-spinner span:nth-child(1){--sol-left:80px;animation-delay:0.125s;}
.sol-spinner span:nth-child(2){--sol-left:70px;animation-delay:0.3s;}
.sol-spinner span:nth-child(3){left:60px;animation-delay:0.425s;}
.sol-spinner span:nth-child(4){animation-delay:0.54s;left:50px;}
.sol-spinner span:nth-child(5){animation-delay:0.665s;left:40px;}
.sol-spinner span:nth-child(6){animation-delay:0.79s;left:30px;}
.sol-spinner span:nth-child(7){animation-delay:0.915s;left:20px;}
.sol-spinner span:nth-child(8){left:10px;}
@keyframes sol-dominos{
  50%{opacity:0.7;}
  75%{transform:rotate(90deg);}
  80%{opacity:1;}
}

/* ═══ HEADER — estrutura com spinner ═══ */
.sol-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 16px;border-bottom:1px solid var(--mg-b1);
  flex-shrink:0;cursor:grab;user-select:none;
  border-radius:16px 16px 0 0;
  position:relative;
  background:
    radial-gradient(ellipse at 0% 0%, rgba(0,120,230,0.07) 0%, transparent 60%),
    radial-gradient(ellipse at 100% 100%, rgba(0,200,150,0.05) 0%, transparent 55%),
    var(--mg-panel);
}
.sol-header:active{cursor:grabbing;}
.sol-header-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0;}

/* Fix 3: logo vai para dentro do bloco de texto, abaixo do título */
.sol-magalu-logo{
  display:flex;flex-direction:column;align-items:flex-start;
  flex-shrink:0;line-height:1;
}
.sol-magalu-logo svg{display:block;}
.sol-logo-bar{height:3px;border-radius:2px;background:var(--mg-grad);}

.sol-header-info{display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:0;}
.sol-header-title-row{display:flex;align-items:center;gap:6px;}
.sol-header-title{font-size:15px;font-weight:700;letter-spacing:-0.2px;color:var(--mg-t1);line-height:1.2;white-space:nowrap;}
/* Fix gear: CSS-drawn spinning gear, sempre visivel */
.sol-header-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;flex-shrink:0;
}
.sol-header-icon svg{
  animation:hdr-spin 4s linear infinite;
  transform-origin:center;
}
@keyframes hdr-spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}
.sol-header-sub{font-size:10px;color:var(--mg-t3);font-weight:500;line-height:1;}
.sol-header-btns{display:flex;gap:3px;margin-left:8px;flex-shrink:0;}
.sol-hbtn{
  background:none;border:none;color:var(--mg-t3);cursor:pointer;
  width:30px;height:30px;border-radius:7px;
  display:flex;align-items:center;justify-content:center;
  font-size:14px;transition:all .18s;font-weight:600;
}
.sol-hbtn:hover{background:var(--mg-s2);color:var(--mg-t1);}
.sol-hbtn.close-btn:hover{background:var(--mg-red-lt);color:var(--mg-red);}

/* ícone minimizar — linha e quadrado feitos em CSS puro */
#sol-min{position:relative;}
#sol-min::before,#sol-min::after{
  content:'';position:absolute;left:50%;top:50%;
  border-radius:2px;
  transition:all .18s ease;
}
/* estado open: traço horizontal (minimizar) */
#sol-min[data-state='open']::before{
  width:10px;height:2px;
  background:currentColor;
  transform:translate(-50%,-50%);
}
#sol-min[data-state='open']::after{display:none;}
/* estado closed: quadrado (restaurar) */
#sol-min[data-state='closed']::before{
  width:9px;height:9px;
  background:transparent;
  border:1.8px solid currentColor;
  border-radius:2px;
  transform:translate(-50%,-50%);
}
#sol-min[data-state='closed']::after{display:none;}

/* ═══ WELCOME INLINE ═══ */
.sol-welcome-inline{
  padding:9px 16px;display:flex;align-items:center;gap:10px;
  border-bottom:1px solid var(--mg-b1);flex-shrink:0;background:var(--mg-s1);
}
.sol-welcome-av{
  width:32px;height:32px;border-radius:50%;background:var(--mg-blue);
  display:flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:700;color:#fff;flex-shrink:0;
}
.sol-welcome-txt{font-size:13px;color:var(--mg-t2);font-weight:500;}
.sol-welcome-name{font-weight:700;font-size:13px;color:var(--mg-blue);}
.sol-welcome-sub{font-size:10px;color:var(--mg-t3);margin-top:1px;}

/* ═══ WELCOME TOAST ═══ */
@keyframes toast-enter{
  0%{opacity:0;transform:translate(-50%,-50%) scale(0.82) translateY(24px);}
  65%{opacity:1;transform:translate(-50%,-50%) scale(1.04) translateY(-4px);}
  100%{opacity:1;transform:translate(-50%,-50%) scale(1) translateY(0);}
}
@keyframes toast-exit{
  0%{opacity:1;transform:translate(-50%,-50%) scale(1);}
  100%{opacity:0;transform:translate(-50%,-50%) scale(0.94) translateY(-20px);}
}
.sol-welcome-toast{
  position:fixed;top:50%;left:50%;
  transform:translate(-50%,-50%) scale(0.82) translateY(24px);
  background:var(--mg-panel);border:1px solid var(--mg-b1);
  border-radius:20px;padding:28px 44px;text-align:center;
  z-index:2147483647;opacity:0;pointer-events:none;
  box-shadow:var(--mg-shadow-lg);overflow:hidden;
  /* sem transition — usamos animation pra controle total */
}
.sol-welcome-toast::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--mg-grad);}
.sol-welcome-toast.show{
  animation:toast-enter .55s cubic-bezier(.34,1.56,.64,1) forwards;
}
.sol-welcome-toast.hide{
  animation:toast-exit .4s ease-in forwards;
}
.sol-toast-greeting{font-size:13px;color:var(--mg-t2);margin-bottom:4px;font-weight:500;}
.sol-toast-name{font-size:26px;font-weight:800;color:var(--mg-blue);letter-spacing:-0.5px;}
.sol-toast-brand{font-size:10px;color:var(--mg-t3);margin-top:8px;letter-spacing:1px;font-weight:600;}
.sol-toast-logo{margin:10px auto 0;display:flex;flex-direction:column;align-items:center;gap:3px;}

/* ═══ TOKEN BAR ═══ */
.sol-tok-bar{
  display:flex;align-items:center;gap:8px;
  padding:7px 16px;font-size:11.5px;
  border-bottom:1px solid var(--mg-b1);flex-shrink:0;
  background:var(--mg-s1);font-weight:600;
  transition:color .3s;
}
.sol-tok-dot{
  width:8px;height:8px;border-radius:50%;flex-shrink:0;
  transition:background .3s,box-shadow .3s;
}
.sol-tok-label{flex-shrink:0;white-space:nowrap;font-size:11px;}
.sol-tok-track{
  flex:1;height:4px;background:var(--mg-s3);border-radius:4px;
  overflow:hidden;min-width:30px;
}
.sol-tok-fill{
  height:100%;border-radius:4px;width:100%;
  transition:width 1s linear, background-color .4s;
}
/* States */
.sol-tok-bar.ok .sol-tok-dot{background:var(--mg-green);box-shadow:0 0 0 3px rgba(22,163,74,0.22);}
.sol-tok-bar.ok .sol-tok-fill{background:var(--mg-green);}
.sol-tok-bar.ok{color:var(--mg-t2);}
.sol-tok-bar.w .sol-tok-dot{background:var(--mg-orange);animation:tok-blink 1.2s infinite;}
.sol-tok-bar.w .sol-tok-fill{background:var(--mg-orange);}
.sol-tok-bar.w{color:var(--mg-orange);}
.sol-tok-bar.ex .sol-tok-dot{background:var(--mg-red);animation:tok-blink .7s infinite;}
.sol-tok-bar.ex .sol-tok-fill{background:var(--mg-red);}
.sol-tok-bar.ex{color:var(--mg-red);}
@keyframes tok-blink{0%,100%{opacity:1}50%{opacity:.15}}

/* ═══ BODY — MELHORIA 5: mais compacto ═══ */
.sol-body{
  flex:1;overflow-y:auto;padding:10px 12px;
  display:flex;flex-direction:column;gap:9px;
  background:var(--mg-bg);
}

/* ═══ CARDS ═══ */
.sol-card{
  background:var(--mg-panel);border:1px solid var(--mg-b1);
  border-radius:11px;padding:11px 13px;
  transition:border-color .2s,box-shadow .2s;
  box-shadow:0 1px 3px rgba(0,0,0,0.08);
}
.sol-card:hover{border-color:var(--mg-b2);box-shadow:0 2px 10px rgba(0,0,0,0.12);}
.sol-card-label{font-size:10.5px;font-weight:700;color:var(--mg-t3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;}

/* ═══ SELETOR MODO ═══ */
.sol-modo-selector{
  position:relative;display:flex;flex-wrap:wrap;
  border-radius:7px;background:var(--mg-s2);
  box-shadow:0 0 0 1px rgba(0,0,0,0.08);
  padding:3px;margin-bottom:10px;
}
.sol-modo-radio{flex:1 1 auto;text-align:center;}
.sol-modo-radio input{display:none;}
.sol-modo-radio .sol-modo-name{
  display:flex;cursor:pointer;align-items:center;justify-content:center;
  border-radius:5px;border:none;padding:7px 0;
  font-size:11.5px;font-weight:500;color:var(--mg-t2);
  font-family:var(--mg-font);
  transition:all .15s ease-in-out;
}
.sol-modo-radio input:checked + .sol-modo-name{
  background:rgba(255,255,255,0.7);font-weight:700;color:var(--mg-blue);
  box-shadow:0 1px 6px rgba(0,0,0,0.12);
  position:relative;
  animation:modo-select .3s ease;
}
.sol-modo-radio:hover .sol-modo-name{background:rgba(255,255,255,0.35);}
@keyframes modo-select{0%{transform:scale(0.95);}50%{transform:scale(1.05);}100%{transform:scale(1);}}
.sol-modo-radio input:checked + .sol-modo-name::before,
.sol-modo-radio input:checked + .sol-modo-name::after{
  content:"";position:absolute;width:4px;height:4px;
  border-radius:50%;background:var(--mg-blue);opacity:0;
  animation:modo-particles .5s ease forwards;
}
.sol-modo-radio input:checked + .sol-modo-name::before{top:-8px;left:50%;transform:translateX(-50%);--direction:-10px;}
.sol-modo-radio input:checked + .sol-modo-name::after{bottom:-8px;left:50%;transform:translateX(-50%);--direction:10px;}
@keyframes modo-particles{0%{opacity:0;transform:translateX(-50%) translateY(0);}50%{opacity:1;}100%{opacity:0;transform:translateX(-50%) translateY(var(--direction));}}

/* ═══ GEMCO DESC — compacto ═══ */
.sol-gemco-desc{
  background:rgba(0,120,230,0.08);
  border:1px solid rgba(0,120,230,0.14);
  border-radius:8px;padding:9px 12px;margin-bottom:8px;
  font-size:11.5px;color:var(--mg-t2);line-height:1.6;
}
.sol-gemco-desc strong{color:var(--mg-blue);font-weight:700;}
.sol-gemco-example{
  display:inline-block;margin-top:4px;font-family:var(--mg-mono);font-size:11px;
  background:var(--mg-panel);border:1px solid rgba(0,120,230,0.2);
  border-radius:5px;padding:3px 9px;color:var(--mg-t1);
}

/* ═══ TEXTAREA ═══ */
.sol-ta{
  width:100%;background:var(--mg-s1);border:1.5px solid var(--mg-b1);border-radius:9px;
  color:var(--mg-t1);font-size:12.5px;font-family:var(--mg-mono);
  padding:9px 11px;box-sizing:border-box;resize:vertical;outline:none;line-height:1.7;
  transition:border-color .2s,box-shadow .2s,background .2s;
  min-height:70px;
}
.sol-ta:focus{border-color:var(--mg-blue);box-shadow:0 0 0 3px rgba(0,120,230,0.12);background:var(--mg-panel);}
.sol-ta::placeholder{color:var(--mg-t3);}
.sol-hints{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;}
.sol-hint{
  font-size:10.5px;color:var(--mg-t3);background:var(--mg-s2);border:1px solid var(--mg-b1);
  border-radius:5px;padding:3px 9px;font-family:var(--mg-mono);cursor:pointer;transition:all .18s;
}
.sol-hint:hover{border-color:var(--mg-blue);color:var(--mg-blue);background:rgba(0,120,230,0.1);}

/* ═══ INPUTS / SELECTS ═══ */
.sol-row{display:flex;gap:7px;margin-bottom:7px;}
.sol-row:last-child{margin-bottom:0;}
.sol-sel-wrap{flex:1;position:relative;}
.sol-sel{
  width:100%;background:var(--mg-s1);border:1.5px solid var(--mg-b1);
  border-radius:9px;color:var(--mg-t1);font-size:12.5px;
  padding:9px 30px 9px 12px;appearance:none;outline:none;cursor:pointer;
  font-family:var(--mg-font);font-weight:500;transition:border-color .2s,box-shadow .2s;
}
.sol-sel:focus{border-color:var(--mg-blue);box-shadow:0 0 0 3px rgba(0,120,230,0.12);}
.sol-sa{position:absolute;right:11px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--mg-t3);font-size:10px;}
.sol-inp{
  flex:1;background:var(--mg-s1);border:1.5px solid var(--mg-b1);
  border-radius:9px;color:var(--mg-t1);font-size:12.5px;
  font-family:var(--mg-mono);font-weight:500;
  padding:9px 12px;box-sizing:border-box;outline:none;
  transition:border-color .2s,box-shadow .2s;
}
.sol-inp:focus{border-color:var(--mg-blue);box-shadow:0 0 0 3px rgba(0,120,230,0.12);}
.sol-inp::placeholder{color:var(--mg-t3);}

/* ═══ BOTÃO INICIAR — MELHORIA 3: corrigido ═══ */
.sol-btn-run-wrap{
  position:relative;display:flex;justify-content:center;align-items:center;
  border:none;background:transparent;cursor:pointer;
  width:100%;padding:0;overflow:hidden;border-radius:999px;
  isolation:isolate;
}
.sol-btn-run-inner{
  position:relative;z-index:1;
  letter-spacing:1.5px;font-weight:700;font-size:13px;
  background:var(--mg-blue);border-radius:999px;
  color:white;padding:11px 20px;
  font-family:var(--mg-font);
  width:100%;text-align:center;
  display:flex;align-items:center;justify-content:center;gap:0;
  transition:background .22s, transform .15s, box-shadow .22s;
  box-shadow:0 2px 12px rgba(0,120,230,0.30);
}
.sol-btn-run-wrap:hover .sol-btn-run-inner{
  background:var(--mg-blue2);
  box-shadow:0 4px 18px rgba(0,120,230,0.42);
  transform:translateY(-1px);
}
.sol-btn-run-wrap:active .sol-btn-run-inner{transform:translateY(0);box-shadow:0 1px 6px rgba(0,120,230,0.22);}
/* seta aparece no hover */
.sol-btn-run-svg{
  width:0;overflow:hidden;opacity:0;
  transition:width .25s ease, opacity .25s ease, margin-left .25s ease;
  flex-shrink:0;display:inline-flex;vertical-align:middle;
}
.sol-btn-run-wrap:hover .sol-btn-run-svg{width:20px;opacity:1;margin-left:8px;}

/* ═══ BOTÃO PARAR ═══ */
.sol-stop-section{padding:0 12px 8px;flex-shrink:0;border-bottom:1px solid var(--mg-b1);display:none;}
.sol-stop-section.active{display:block;}
.sol-btn-stop-wrap{
  position:relative;border-radius:6px;width:100%;height:40px;
  cursor:pointer;display:none;align-items:center;
  border:1px solid #cc0000;background-color:#e50000;
  overflow:hidden;transition:all .3s;box-sizing:border-box;flex-shrink:0;
}
.sol-btn-stop-wrap .sol-stop-text{
  transform:translateX(30px);color:#fff;font-weight:600;font-size:11px;
  font-family:var(--mg-font);letter-spacing:1.5px;transition:all .3s;white-space:nowrap;
  flex:1;text-align:center;padding-right:40px;
}
.sol-btn-stop-wrap .sol-stop-icon{
  position:absolute;right:0;top:0;height:100%;width:36px;
  background-color:#cc0000;display:flex;align-items:center;justify-content:center;transition:all .3s;
}
.sol-btn-stop-wrap .sol-stop-icon .sol-stop-svg{width:18px;height:18px;}
.sol-btn-stop-wrap:hover{background:#cc0000;}
.sol-btn-stop-wrap:hover .sol-stop-text{color:transparent;}
.sol-btn-stop-wrap:hover .sol-stop-icon{width:100%;transform:translateX(0);}
.sol-btn-stop-wrap:active .sol-stop-icon{background-color:#b20000;}
.sol-btn-stop-wrap:active{border-color:#b20000;}

/* ═══ TYPEWRITER (Uiverse Nawsome — original) ═══ */
.sol-typewriter-wrap{display:none;flex-direction:column;align-items:center;gap:8px;padding:10px 0;}
.sol-typewriter-wrap.active{display:flex;}
.sol-typewriter{
  --blue:#5C86FF;--blue-dark:#275EFE;--key:#fff;
  --paper:#EEF0FD;--text:#D3D4EC;--tool:#FBC56C;--duration:3s;
  position:relative;
  animation:bounce05 var(--duration) linear infinite;
  transform-origin:center bottom;
}
.sol-typewriter .tw-slide{
  width:92px;height:20px;border-radius:3px;margin-left:14px;transform:translateX(14px);
  background:linear-gradient(var(--blue),var(--blue-dark));
  animation:slide05 var(--duration) ease infinite;
}
.sol-typewriter .tw-slide::before,.sol-typewriter .tw-slide::after,
.sol-typewriter .tw-slide i::before{content:"";position:absolute;background:var(--tool);}
.sol-typewriter .tw-slide::before{width:2px;height:8px;top:6px;left:100%;}
.sol-typewriter .tw-slide::after{left:94px;top:3px;height:14px;width:6px;border-radius:3px;}
.sol-typewriter .tw-slide i{display:block;position:absolute;right:100%;width:6px;height:4px;top:4px;background:var(--tool);}
.sol-typewriter .tw-slide i::before{right:100%;top:-2px;width:4px;border-radius:2px;height:14px;}
.sol-typewriter .tw-paper{
  position:absolute;left:24px;top:-26px;width:40px;height:46px;
  border-radius:5px;background:var(--paper);transform:translateY(46px);
  animation:paper05 var(--duration) linear infinite;
}
.sol-typewriter .tw-paper::before{
  content:"";position:absolute;left:6px;right:6px;top:7px;
  border-radius:2px;height:4px;transform:scaleY(0.8);background:var(--text);
  box-shadow:0 12px 0 var(--text),0 24px 0 var(--text),0 36px 0 var(--text);
}
.sol-typewriter .tw-keyboard{width:120px;height:56px;margin-top:-10px;z-index:1;position:relative;}
.sol-typewriter .tw-keyboard::before,.sol-typewriter .tw-keyboard::after{content:"";position:absolute;}
.sol-typewriter .tw-keyboard::before{
  top:0;left:0;right:0;bottom:0;border-radius:7px;
  background:linear-gradient(135deg,var(--blue),var(--blue-dark));
  transform:perspective(10px) rotateX(2deg);transform-origin:50% 100%;
}
.sol-typewriter .tw-keyboard::after{
  left:2px;top:25px;width:11px;height:4px;border-radius:2px;
  box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);
  animation:keyboard05 var(--duration) linear infinite;
}
/* word spinner (Uiverse kennyotsu) — adaptado ao tema */
.sol-tw-spinner{
  display:flex;align-items:center;justify-content:center;
  gap:0;
  font-size:11px;font-weight:600;color:var(--mg-t2);
  font-family:var(--mg-font);
  height:20px;overflow:hidden;
  width:100%;
}
.sol-tw-spinner-track{
  position:relative;overflow:hidden;height:20px;
  /* fade top/bottom */
  -webkit-mask-image:linear-gradient(transparent 0%,#000 20%,#000 80%,transparent 100%);
  mask-image:linear-gradient(transparent 0%,#000 20%,#000 80%,transparent 100%);
}
.sol-tw-word{
  display:block;height:20px;line-height:20px;
  padding-left:5px;color:var(--mg-blue);font-weight:700;
  animation:tw-spin 4s infinite;
}
@keyframes tw-spin{
  10%{transform:translateY(-102%);}
  25%{transform:translateY(-100%);}
  35%{transform:translateY(-202%);}
  50%{transform:translateY(-200%);}
  60%{transform:translateY(-302%);}
  75%{transform:translateY(-300%);}
  85%{transform:translateY(-402%);}
  100%{transform:translateY(-400%);}
}

@keyframes bounce05{85%,92%,100%{transform:translateY(0);}89%{transform:translateY(-4px);}95%{transform:translateY(2px);}}
@keyframes slide05{5%{transform:translateX(14px);}15%,30%{transform:translateX(6px);}40%,55%{transform:translateX(0);}65%,70%{transform:translateX(-4px);}80%,89%{transform:translateX(-12px);}100%{transform:translateX(14px);}}
@keyframes paper05{5%{transform:translateY(46px);}20%,30%{transform:translateY(34px);}40%,55%{transform:translateY(22px);}65%,70%{transform:translateY(10px);}80%,85%{transform:translateY(0);}92%,100%{transform:translateY(46px);}}
@keyframes keyboard05{
  5%,12%,21%,30%,39%,48%,57%,66%,75%,84%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  9%{box-shadow:15px 2px 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  18%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 2px 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  27%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 12px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  36%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 12px 0 var(--key),60px 12px 0 var(--key),68px 12px 0 var(--key),83px 10px 0 var(--key);}
  45%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 2px 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  54%{box-shadow:15px 0 0 var(--key),30px 2px 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  63%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 12px 0 var(--key);}
  72%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 2px 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
  81%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 12px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);}
}

/* ═══ STATUS / PROGRESS ═══ */
.sol-divider{height:1px;background:var(--mg-b1);margin:1px 0;}
.sol-status{font-size:11.5px;color:var(--mg-t3);text-align:center;padding:5px 0;min-height:24px;transition:color .3s;font-weight:500;}
.sol-status.on{color:var(--mg-blue);}
.sol-progress-wrap{height:3px;background:var(--mg-s2);border-radius:4px;overflow:hidden;display:none;}
.sol-progress-wrap.on{display:block;}
.sol-progress-bar{height:100%;background:var(--mg-blue);border-radius:4px;transition:width .4s cubic-bezier(.4,0,.2,1);width:0%;}

/* ═══ LOG — compacto ═══ */
.sol-log-section{border-top:1px solid var(--mg-b1);flex-shrink:0;background:var(--mg-panel);}
.sol-log-header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 7px;cursor:pointer;user-select:none;}
.sol-log-title{font-size:10px;font-weight:700;color:var(--mg-t3);text-transform:uppercase;letter-spacing:1.5px;display:flex;align-items:center;gap:7px;}
.sol-log-count{background:var(--mg-s2);color:var(--mg-blue);font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;border:1px solid rgba(0,120,230,0.12);}
.sol-log-clear{background:none;border:none;color:var(--mg-t3);font-size:10.5px;cursor:pointer;padding:2px 8px;border-radius:5px;font-family:var(--mg-font);font-weight:600;transition:all .18s;}
.sol-log-clear:hover{color:var(--mg-red);background:var(--mg-red-lt);}
.sol-log-body{max-height:120px;overflow-y:auto;padding:3px 12px 10px;}
.sol-log-entry{font-size:11px;font-family:var(--mg-mono);padding:2px 0 2px 8px;border-left:2px solid;margin-bottom:2px;line-height:1.5;animation:log-in .2s ease;}
@keyframes log-in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
.sol-log-entry.info{border-color:rgba(0,120,230,.35);color:#2a6fb8;}
.sol-log-entry.ok{border-color:rgba(22,163,74,.35);color:var(--mg-green);}
.sol-log-entry.warn{border-color:rgba(217,119,6,.35);color:var(--mg-orange);}
.sol-log-entry.err{border-color:rgba(220,38,38,.35);color:var(--mg-red);}

/* ═══ MODAL ═══ */
.aa-ov{
  position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);
  z-index:2147483647;display:flex;align-items:center;justify-content:center;
  animation:ov-in .2s ease;
}
@keyframes ov-in{from{opacity:0}to{opacity:1}}
.aa-modal{
  background:var(--mg-panel);border:1px solid var(--mg-b1);
  border-radius:18px;padding:24px 22px 20px;max-width:400px;width:92%;
  box-shadow:var(--mg-shadow-lg);
  animation:modal-pop .25s cubic-bezier(.34,1.56,.64,1);
  overflow:hidden;position:relative;
}
.aa-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--mg-grad);}
@keyframes modal-pop{from{opacity:0;transform:scale(.92) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}
.aa-res-modal{max-width:460px;width:95%;}
.aa-m-ico{font-size:34px;text-align:center;margin-bottom:8px;}
.aa-m-ttl{font-size:15px;font-weight:800;text-align:center;margin-bottom:7px;letter-spacing:-0.3px;}
.aa-m-msg{font-size:11.5px;color:var(--mg-t2);text-align:center;line-height:1.7;margin-bottom:16px;white-space:pre-line;}
.aa-m-btns{display:flex;gap:7px;margin-top:4px;}
.aa-mb{flex:1;padding:11px;border-radius:9px;border:none;font-family:var(--mg-font);font-weight:700;font-size:11px;cursor:pointer;transition:all .18s;}
.aa-mb.p{background:var(--mg-blue);color:#fff;box-shadow:0 2px 10px rgba(0,120,230,0.22);}
.aa-mb.p:hover{background:var(--mg-blue2);transform:translateY(-1px);}
.aa-mb.s{background:var(--mg-s2);border:1px solid var(--mg-b1);color:var(--mg-t2);}
.aa-mb.s:hover{border-color:var(--mg-b2);background:var(--mg-s3);}
.aa-mb.d{background:var(--mg-red-lt);border:1px solid rgba(220,38,38,.2);color:var(--mg-red);}
.aa-res-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px;}
.aa-res-cell{background:var(--mg-s1);border:1px solid var(--mg-b1);border-radius:10px;padding:10px 5px;text-align:center;}
.aa-res-val{font-size:22px;font-weight:800;font-family:var(--mg-mono);}
.aa-res-lbl{font-size:8px;color:var(--mg-t3);text-transform:uppercase;letter-spacing:1px;margin-top:2px;font-weight:700;}
.aa-rtable{width:100%;border-collapse:collapse;font-size:10.5px;}
.aa-rtable thead th{text-align:left;color:var(--mg-t3);font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:5px 8px;border-bottom:1px solid var(--mg-b1);}
.aa-rtable tbody td{padding:6px 8px;border-bottom:1px solid var(--mg-b1);}
.aa-rtable tbody tr.ok td{background:rgba(22,163,74,.04);}
.aa-rtable tbody tr.fail td{background:rgba(220,38,38,.04);}
.tag-ok{color:var(--mg-green);font-weight:700;font-size:9.5px;background:var(--mg-green-lt);padding:2px 7px;border-radius:4px;}
.tag-fail{color:var(--mg-red);font-weight:700;font-size:9.5px;background:var(--mg-red-lt);padding:2px 7px;border-radius:4px;}

/* ═══ MODAL FINAL + STARS ═══ */
.aa-final-modal{
  background:var(--mg-panel);border:1px solid var(--mg-b1);
  border-radius:18px;padding:0;max-width:460px;width:95%;
  box-shadow:0 24px 80px rgba(0,0,0,0.22);
  animation:modal-pop .3s cubic-bezier(.34,1.56,.64,1);
  overflow:hidden;
}
.aa-final-header{
  background:linear-gradient(135deg,var(--mg-blue) 0%,#0055c8 100%);
  padding:20px 22px 18px;text-align:center;position:relative;
}
.aa-final-header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--mg-grad);}
.aa-final-emoji{font-size:36px;margin-bottom:6px;display:block;}
.aa-final-title{font-size:16px;font-weight:800;color:#fff;margin-bottom:3px;}
.aa-final-subtitle{font-size:11px;color:rgba(255,255,255,0.72);font-weight:500;}
.aa-final-name{font-weight:800;color:#fff;}
.aa-final-body{padding:18px 20px;}
.aa-rating-section{text-align:center;padding:12px 0 2px;border-top:1px solid var(--mg-b1);margin-top:8px;}
.aa-rating-label{font-size:10px;color:var(--mg-t2);margin-bottom:8px;font-weight:500;}
.aa-rating{display:inline-flex;flex-direction:row-reverse;gap:3px;}
.aa-rating input{display:none;}
.aa-rating label{
  font-size:28px;cursor:pointer;color:#9aa0b8;
  transition:color .12s ease,transform .18s cubic-bezier(.34,1.56,.64,1);
  display:inline-block;line-height:1;
}
.aa-rating label::before{content:"★";}
.aa-rating label:hover,
.aa-rating label:hover ~ label{color:#fbbf24;transform:scale(1.22);}
.aa-rating input:checked ~ label{color:#f59e0b;}
.aa-rating input:checked + label{animation:star-pop .28s cubic-bezier(.34,1.56,.64,1);}
@keyframes star-pop{0%{transform:scale(0.6);}60%{transform:scale(1.45);}100%{transform:scale(1.22);}}
.aa-rating-thanks{font-size:10px;color:var(--mg-blue);margin-top:7px;min-height:16px;font-weight:600;}
.aa-final-btns{display:flex;gap:7px;margin-top:14px;}

/* APPEAR */
@keyframes panel-appear{from{opacity:0;transform:translateY(16px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
#__sol__:not(.off){animation:panel-appear .35s cubic-bezier(.34,1.56,.64,1);}
`;
  document.head.appendChild(s);
}

// ═══ LOGO BLOCK ═══════════════════════════════════════
function magaluBrandBlock(size){
  const isLg=size==='lg';
  // Fonte oficial Magalu é arredondada — usamos a mais próxima disponível
  // sm: ao lado de "by joao.gmarques" no header; lg: destaque no toast
  const fs=isLg?24:16;
  // largura real de "Magalu" em rounded black ≈ fs * 3.2
  const textW=Math.round(fs*3.25);
  const svgH=Math.round(fs*1.25);
  // SVG com overflow:visible pra não cortar descenders
  const svg=`<svg width="${textW}" height="${svgH}" viewBox="0 0 ${textW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;"><text x="0" y="${svgH-2}" font-family="'Nunito','Varela Round','Arial Rounded MT Bold','Arial Black',Arial,sans-serif" font-size="${fs}" font-weight="900" fill="#0f1120" letter-spacing="-0.5">Magalu</text></svg>`;
  // barra cola direto no SVG, gap:0
  return `<div class="sol-magalu-logo" style="gap:0;">${svg}<div class="sol-logo-bar" style="width:${textW}px;margin-top:2px;"></div></div>`;
}

// ═══ TOKEN UI — MELHORIA 4: baseado em 5 minutos reais ═══
function uiToken(){
  const el=document.getElementById('sol-tok');
  const tx=document.getElementById('sol-tok-txt');
  const fill=document.getElementById('sol-tok-fill');
  if(!el||!tx)return;

  if(!getTok()){
    el.className='sol-tok-bar w';
    tx.textContent='Aguardando token...';
    if(fill){fill.style.transition='none';fill.style.width='0%';}
    return;
  }
  if(_tokenSessaoExpirou){
    el.className='sol-tok-bar ex';
    tx.textContent='Sessão expirou';
    if(fill){fill.style.transition='none';fill.style.width='0%';}
    return;
  }

  const s=tokSecs();
  // token de 5 minutos = 300s
  const maxSec=300;
  const pct=s!==null?Math.min(100,Math.max(0,(s/maxSec)*100)):100;

  if(s!==null&&s<=60){
    // vermelho: último minuto
    el.className='sol-tok-bar ex';
    tx.textContent=s<=0?'Renovando...':s+'s restantes';
    if(fill){fill.style.transition='width 1s linear';fill.style.width=pct+'%';}
  } else if(s!==null&&s<=180){
    // laranja/amarelo: menos de 3 minutos
    el.className='sol-tok-bar w';
    const m=Math.ceil(s/60);
    tx.textContent=m+'min restantes';
    if(fill){fill.style.transition='width 5s linear';fill.style.width=pct+'%';}
  } else {
    // verde: ok
    el.className='sol-tok-bar ok';
    const m=s!==null?Math.ceil(s/60):5;
    tx.textContent=m+'min · Token ativo';
    if(fill){fill.style.transition='width 5s linear';fill.style.width=pct+'%';}
  }
}

// ═══ PAINEL ═══════════════════════════════════════════
function buildPanel(){
  if(document.getElementById('__sol__'))return;
  if(!document.body)return setTimeout(buildPanel,10);

  // Toast
  const toast=document.createElement('div');
  toast.id='sol-welcome-toast';toast.className='sol-welcome-toast';
  toast.innerHTML=
    '<div class="sol-toast-greeting">Bem-vindo de volta,</div>'+
    '<div class="sol-toast-name" id="sol-toast-name">'+(_userName||'...')+'</div>'+
    '<div class="sol-toast-brand">Gestão de Ativos</div>'+
    '<div class="sol-toast-logo">'+magaluBrandBlock('lg')+'</div>';
  document.body.appendChild(toast);
  if(_userName){
    toast.dataset.shown='1';
    document.getElementById('sol-toast-name').textContent=_userName;
    requestAnimationFrame(()=>{
      toast.classList.add('show');
      setTimeout(()=>toast.classList.add('hide'),3200);
      setTimeout(()=>toast.remove(),3800);
    });
  }

  const root=document.createElement('div');
  root.id='__sol__';
  root.innerHTML=
    // HEADER — spinner CSS + "Solicitar Ativos" + created by
    '<div class="sol-header" id="sol-drag-handle">'+
      '<div class="sol-header-left">'+
        '<div class="sol-spinner-wrap">'+
          '<div class="sol-spinner">'+
            '<span></span><span></span><span></span><span></span>'+
            '<span></span><span></span><span></span><span></span>'+
          '</div>'+
        '</div>'+
        '<div class="sol-header-info">'+
          '<div class="sol-header-title-row">'+
            '<div class="sol-header-title">Solicitar Ativos</div>'+
          '</div>'+
          '<div class="sol-header-sub">created by joao.gmarques</div>'+
        '</div>'+
      '</div>'+
      '<div class="sol-header-btns">'+
        '<button class="sol-hbtn" id="sol-min" title="Minimizar"></button>'+
        '<button class="sol-hbtn close-btn" id="sol-close" title="Fechar">✕</button>'+
      '</div>'+
    '</div>'+

    '<div class="sol-welcome-inline" id="sol-welcome-wrap">'+
      '<div class="sol-welcome-av" id="sol-welcome-av">?</div>'+
      '<div>'+
        '<div class="sol-welcome-txt">Olá, <span class="sol-welcome-name" id="sol-welcome-name">usuário</span></div>'+
        '<div class="sol-welcome-sub">Painel de solicitações ativo</div>'+
      '</div>'+
    '</div>'+

    '<div class="sol-tok-bar w" id="sol-tok">'+
      '<div class="sol-tok-dot"></div>'+
      '<span class="sol-tok-label" id="sol-tok-txt">Aguardando token...</span>'+
      '<div class="sol-tok-track"><div class="sol-tok-fill" id="sol-tok-fill" style="width:0%"></div></div>'+
    '</div>'+

    '<div class="sol-body">'+

      '<div class="sol-card">'+
        '<div class="sol-card-label">Modo de execução</div>'+
        '<div class="sol-modo-selector">'+
          '<label class="sol-modo-radio">'+
            '<input type="radio" name="sol-modo" id="sol-modo-unico" checked/>'+
            '<span class="sol-modo-name">Gemco Único</span>'+
          '</label>'+
          '<label class="sol-modo-radio">'+
            '<input type="radio" name="sol-modo" id="sol-modo-filial"/>'+
            '<span class="sol-modo-name">Gemco por Filial</span>'+
          '</label>'+
        '</div>'+
        '<div class="sol-gemco-desc" id="sol-modo-desc">'+
          'Informe a <strong>filial</strong> e a <strong>quantidade</strong> por linha. O gemco base será aplicado a todas as filiais.'+
          '<br><span class="sol-gemco-example">550 1 &nbsp;→&nbsp; filial 550, qtd 1</span>'+
        '</div>'+
        '<div class="sol-card-label">Filiais + quantidade</div>'+
        '<textarea class="sol-ta" id="sol-ta" rows="4" placeholder="550 1&#10;350 2&#10;123 3"></textarea>'+
      '</div>'+

      '<div class="sol-card">'+
        '<div class="sol-card-label">Configuração</div>'+
        '<div class="sol-gemco-wrap" id="sol-gemco-wrap">'+
          '<div class="sol-row"><input class="sol-inp" id="sol-gemco" placeholder="Gemco base (ex: 2936932)"/></div>'+
        '</div>'+
        '<div class="sol-row">'+
          '<div class="sol-sel-wrap">'+
            '<select class="sol-sel" id="sol-origin">'+
              '<option value="0038">Origem: CD38</option>'+
              '<option value="0991">Origem: CD991</option>'+
            '</select>'+
            '<span class="sol-sa">▾</span>'+
          '</div>'+
        '</div>'+
      '</div>'+

      // Typewriter original Uiverse Nawsome + word spinner kennyotsu
      '<div class="sol-typewriter-wrap" id="sol-typewriter">'+
        '<div class="sol-typewriter">'+
          '<div class="tw-slide"><i></i></div>'+
          '<div class="tw-paper"></div>'+
          '<div class="tw-keyboard"></div>'+
        '</div>'+
        '<div class="sol-tw-spinner">'+
          'Processando'+
          '<div class="sol-tw-spinner-track">'+
            '<span class="sol-tw-word">solicitação...</span>'+
            '<span class="sol-tw-word">ativos...</span>'+
            '<span class="sol-tw-word">CD de origem...</span>'+
            '<span class="sol-tw-word">confirmação...</span>'+
            '<span class="sol-tw-word">solicitação...</span>'+
          '</div>'+
        '</div>'+
      '</div>'+

      '<button class="sol-btn-run-wrap" id="sol-run">'+
        '<div class="sol-btn-run-inner">'+
          'INICIAR'+
          '<svg class="sol-btn-run-svg" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">'+
            '<path d="M11.6801 14.62L14.2401 12.06L11.6801 9.5" stroke="white" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>'+
            '<path d="M4 12.0601H14.17" stroke="white" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>'+
            '<path d="M12 4C16.42 4 20 7 20 12C20 17 16.42 20 12 20" stroke="white" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>'+
          '</svg>'+
        '</div>'+
      '</button>'+

      '<div class="sol-divider"></div>'+
      '<div class="sol-status" id="sol-st">Pronto para iniciar.</div>'+
      '<div class="sol-progress-wrap" id="sol-pw"><div class="sol-progress-bar" id="sol-pb"></div></div>'+

    '</div>'+

    '<div class="sol-stop-section" id="sol-stop-section">'+
      '<div class="sol-btn-stop-wrap" id="sol-stop">'+
        '<span class="sol-stop-text">Parar</span>'+
        '<span class="sol-stop-icon">'+
          '<svg class="sol-stop-svg" height="512" viewBox="0 0 512 512" width="512" xmlns="http://www.w3.org/2000/svg">'+
            '<path d="M112,112l20,320c.95,18.49,14.4,32,32,32H348c17.67,0,30.87-13.51,32-32l20-320" style="fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/>'+
            '<line style="stroke:#fff;stroke-linecap:round;stroke-miterlimit:10;stroke-width:32px" x1="80" x2="432" y1="112" y2="112"/>'+
            '<path d="M192,112V72h0a23.93,23.93,0,0,1,24-24h80a23.93,23.93,0,0,1,24,24h0v40" style="fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/>'+
            '<line style="fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px" x1="256" x2="256" y1="176" y2="400"/>'+
            '<line style="fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px" x1="184" x2="192" y1="176" y2="400"/>'+
            '<line style="fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px" x1="328" x2="320" y1="176" y2="400"/>'+
          '</svg>'+
        '</span>'+
      '</div>'+
    '</div>'+

    '<div class="sol-log-section">'+
      '<div class="sol-log-header" id="sol-lh">'+
        '<span class="sol-log-title">Logs <span class="sol-log-count" id="sol-lc">0</span></span>'+
        '<button class="sol-log-clear" id="sol-lclr">limpar</button>'+
      '</div>'+
      '<div class="sol-log-body" id="sol-lb"><div class="sol-log-entry info">Aguardando...</div></div>'+
    '</div>';

  document.body.appendChild(root);

  const tab=document.createElement('button');
  tab.id='__sol_tab__';tab.innerHTML='📤';
  document.body.appendChild(tab);

  // DRAG
  let isDragging=false,dragOffX=0,dragOffY=0;
  const handle=document.getElementById('sol-drag-handle');
  handle.addEventListener('mousedown',e=>{
    if(e.target.closest('.sol-hbtn'))return;
    isDragging=true;
    const r=root.getBoundingClientRect();
    dragOffX=e.clientX-r.left;dragOffY=e.clientY-r.top;
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove',e=>{
    if(!isDragging)return;
    let x=e.clientX-dragOffX,y=e.clientY-dragOffY;
    x=Math.max(0,Math.min(x,window.innerWidth-root.offsetWidth));
    y=Math.max(0,Math.min(y,window.innerHeight-60));
    root.style.left=x+'px';root.style.top=y+'px';root.style.right='auto';
  });
  document.addEventListener('mouseup',()=>{if(isDragging){isDragging=false;document.body.style.userSelect='';}});

  // CLOSE — com animação de pop no FAB
  document.getElementById('sol-close').onclick=e=>{
    e.stopPropagation();
    root.classList.add('off');
    tab.style.display='flex';
    tab.classList.remove('popping');
    void tab.offsetWidth; // reflow para reiniciar animação
    tab.classList.add('popping');
    setTimeout(()=>tab.classList.remove('popping'),1200);
  };
  tab.onclick=()=>{root.classList.remove('off');tab.style.display='none';};

  // MINIMIZE — ícones CSS puro, sem SVG
  const minBtn=document.getElementById('sol-min');
  minBtn.setAttribute('data-state','open');
  let mini=false;
  minBtn.onclick=e=>{
    e.stopPropagation();
    mini=!mini;
    root.classList.toggle('minimized',mini);
    minBtn.setAttribute('data-state',mini?'closed':'open');
    minBtn.title=mini?'Restaurar':'Minimizar';
  };

  // MODO
  function setModo(unico){
    document.getElementById('sol-modo-unico').checked=unico;
    document.getElementById('sol-modo-filial').checked=!unico;
    document.getElementById('sol-gemco-wrap').style.display=unico?'':'none';
    const ta=document.getElementById('sol-ta');
    const desc=document.getElementById('sol-modo-desc');
    if(unico){
      ta.placeholder='550 1\n350 2\n123 3';
      desc.innerHTML='Informe a <strong>filial</strong> e a <strong>quantidade</strong> por linha. O gemco base será aplicado a todas as filiais.<br><span class="sol-gemco-example">550 1 &nbsp;→&nbsp; filial 550, qtd 1</span>';
    }else{
      ta.placeholder='550 1 2936932\n350 2 1234567\n123 3 9876543';
      desc.innerHTML='Informe <strong>filial</strong>, <strong>quantidade</strong> e <strong>gemco</strong> por linha.<br><span class="sol-gemco-example">550 1 2936932 &nbsp;→&nbsp; filial, qtd, gemco</span>';
    }
  }
  document.getElementById('sol-modo-unico').addEventListener('change',()=>setModo(true));
  document.getElementById('sol-modo-filial').addEventListener('change',()=>setModo(false));

  document.getElementById('sol-run').onclick=start;
  document.getElementById('sol-stop').onclick=()=>{S.stop=true;setSt('Parando...');log('Interrompido pelo usuário.','warn');};

  let logOpen=true;
  document.getElementById('sol-lh').onclick=()=>{logOpen=!logOpen;document.getElementById('sol-lb').style.display=logOpen?'':'none';};
  document.getElementById('sol-lclr').onclick=e=>{e.stopPropagation();document.getElementById('sol-lb').innerHTML='';_lc=0;document.getElementById('sol-lc').textContent='0';};
  if(_userName)updateWelcome();
  uiToken();
  setInterval(uiToken,5000);
}

function setSt(t,on){const el=document.getElementById('sol-st');if(!el)return;el.textContent=t;el.className='sol-status'+(on!==false?' on':'');}
function setProg(p){
  const w=document.getElementById('sol-pw'),b=document.getElementById('sol-pb');
  if(!w||!b)return;
  if(p===null){w.classList.remove('on');return;}
  w.classList.add('on');b.style.width=p+'%';
}
let _lc=0;
function log(msg,type){
  type=type||'info';
  const lb=document.getElementById('sol-lb');if(!lb)return;
  _lc++;const lc=document.getElementById('sol-lc');if(lc)lc.textContent=_lc;
  const t=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const d=document.createElement('div');d.className='sol-log-entry '+type;
  d.textContent=t+'  '+msg;lb.appendChild(d);lb.scrollTop=lb.scrollHeight;
  if(lb.children.length>200)lb.removeChild(lb.children[0]);
}

function modal(cfg){
  return new Promise(res=>{
    const ov=document.createElement('div');ov.className='aa-ov';
    const m=document.createElement('div');m.className='aa-modal'+(cfg.wide?' '+cfg.wide:'');
    const ico=cfg.icone||(cfg.tipo==='err'?'⚠️':cfg.tipo==='ok'?'✅':'ℹ️');
    const tc=cfg.tipo==='err'?'var(--mg-red)':cfg.tipo==='ok'?'var(--mg-green)':cfg.tipo==='warn'?'var(--mg-orange)':'var(--mg-blue)';
    let h='<div class="aa-m-ico">'+ico+'</div><div class="aa-m-ttl" style="color:'+tc+'">'+cfg.titulo+'</div>';
    if(cfg.mensagem)h+='<div class="aa-m-msg">'+cfg.mensagem+'</div>';
    if(cfg.html)h+=cfg.html;
    h+='<div class="aa-m-btns">';
    (cfg.btns||[]).forEach(b=>{h+='<button class="aa-mb '+(b.cls||'s')+'" data-v="'+b.v+'">'+b.t+'</button>';});
    h+='</div>';
    m.innerHTML=h;ov.appendChild(m);document.body.appendChild(ov);
    m.querySelectorAll('[data-v]').forEach(btn=>{btn.addEventListener('click',()=>{ov.remove();res(btn.dataset.v);});});
    ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();res(null);}});
  });
}

function modalFinal(oks,fails,gemcoLabel,origin){
  return new Promise(res=>{
    const ov=document.createElement('div');ov.className='aa-ov';
    const m=document.createElement('div');m.className='aa-final-modal aa-res-modal';
    const nome=_userName||'usuário';const allOk=fails.length===0;

    let tab='<table class="aa-rtable"><thead><tr><th>Filial</th><th>Itens</th><th>Sol.</th><th>Status</th></tr></thead><tbody>';
    [...oks,...fails].forEach(r=>{
      const itens=r.assets.map(a=>'<span style="font-size:9px;color:var(--mg-t2)">'+a.itemCode+' x'+a.amount+'</span>').join('<br>');
      tab+='<tr class="'+(r.status==='ok'?'ok':'fail')+'"><td><strong>'+r.filial+'</strong></td><td>'+itens+'</td><td style="font-size:9.5px">'+(r.solId||'—')+'</td><td>'+(r.status==='ok'?'<span class="tag-ok">OK</span>':'<span class="tag-fail">Falhou</span>')+'</td></tr>';
      if(r.status==='fail')tab+='<tr class="fail"><td colspan="4" style="font-size:9px;color:var(--mg-red);padding:2px 8px 5px">'+r.motivo+'</td></tr>';
    });
    tab+='</tbody></table>';

    m.innerHTML=
      '<div class="aa-final-header">'+
        '<span class="aa-final-emoji">'+(allOk?'🎉':'⚠️')+'</span>'+
        '<div class="aa-final-title">Finalizamos, <span class="aa-final-name">'+nome+'</span>! '+(allOk?'🎉':'')+'</div>'+
        '<div class="aa-final-subtitle">Aqui está o resultado de todos os ativos solicitados.</div>'+
      '</div>'+
      '<div class="aa-final-body">'+
        '<div class="aa-res-sum">'+
          '<div class="aa-res-cell"><div class="aa-res-val" style="color:var(--mg-blue)">'+S.results.length+'</div><div class="aa-res-lbl">Total</div></div>'+
          '<div class="aa-res-cell"><div class="aa-res-val" style="color:var(--mg-green)">'+oks.length+'</div><div class="aa-res-lbl">Sucesso</div></div>'+
          '<div class="aa-res-cell"><div class="aa-res-val" style="color:'+(fails.length?'var(--mg-red)':'var(--mg-green)')+'">'+fails.length+'</div><div class="aa-res-lbl">Falhas</div></div>'+
        '</div>'+
        '<div style="font-size:9.5px;color:var(--mg-t3);text-align:center;margin-bottom:10px;font-weight:600">Gemco: '+gemcoLabel+' · Origem: CD'+norm(origin)+'</div>'+
        '<div style="max-height:190px;overflow-y:auto;border:1px solid var(--mg-b1);border-radius:10px;margin-bottom:4px;">'+tab+'</div>'+
        '<div class="aa-rating-section">'+
          '<div class="aa-rating-label">Como foi a sua experiência?</div>'+
          '<div class="aa-rating" id="aa-stars">'+
            '<input type="radio" id="star5" name="aa-rating" value="5"><label for="star5"></label>'+
            '<input type="radio" id="star4" name="aa-rating" value="4"><label for="star4"></label>'+
            '<input type="radio" id="star3" name="aa-rating" value="3"><label for="star3"></label>'+
            '<input type="radio" id="star2" name="aa-rating" value="2"><label for="star2"></label>'+
            '<input type="radio" id="star1" name="aa-rating" value="1"><label for="star1"></label>'+
          '</div>'+
          '<div class="aa-rating-thanks" id="aa-rating-thanks"></div>'+
        '</div>'+
        '<div class="aa-final-btns">'+
          '<button class="aa-mb s" data-v="copy">📋 Copiar</button>'+
          '<button class="aa-mb p" data-v="close">Fechar</button>'+
        '</div>'+
      '</div>';

    ov.appendChild(m);document.body.appendChild(ov);
    const msgs=['😞 Vamos melhorar!','😐 Obrigado.','🙂 Valeu!','😊 Que bom!','🥳 Arrasou!'];
    m.querySelectorAll('#aa-stars input').forEach(inp=>{
      inp.addEventListener('change',()=>{
        const th=document.getElementById('aa-rating-thanks');
        if(th)th.textContent=msgs[parseInt(inp.value)-1]||'Obrigado!';
      });
    });
    m.querySelectorAll('[data-v]').forEach(btn=>{btn.addEventListener('click',()=>{ov.remove();res(btn.dataset.v);});});
    ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();res('close');}});
  });
}

function parseFiliais(text,modoGemcoPorFilial){
  const result=[];
  text.split('\n').forEach(line=>{
    line=line.trim();if(!line||line.startsWith('#'))return;
    if(modoGemcoPorFilial){
      const m=line.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
      if(m){result.push({filial:m[1],filialPad:pad(m[1]),qtd:parseInt(m[2]),gemco:m[3]});return;}
      const m2=line.match(/^(\d+)\s+(\d{5,})$/);
      if(m2){result.push({filial:m2[1],filialPad:pad(m2[1]),qtd:1,gemco:m2[2]});return;}
    }else{
      const m=line.match(/^(\d+)\s+(\d+)$/);
      if(m){result.push({filial:m[1],filialPad:pad(m[1]),qtd:parseInt(m[2])});return;}
      const m2=line.match(/^(\d+)$/);
      if(m2){result.push({filial:m2[1],filialPad:pad(m2[1]),qtd:1});}
    }
  });
  return result;
}

function showWorking(show){
  const tw=document.getElementById('sol-typewriter');
  if(tw)tw.classList.toggle('active',show);
}

async function start(){
  const raw=document.getElementById('sol-ta').value||'';
  const origin=document.getElementById('sol-origin').value||'0038';
  const modoUnico=document.getElementById('sol-modo-unico').checked;
  const modoPorFilial=!modoUnico;
  const jobs=parseFiliais(raw,modoPorFilial);
  let gemcoUnico='';
  if(modoUnico){
    gemcoUnico=(document.getElementById('sol-gemco').value||'').trim();
    if(!gemcoUnico){await modal({tipo:'err',icone:'🔍',titulo:'Gemco não informado',mensagem:'Informe o código Gemco do produto.',btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  }
  if(!getTok()){await modal({tipo:'err',icone:'🔐',titulo:'Token não capturado',mensagem:'Faça qualquer ação no site primeiro.',btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  if(!jobs.length){
    const ex=modoPorFilial?'550 1 2936932\n350 2 1234567':'550 1\n350 2';
    await modal({tipo:'err',icone:'📝',titulo:'Nenhuma filial',mensagem:'Informe ao menos uma filial:\n'+ex,btns:[{t:'Ok',v:'ok',cls:'p'}]});return;
  }
  if(modoPorFilial){
    const semGemco=jobs.filter(j=>!j.gemco);
    if(semGemco.length){await modal({tipo:'err',icone:'🔍',titulo:'Gemco ausente',mensagem:'Sem Gemco:\n'+semGemco.map(j=>'Filial '+j.filial).join('\n'),btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  }
  const gruposMap={};const gruposOrdem=[];
  jobs.forEach(j=>{
    const key=j.filialPad;
    if(!gruposMap[key]){gruposMap[key]={filial:j.filial,filialPad:j.filialPad,assets:[]};gruposOrdem.push(key);}
    const gemco=modoUnico?gemcoUnico:j.gemco;
    const existing=gruposMap[key].assets.find(a=>a.itemCode===gemco);
    if(existing)existing.amount+=j.qtd;else gruposMap[key].assets.push({itemCode:gemco,amount:j.qtd});
  });
  const grupos=gruposOrdem.map(k=>gruposMap[k]);
  const preview=grupos.slice(0,5).map(g=>'· CD'+g.filial+': '+g.assets.map(a=>'Gemco '+a.itemCode+' x'+a.amount).join(', ')).join('\n')+(grupos.length>5?'\n... e mais '+(grupos.length-5):'');
  const agrupouLabel=grupos.length<jobs.length?' ('+jobs.length+' linhas → '+grupos.length+' sols)':'';
  const conf=await modal({icone:'📤',tipo:'info',titulo:'Confirmar Solicitações',mensagem:'Origem: CD'+norm(origin)+'\nSolicitações: '+grupos.length+agrupouLabel+'\n\n'+preview,btns:[{t:'Cancelar',v:'n',cls:'d'},{t:'Iniciar',v:'s',cls:'p'}]});
  if(conf!=='s')return;

  Object.assign(S,{running:true,stop:false,results:[],startTime:Date.now()});
  document.getElementById('sol-run').style.display='none';
  document.getElementById('sol-stop-section').classList.add('active');
  document.getElementById('sol-stop').style.display='flex';
  showWorking(true);setProg(5);
  log('Iniciando '+grupos.length+' solicitações','info');

  for(let i=0;i<grupos.length;i++){
    if(S.stop)break;
    const grupo=grupos[i];
    setSt('Solicitação '+(i+1)+'/'+grupos.length+' — Filial '+grupo.filial);
    setProg(5+Math.round(i/grupos.length*88));
    log('Filial '+grupo.filial+'...','info');
    try{
      const criada=await req('POST','/v1/solicitations/branch',{origin:'',destiny:grupo.filialPad,receivingBranch:{code:'',complement:'',number:'',postalCode:'',publicPlace:''},observation:''});
      if(!criada||!criada.solicitationId)throw new Error('API não retornou solicitationId');
      const solId=criada.solicitationId;
      await req('POST','/v1/solicitations/branch/'+solId+'/asset',{assets:grupo.assets});
      await req('PATCH','/v1/solicitations/branch/'+solId,{observation:'',origin:origin,status:'CREATED'});
      S.results.push({filial:grupo.filial,assets:grupo.assets,solId,status:'ok'});
      log('OK Filial '+grupo.filial+' — Sol #'+solId,'ok');
    }catch(e){
      S.results.push({filial:grupo.filial,assets:grupo.assets,solId:null,status:'fail',motivo:e.message});
      log('ERRO Filial '+grupo.filial+': '+e.message,'err');
      const d=await modal({tipo:'err',titulo:'Erro — Filial '+grupo.filial,mensagem:e.message+'\n\nO que deseja fazer?',btns:[{t:'Parar',v:'stop',cls:'d'},{t:'Pular',v:'skip',cls:'s'},{t:'Tentar novamente',v:'retry',cls:'p'}]});
      if(d==='stop'){S.stop=true;break;}
      if(d==='retry'){i--;continue;}
    }
    await sleep(600);
  }

  S.running=false;
  document.getElementById('sol-run').style.display='';
  document.getElementById('sol-stop-section').classList.remove('active');
  document.getElementById('sol-stop').style.display='none';
  showWorking(false);
  setProg(100);setTimeout(()=>setProg(null),600);
  setSt(S.stop?'Interrompido.':'Concluído! 🎉',false);

  const oks=S.results.filter(r=>r.status==='ok');
  const fails=S.results.filter(r=>r.status==='fail');
  const gemcoLabel=modoPorFilial?'(por filial)':gemcoUnico;
  const v=await modalFinal(oks,fails,gemcoLabel,origin);
  if(v==='copy'){
    const lines=['SOLICITAÇÕES — '+new Date().toLocaleString('pt-BR'),'Gemco: '+gemcoLabel+' | Origem: CD'+norm(origin),'Total: '+S.results.length+' | OK: '+oks.length+' | Falhas: '+fails.length,''];
    S.results.forEach(r=>{
      const itens=r.assets.map(a=>a.itemCode+' x'+a.amount).join(', ');
      lines.push(r.status==='ok'?'OK Filial '+r.filial+' ['+itens+'] Sol#'+r.solId:'ERRO Filial '+r.filial+' ['+itens+'] '+r.motivo);
    });
    navigator.clipboard.writeText(lines.join('\n'));
  }
}

// ═══ INIT ═════════════════════════════════════════════
injectCSS();
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>setTimeout(buildPanel,600));}
else{setTimeout(buildPanel,600);}
syncTok();

})();
