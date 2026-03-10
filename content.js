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
      if(!_tokenSessaoExpirou){
        log('Sessão expirou — clique em qualquer menu do portal para restaurar','warn');
        uiToken();
      }
      _tokenSessaoExpirou=true;
      _tokenUltimoErro=Date.now();
    } else {
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

async function ensureToken(){
  const m=tokMins();
  if(_tok && m!==null && m<2){
    await _renovarTokenSilencioso();
  }
}

setInterval(async()=>{
  const m=tokMins();
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

// ═══ USERNAME ═════════════════════════════════════════
function getUsername(){
  try{
    const parts=(_tok||'').replace('Bearer ','').split('.');
    if(parts.length!==3)return null;
    const payload=JSON.parse(atob(parts[1]));
    const raw=payload.name||payload.preferred_username||payload.given_name||
              payload.fullname||payload.username||
              (payload.email?payload.email.split('@')[0]:null)||
              payload.sub||null;
    if(!raw)return null;
    // Capitaliza primeira letra de cada palavra
    return raw.split(/[\s._]+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
  }catch(_){return null;}
}

function getInitials(name){
  if(!name)return '?';
  const parts=name.trim().split(' ').filter(Boolean);
  if(parts.length===1)return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0)+parts[parts.length-1].charAt(0)).toUpperCase();
}

function updateWelcome(){
  const nameEl=document.getElementById('sol-wname');
  const avatarEl=document.getElementById('sol-wavatar');
  if(!nameEl||!avatarEl)return;
  const username=getUsername();
  if(username){
    const firstName=username.split(' ')[0];
    nameEl.textContent='Olá, '+firstName+'! 👋';
    avatarEl.textContent=getInitials(username);
    avatarEl.style.fontSize='13px';
  } else {
    nameEl.textContent='Bem-vindo!';
    avatarEl.textContent='✦';
  }
}

// ═══ CSS ══════════════════════════════════════════════
function injectCSS(){
  if(document.getElementById('__sol_css__'))return;
  if(!document.head)return setTimeout(injectCSS,10);
  const s=document.createElement('style');
  s.id='__sol_css__';
  s.textContent=`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg:#080b14;
  --s1:#0e1120;
  --s2:#141728;
  --s3:#1c2035;
  --b1:rgba(255,255,255,0.06);
  --b2:rgba(255,255,255,0.11);
  --b3:rgba(99,102,241,0.35);
  --t1:#eeeef5;
  --t2:#8888aa;
  --t3:#4a4a6a;
  --blue:#6366f1;
  --blue2:#818cf8;
  --purple:#8b5cf6;
  --green:#10b981;
  --red:#f43f5e;
  --orange:#f59e0b;
  --redlt:rgba(244,63,94,0.12);
  --bluelt:rgba(99,102,241,0.12);
  --grad:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
  --grad-glow:0 4px 24px rgba(99,102,241,0.4);
}

/* ── Panel ── */
#__sol__ {
  position:fixed;top:0;right:0;width:340px;height:100vh;
  background:var(--bg);
  background-image:
    radial-gradient(ellipse at 60% 0%,rgba(99,102,241,0.12) 0%,transparent 55%),
    radial-gradient(ellipse at 100% 100%,rgba(139,92,246,0.07) 0%,transparent 45%);
  border-left:1px solid var(--b1);
  font-family:'Inter',sans-serif;color:var(--t1);
  z-index:2147483646;display:flex;flex-direction:column;overflow:hidden;
  transition:transform .32s cubic-bezier(.4,0,.2,1);
}
#__sol__.entering { animation:solSlideIn .38s cubic-bezier(.4,0,.2,1) both; }
@keyframes solSlideIn {
  from { transform:translateX(100%); opacity:0; }
  to   { transform:translateX(0);    opacity:1; }
}
#__sol__.off { transform:translateX(100%); }

/* ── Tab ── */
#__sol_tab__ {
  position:fixed;top:50%;right:0;transform:translateY(-50%);
  background:var(--s2);border:1px solid var(--b1);border-right:none;
  border-radius:8px 0 0 8px;padding:12px 7px;cursor:pointer;
  z-index:2147483645;writing-mode:vertical-lr;
  font-size:10px;font-weight:700;color:var(--t2);letter-spacing:1.5px;
  display:none;transition:all .2s;
}
#__sol_tab__:hover { background:var(--s3);color:var(--t1); }

/* ── Header ── */
.solh {
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 16px 14px;border-bottom:1px solid var(--b1);flex-shrink:0;
  background:linear-gradient(180deg,rgba(99,102,241,0.1) 0%,transparent 100%);
  position:relative;overflow:hidden;
}
.solh::after {
  content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(99,102,241,0.6),rgba(139,92,246,0.5),transparent);
}
.solh-l { display:flex;align-items:center;gap:10px; }
.solh-ico {
  width:36px;height:36px;
  background:var(--grad);
  border-radius:10px;display:flex;align-items:center;justify-content:center;
  font-size:18px;box-shadow:var(--grad-glow);
  position:relative;overflow:hidden;flex-shrink:0;
}
.solh-ico::after {
  content:'';position:absolute;top:-50%;left:-60%;width:40%;height:200%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent);
  transform:skewX(-15deg);
  animation:icoShimmer 4s infinite;
}
@keyframes icoShimmer {
  0%   { left:-60%; }
  40%,100% { left:160%; }
}
.solh-title { font-size:13.5px;font-weight:700;letter-spacing:-.2px; }
.solh-sub { font-size:10px;color:var(--t3);margin-top:1px; }
.solh-btns { display:flex;gap:4px; }
.solh-btn {
  background:none;border:none;color:var(--t3);cursor:pointer;
  width:28px;height:28px;border-radius:7px;
  display:flex;align-items:center;justify-content:center;font-size:14px;
  transition:all .15s;
}
.solh-btn:hover { background:var(--s3);color:var(--t1); }
.solh-btn.cb:hover { background:var(--redlt);color:#fca5a5; }

/* ── Welcome ── */
.sol-welcome {
  display:flex;align-items:center;gap:10px;
  padding:10px 14px;border-bottom:1px solid var(--b1);flex-shrink:0;
  background:rgba(99,102,241,0.04);
  animation:fadeSlideDown .5s .1s ease both;
}
@keyframes fadeSlideDown {
  from { opacity:0;transform:translateY(-6px); }
  to   { opacity:1;transform:translateY(0); }
}
.sol-avatar {
  width:34px;height:34px;border-radius:50%;
  background:var(--grad);
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700;color:#fff;
  flex-shrink:0;
  box-shadow:0 0 0 2px rgba(99,102,241,0.3),0 0 14px rgba(99,102,241,0.35);
  letter-spacing:0;
  position:relative;overflow:hidden;
}
.sol-avatar::after {
  content:'';position:absolute;top:-50%;left:-80%;width:50%;height:200%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent);
  transform:skewX(-15deg);
  animation:avatarShimmer 5s 1s infinite;
}
@keyframes avatarShimmer {
  0%   { left:-80%; }
  30%,100% { left:160%; }
}
.sol-welcome-text { flex:1;min-width:0; }
.sol-welcome-name { font-size:12.5px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.sol-welcome-sub { font-size:10px;color:var(--t3);margin-top:1px; }

/* ── Token ── */
.sol-tok {
  display:flex;align-items:center;gap:9px;
  padding:8px 14px;font-size:11px;
  border-bottom:1px solid var(--b1);flex-shrink:0;
  transition:background .3s;
}
.sol-tok-dot {
  width:8px;height:8px;border-radius:50%;flex-shrink:0;
  transition:box-shadow .3s;
}
.sol-tok.ok .sol-tok-dot { background:var(--green);box-shadow:0 0 0 3px rgba(16,185,129,0.2),0 0 8px var(--green); }
.sol-tok.w  .sol-tok-dot { background:var(--orange);animation:blinkDot 1.2s infinite;box-shadow:0 0 0 3px rgba(245,158,11,0.2); }
.sol-tok.ex .sol-tok-dot { background:var(--red);animation:blinkDot .8s infinite;box-shadow:0 0 0 3px rgba(244,63,94,0.2),0 0 10px var(--red); }
@keyframes blinkDot {
  0%,100% { opacity:1; }
  50%     { opacity:.15; }
}
.sol-tok.ok { color:var(--t2); }
.sol-tok.w,.sol-tok.ex { color:#fcd34d; }
.sol-tok-txt { flex:1; }

/* ── Body ── */
.sols {
  flex:1;overflow-y:auto;padding:12px 12px 8px;
  display:flex;flex-direction:column;gap:9px;
  scrollbar-width:thin;scrollbar-color:var(--s3) transparent;
}

/* ── Cards ── */
.sol-card {
  background:var(--s1);
  border:1px solid var(--b1);
  border-radius:12px;padding:13px 13px;
  position:relative;overflow:hidden;
  transition:border-color .25s,box-shadow .25s;
}
.sol-card:hover { border-color:var(--b2);box-shadow:0 4px 20px rgba(0,0,0,.4); }
.sol-card::before {
  content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(99,102,241,0.3),transparent);
  opacity:0;transition:opacity .25s;
}
.sol-card:hover::before { opacity:1; }
.sol-card-label {
  font-size:9.5px;font-weight:600;color:var(--t3);
  text-transform:uppercase;letter-spacing:1.2px;margin-bottom:9px;
}

/* ── Textarea ── */
.sol-ta {
  width:100%;background:var(--s2);border:1px solid var(--b1);
  border-radius:8px;color:var(--t1);font-size:12px;
  font-family:'JetBrains Mono',monospace;padding:9px 10px;
  box-sizing:border-box;resize:vertical;outline:none;line-height:1.6;
  transition:border-color .2s,box-shadow .2s;
}
.sol-ta:focus { border-color:rgba(99,102,241,.55);box-shadow:0 0 0 3px rgba(99,102,241,.1); }
.sol-ta::placeholder { color:var(--t3); }

/* ── Hints ── */
.sol-hints { display:flex;gap:5px;flex-wrap:wrap;margin-top:6px; }
.sol-hint {
  font-size:9.5px;color:var(--t3);background:var(--s3);
  border:1px solid var(--b1);border-radius:5px;padding:2px 8px;
  font-family:'JetBrains Mono',monospace;
}

/* ── Row / Select / Input ── */
.sol-row { display:flex;gap:8px;margin-bottom:8px; }
.sol-row:last-child { margin-bottom:0; }
.sol-sel-wrap { flex:1;position:relative; }
.sol-sel {
  width:100%;background:var(--s2);border:1px solid var(--b1);
  border-radius:8px;color:var(--t1);font-size:12px;
  padding:9px 28px 9px 10px;appearance:none;outline:none;cursor:pointer;
  transition:border-color .2s,box-shadow .2s;
  font-family:'Inter',sans-serif;
}
.sol-sel:focus { border-color:rgba(99,102,241,.55);box-shadow:0 0 0 3px rgba(99,102,241,.1); }
.sol-sa { position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--t3);font-size:10px; }
.sol-inp {
  flex:1;background:var(--s2);border:1px solid var(--b1);
  border-radius:8px;color:var(--t1);font-size:12px;
  font-family:'JetBrains Mono',monospace;padding:9px 10px;
  box-sizing:border-box;outline:none;
  transition:border-color .2s,box-shadow .2s;
}
.sol-inp:focus { border-color:rgba(99,102,241,.55);box-shadow:0 0 0 3px rgba(99,102,241,.1); }
.sol-inp::placeholder { color:var(--t3); }

/* ── Mode Toggle ── */
.sol-modo {
  display:flex;background:var(--s2);border:1px solid var(--b1);
  border-radius:10px;padding:3px;gap:3px;margin-bottom:10px;
}
.sol-modo-btn {
  flex:1;padding:7px 0;border:none;border-radius:8px;
  font-family:'Inter',sans-serif;font-size:11px;font-weight:600;
  cursor:pointer;transition:all .2s;color:var(--t3);background:none;
  position:relative;overflow:hidden;
}
.sol-modo-btn.active {
  background:var(--grad);color:#fff;
  box-shadow:0 2px 14px rgba(99,102,241,.4);
}
.sol-modo-btn.active::after {
  content:'';position:absolute;top:0;left:-80%;width:50%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);
  transform:skewX(-15deg);
  animation:modeShimmer 2.5s infinite;
}
@keyframes modeShimmer {
  0%   { left:-80%; }
  50%,100% { left:160%; }
}
.sol-modo-btn:not(.active):hover { background:var(--s3);color:var(--t2); }
.sol-gemco-wrap { transition:opacity .2s; }

/* ── Buttons ── */
.sol-btn {
  width:100%;padding:12px;border-radius:10px;border:none;
  font-family:'Inter',sans-serif;font-weight:600;font-size:13px;
  cursor:pointer;transition:all .2s;
  display:flex;align-items:center;justify-content:center;gap:7px;
  position:relative;overflow:hidden;
}
.sol-btn-run {
  background:var(--grad);color:#fff;
  box-shadow:var(--grad-glow);
}
.sol-btn-run:hover {
  box-shadow:0 6px 32px rgba(99,102,241,.55);
  transform:translateY(-1px);
}
.sol-btn-run:active { transform:translateY(0);box-shadow:var(--grad-glow); }
.sol-btn-run::after {
  content:'';position:absolute;top:0;left:-100%;width:55%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);
  transform:skewX(-15deg);
  animation:runShimmer 3s infinite;
}
@keyframes runShimmer {
  0%   { left:-100%; }
  45%,100% { left:160%; }
}
.sol-btn-stop {
  background:var(--redlt);border:1px solid rgba(244,63,94,.3);
  color:#fda4af;display:none;
}
.sol-btn-stop:hover { background:rgba(244,63,94,.2); }

/* ── Divider / Status / Progress ── */
.sol-div { height:1px;background:var(--b1);margin:2px 0; }
.sol-st { font-size:11px;color:var(--t3);text-align:center;padding:4px 0;min-height:20px; }
.sol-st.on { color:#a5b4fc; }
.sol-pw { height:3px;background:var(--s3);border-radius:2px;overflow:hidden;display:none; }
.sol-pw.on { display:block; }
.sol-pb {
  height:100%;background:var(--grad);border-radius:2px;
  transition:width .3s ease;width:0%;position:relative;
}
.sol-pb::after {
  content:'';position:absolute;top:0;left:0;right:0;bottom:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);
  animation:pbShimmer 1.4s infinite;
}
@keyframes pbShimmer {
  0%   { transform:translateX(-100%); }
  100% { transform:translateX(300%); }
}

/* ── Logs ── */
.sol-log { border-top:1px solid var(--b1);flex-shrink:0; }
.sol-lh {
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 14px 6px;cursor:pointer;user-select:none;
  transition:background .15s;
}
.sol-lh:hover { background:rgba(255,255,255,.02); }
.sol-ll {
  font-size:10px;font-weight:600;color:var(--t3);
  text-transform:uppercase;letter-spacing:1.2px;
  display:flex;align-items:center;gap:6px;
}
.sol-lcount {
  background:var(--s3);color:var(--t3);font-size:9px;font-weight:700;
  padding:1px 6px;border-radius:9px;
}
.sol-lclr {
  background:none;border:none;color:var(--t3);font-size:10.5px;
  cursor:pointer;padding:2px 7px;border-radius:5px;transition:color .15s;
}
.sol-lclr:hover { color:var(--red); }
.sol-lb {
  max-height:150px;overflow-y:auto;padding:4px 12px 10px;
  scrollbar-width:thin;scrollbar-color:var(--s3) transparent;
}
.sol-le {
  font-size:10.5px;font-family:'JetBrains Mono',monospace;
  padding:3px 6px 3px 9px;border-left:2px solid;
  border-radius:0 4px 4px 0;margin-bottom:3px;line-height:1.4;
  animation:logIn .18s ease both;
}
@keyframes logIn {
  from { opacity:0;transform:translateX(-5px); }
  to   { opacity:1;transform:translateX(0); }
}
.sol-le.info { border-color:rgba(99,102,241,.6);color:#a5b4fc;background:rgba(99,102,241,.04); }
.sol-le.ok   { border-color:rgba(16,185,129,.5);color:#6ee7b7;background:rgba(16,185,129,.04); }
.sol-le.warn { border-color:rgba(245,158,11,.5);color:#fcd34d;background:rgba(245,158,11,.04); }
.sol-le.err  { border-color:rgba(244,63,94,.5);color:#fda4af;background:rgba(244,63,94,.04); }

/* ── Modal Overlay ── */
.aa-ov {
  position:fixed;inset:0;background:rgba(4,5,14,.85);
  backdrop-filter:blur(14px);
  z-index:2147483647;display:flex;align-items:center;justify-content:center;
  animation:ovIn .2s ease both;
}
@keyframes ovIn {
  from { opacity:0; }
  to   { opacity:1; }
}

/* ── Modal ── */
.aa-modal {
  background:var(--s1);
  border:1px solid var(--b2);
  border-radius:18px;padding:26px 22px 20px;
  max-width:420px;width:92%;
  box-shadow:0 30px 90px rgba(0,0,0,.95),0 0 0 1px rgba(255,255,255,.05);
  animation:modalIn .25s cubic-bezier(.4,0,.2,1) both;
  position:relative;overflow:hidden;
}
.aa-modal::before {
  content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(99,102,241,.55),rgba(139,92,246,.45),transparent);
}
@keyframes modalIn {
  from { opacity:0;transform:scale(.95) translateY(10px); }
  to   { opacity:1;transform:scale(1) translateY(0); }
}
.aa-res-modal { max-width:460px;width:95%; }
.aa-m-ico { font-size:40px;text-align:center;margin-bottom:10px; }
.aa-m-ttl { font-size:15.5px;font-weight:700;text-align:center;margin-bottom:7px; }
.aa-m-msg { font-size:12.5px;color:var(--t2);text-align:center;line-height:1.6;margin-bottom:16px;white-space:pre-line; }
.aa-m-btns { display:flex;gap:8px; }
.aa-mb {
  flex:1;padding:11px;border-radius:9px;border:none;
  font-family:'Inter',sans-serif;font-weight:600;font-size:12.5px;
  cursor:pointer;transition:all .18s;position:relative;overflow:hidden;
}
.aa-mb.p {
  background:var(--grad);color:#fff;box-shadow:var(--grad-glow);
}
.aa-mb.p:hover { box-shadow:0 4px 24px rgba(99,102,241,.55);transform:translateY(-1px); }
.aa-mb.p:active { transform:translateY(0); }
.aa-mb.s { background:var(--s3);border:1px solid var(--b1);color:var(--t2); }
.aa-mb.s:hover { background:var(--s2);color:var(--t1); }
.aa-mb.d { background:var(--redlt);border:1px solid rgba(244,63,94,.3);color:#fda4af; }
.aa-mb.d:hover { background:rgba(244,63,94,.2); }

/* ── Result Summary ── */
.aa-res-sum { display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px; }
.aa-res-cell {
  background:var(--s2);border:1px solid var(--b1);
  border-radius:10px;padding:10px 6px;text-align:center;
}
.aa-res-val { font-size:22px;font-weight:700;font-family:'JetBrains Mono',monospace; }
.aa-res-lbl { font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-top:2px; }

/* ── Result Table ── */
.aa-rtable { width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:10px; }
.aa-rtable thead th { text-align:left;color:var(--t3);font-size:9.5px;font-weight:600;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid var(--b1); }
.aa-rtable tbody td { padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.03); }
.aa-rtable tbody tr.ok td   { background:rgba(16,185,129,.06); }
.aa-rtable tbody tr.fail td { background:rgba(244,63,94,.06); }
.tag-ok   { color:var(--green);font-weight:700;font-size:10.5px; }
.tag-fail { color:var(--red);font-weight:700;font-size:10.5px; }
`;
  document.head.appendChild(s);
}

// ═══ PAINEL ══════════════════════════════════════════
function buildPanel(){
  if(document.getElementById('__sol__'))return;
  if(!document.body)return setTimeout(buildPanel,10);
  const root=document.createElement('div');
  root.id='__sol__';
  root.classList.add('entering');

  // Subtítulo com data de hoje
  const hoje=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
  const hojeCapit=hoje.charAt(0).toUpperCase()+hoje.slice(1);

  root.innerHTML=
    '<div class="solh">' +
      '<div class="solh-l">' +
        '<div class="solh-ico">\u{1F4E4}</div>' +
        '<div><div class="solh-title">Solicitar Ativos</div><div class="solh-sub">v2 \u00B7 MAGALU</div></div>' +
      '</div>' +
      '<div class="solh-btns">' +
        '<button class="solh-btn" id="sol-min" title="Minimizar">\u2212</button>' +
        '<button class="solh-btn cb" id="sol-close" title="Fechar">\u2715</button>' +
      '</div>' +
    '</div>' +
    '<div class="sol-welcome">' +
      '<div class="sol-avatar" id="sol-wavatar">\u2726</div>' +
      '<div class="sol-welcome-text">' +
        '<div class="sol-welcome-name" id="sol-wname">Bem-vindo!</div>' +
        '<div class="sol-welcome-sub">'+hojeCapit+'</div>' +
      '</div>' +
    '</div>' +
    '<div class="sol-tok w" id="sol-tok">' +
      '<div class="sol-tok-dot"></div>' +
      '<span class="sol-tok-txt" id="sol-tok-txt">Aguardando token...</span>' +
    '</div>' +
    '<div class="sols">' +
      '<div class="sol-card">' +
        '<div class="sol-card-label">Modo de execu\u00e7\u00e3o</div>' +
        '<div class="sol-modo">' +
          '<button class="sol-modo-btn active" id="sol-modo-unico">Gemco \u00DAnico</button>' +
          '<button class="sol-modo-btn" id="sol-modo-filial">Gemco por Filial</button>' +
        '</div>' +
        '<div class="sol-card-label">Filiais de destino + quantidade</div>' +
        '<textarea class="sol-ta" id="sol-ta" rows="6" placeholder="550 1\n350 2\n123 3"></textarea>' +
        '<div class="sol-hints" id="sol-hints"><span class="sol-hint">550 1</span><span class="sol-hint">350 2</span><span class="sol-hint">123 5</span></div>' +
      '</div>' +
      '<div class="sol-card">' +
        '<div class="sol-card-label">Configura\u00e7\u00e3o</div>' +
        '<div class="sol-gemco-wrap" id="sol-gemco-wrap"><div class="sol-row"><input class="sol-inp" id="sol-gemco" placeholder="Gemco (ex: 2936932)"/></div></div>' +
        '<div class="sol-row">' +
          '<div class="sol-sel-wrap">' +
            '<select class="sol-sel" id="sol-origin"><option value="0038">Origem: CD38</option><option value="0991">Origem: CD991</option></select>' +
            '<span class="sol-sa">\u25BE</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="sol-btn sol-btn-run" id="sol-run">\u{1F680} Iniciar Solicita\u00e7\u00f5es</button>' +
      '<button class="sol-btn sol-btn-stop" id="sol-stop">\u23F9 Parar</button>' +
      '<div class="sol-div"></div>' +
      '<div class="sol-st" id="sol-st">Pronto para iniciar.</div>' +
      '<div class="sol-pw" id="sol-pw"><div class="sol-pb" id="sol-pb"></div></div>' +
    '</div>' +
    '<div class="sol-log">' +
      '<div class="sol-lh" id="sol-lh"><span class="sol-ll">Logs <span class="sol-lcount" id="sol-lc">0</span></span><button class="sol-lclr" id="sol-lclr">limpar</button></div>' +
      '<div class="sol-lb" id="sol-lb"><div class="sol-le info">Sistema pronto.</div></div>' +
    '</div>';

  document.body.appendChild(root);

  const tab=document.createElement('button');
  tab.id='__sol_tab__';tab.textContent='SOL';
  document.body.appendChild(tab);

  const setM=w=>document.body.style.setProperty('margin-right',w,'important');
  setM('340px');document.body.style.transition='margin-right .32s';

  document.getElementById('sol-close').onclick=e=>{e.stopPropagation();root.classList.add('off');tab.style.display='flex';setM('0');};
  tab.onclick=()=>{root.classList.remove('off');root.classList.add('entering');tab.style.display='none';setM('340px');};

  let mini=false;
  document.getElementById('sol-min').onclick=e=>{
    e.stopPropagation();mini=!mini;
    root.querySelectorAll('.sols,.sol-log,.sol-tok,.sol-welcome').forEach(el=>el.style.display=mini?'none':'');
    root.style.height=mini?'52px':'100vh';setM(mini?'0':'340px');
    document.getElementById('sol-min').textContent=mini?'\u25A1':'\u2212';
  };

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
  document.getElementById('sol-stop').onclick=()=>{S.stop=true;setSt('Parando...');log('Interrompido pelo usuário.','warn');};

  let logOpen=true;
  document.getElementById('sol-lh').onclick=()=>{logOpen=!logOpen;document.getElementById('sol-lb').style.display=logOpen?'':'none';};
  document.getElementById('sol-lclr').onclick=e=>{e.stopPropagation();document.getElementById('sol-lb').innerHTML='';_lc=0;document.getElementById('sol-lc').textContent='0';};

  setInterval(uiToken,8000);
  updateWelcome();
}

function uiToken(){
  const el=document.getElementById('sol-tok'),tx=document.getElementById('sol-tok-txt');
  if(!el||!tx)return;
  if(!getTok()){el.className='sol-tok w';tx.textContent='Aguardando token — fa\u00e7a qualquer a\u00e7\u00e3o no site';return;}
  if(_tokenSessaoExpirou){el.className='sol-tok w';tx.textContent='Sess\u00e3o expirou — clique em qualquer menu';return;}
  const m=tokMins();
  if(m!==null&&m<2){el.className='sol-tok ex';tx.textContent='Token expirando em '+m+'min...';}
  else{el.className='sol-tok ok';tx.textContent=m!==null?'Token ativo \u2014 '+m+' min restantes':'Token ativo';}
  updateWelcome();
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
    const tc=cfg.tipo==='err'?'#fda4af':cfg.tipo==='ok'?'#6ee7b7':cfg.tipo==='warn'?'#fcd34d':'#a5b4fc';
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
      const m=line.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
      if(m){result.push({filial:m[1],filialPad:pad(m[1]),qtd:parseInt(m[2]),gemco:m[3]});return;}
      const m2=line.match(/^(\d+)\s+(\d{5,})$/);
      if(m2){result.push({filial:m2[1],filialPad:pad(m2[1]),qtd:1,gemco:m2[2]});return;}
    } else {
      const m=line.match(/^(\d+)\s+(\d+)$/);
      if(m){result.push({filial:m[1],filialPad:pad(m[1]),qtd:parseInt(m[2])});return;}
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
    if(!gemcoUnico){await modal({tipo:'err',icone:'🔍',titulo:'Gemco não informado',mensagem:'Informe o código Gemco do produto.',btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  }

  if(!getTok()){await modal({tipo:'err',icone:'🔐',titulo:'Token não capturado',mensagem:'Faça qualquer ação no site primeiro.',btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  if(!jobs.length){
    const exemplo=modoPorFilial?'550 1 2936932\n350 2 1234567':'550 1\n350 2';
    await modal({tipo:'err',icone:'📝',titulo:'Nenhuma filial',mensagem:'Informe ao menos uma filial:\n'+exemplo,btns:[{t:'Ok',v:'ok',cls:'p'}]});return;
  }
  if(modoPorFilial){
    const semGemco=jobs.filter(j=>!j.gemco);
    if(semGemco.length){await modal({tipo:'err',icone:'🔍',titulo:'Gemco ausente',mensagem:'As linhas abaixo estão sem Gemco:\n'+semGemco.map(j=>'Filial '+j.filial).join('\n'),btns:[{t:'Ok',v:'ok',cls:'p'}]});return;}
  }

  const gruposMap={};
  const gruposOrdem=[];
  jobs.forEach(function(j){
    const key=j.filialPad;
    if(!gruposMap[key]){gruposMap[key]={filial:j.filial,filialPad:j.filialPad,assets:[]};gruposOrdem.push(key);}
    const gemco=modoUnico?gemcoUnico:j.gemco;
    const existing=gruposMap[key].assets.find(function(a){return a.itemCode===gemco;});
    if(existing){existing.amount+=j.qtd;}
    else{gruposMap[key].assets.push({itemCode:gemco,amount:j.qtd});}
  });
  const grupos=gruposOrdem.map(function(k){return gruposMap[k];});

  const preview=grupos.slice(0,5).map(function(g){
    return '- CD'+g.filial+': '+g.assets.map(function(a){return 'Gemco '+a.itemCode+' x'+a.amount;}).join(', ');
  }).join('\n')+(grupos.length>5?'\n... e mais '+(grupos.length-5):'');
  const agrupouLabel=grupos.length<jobs.length?' ('+jobs.length+' linhas → '+grupos.length+' sols)':'';
  const conf=await modal({icone:'📤',tipo:'info',titulo:'Confirmar Solicitações',mensagem:'Origem: CD'+norm(origin)+'\nSolicitações: '+grupos.length+agrupouLabel+'\n\n'+preview,btns:[{t:'Cancelar',v:'n',cls:'d'},{t:'Iniciar',v:'s',cls:'p'}]});
  if(conf!=='s')return;

  Object.assign(S,{running:true,stop:false,results:[],startTime:Date.now()});
  document.getElementById('sol-run').style.display='none';
  document.getElementById('sol-stop').style.display='flex';
  setProg(5);log('Iniciando '+grupos.length+' solicitações'+(agrupouLabel?' '+agrupouLabel:''),'info');

  for(let i=0;i<grupos.length;i++){
    if(S.stop)break;
    const grupo=grupos[i];
    const assetsDesc=grupo.assets.map(function(a){return a.itemCode+' x'+a.amount;}).join(' + ');
    setSt('Solicitação '+(i+1)+'/'+grupos.length+' — Filial '+grupo.filial);
    setProg(5+Math.round(i/grupos.length*88));
    log('Filial '+grupo.filial+' — '+assetsDesc+'...','info');
    try{
      const criada=await req('POST','/v1/solicitations/branch',{origin:'',destiny:grupo.filialPad,receivingBranch:{code:'',complement:'',number:'',postalCode:'',publicPlace:''},observation:''});
      if(!criada||!criada.solicitationId)throw new Error('API não retornou solicitationId');
      const solId=criada.solicitationId;
      await req('POST','/v1/solicitations/branch/'+solId+'/asset',{assets:grupo.assets});
      await req('PATCH','/v1/solicitations/branch/'+solId,{observation:'',origin:origin,status:'CREATED'});
      S.results.push({filial:grupo.filial,assets:grupo.assets,solId:solId,status:'ok'});
      log('OK Filial '+grupo.filial+' — Sol #'+solId+' ('+grupo.assets.length+' item(s))','ok');
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
  document.getElementById('sol-run').style.display='flex';
  document.getElementById('sol-stop').style.display='none';
  setProg(100);setTimeout(function(){setProg(null);},600);
  setSt(S.stop?'Interrompido.':'Processo finalizado! ✓',false);
  await modalResultado(gemcoUnico,origin,modoPorFilial);
}

async function modalResultado(gemcoUnico,origin,modoPorFilial){
  const oks=S.results.filter(function(r){return r.status==='ok';});
  const fails=S.results.filter(function(r){return r.status==='fail';});
  let tab='<table class="aa-rtable"><thead><tr><th>Filial</th><th>Itens</th><th>Sol.</th><th>Status</th></tr></thead><tbody>';
  [...oks,...fails].forEach(function(r){
    const itensDesc=r.assets.map(function(a){return '<span style="font-size:9.5px;color:var(--t2)">'+a.itemCode+' x'+a.amount+'</span>';}).join('<br>');
    tab+='<tr class="'+(r.status==='ok'?'ok':'fail')+'"><td><strong>'+r.filial+'</strong></td><td>'+itensDesc+'</td><td style="font-size:10px">'+(r.solId||'-')+'</td><td>'+(r.status==='ok'?'<span class="tag-ok">OK</span>':'<span class="tag-fail">Falhou</span>')+'</td></tr>';
    if(r.status==='fail')tab+='<tr class="fail"><td colspan="4" style="font-size:9.5px;color:#fda4af;padding:2px 8px 6px">'+r.motivo+'</td></tr>';
  });
  tab+='</tbody></table>';
  const gemcoLabel=modoPorFilial?'(por filial)':gemcoUnico;
  const v=await modal({
    icone:fails.length===0?'🎉':'⚠️',
    titulo:fails.length===0?'Todas criadas com sucesso!':'Concluído com erros',
    tipo:fails.length===0?'ok':'warn',
    wide:'aa-res-modal',
    html:'<div class="aa-res-sum">'+
      '<div class="aa-res-cell"><div class="aa-res-val" style="color:#a5b4fc">'+S.results.length+'</div><div class="aa-res-lbl">Solicitações</div></div>'+
      '<div class="aa-res-cell"><div class="aa-res-val" style="color:var(--green)">'+oks.length+'</div><div class="aa-res-lbl">OK</div></div>'+
      '<div class="aa-res-cell"><div class="aa-res-val" style="color:'+(fails.length?'var(--red)':'var(--green)')+'">'+fails.length+'</div><div class="aa-res-lbl">Falhas</div></div>'+
      '</div>'+
      '<div style="font-size:10.5px;color:var(--t3);text-align:center;margin-bottom:10px">Gemco: '+gemcoLabel+' · Origem: CD'+norm(origin)+'</div>'+
      '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--b1);border-radius:8px;margin-bottom:12px;">'+tab+'</div>',
    btns:[{t:'Copiar',v:'copy',cls:'s'},{t:'Fechar',v:'close',cls:'p'}]
  });
  if(v==='copy'){
    const lines=['SOLICITAÇÕES - '+new Date().toLocaleString('pt-BR'),'Gemco: '+gemcoLabel+' | Origem: CD'+norm(origin),'Total: '+S.results.length+' | OK: '+oks.length+' | Falhas: '+fails.length,''];
    S.results.forEach(function(r){
      const itens=r.assets.map(function(a){return a.itemCode+' x'+a.amount;}).join(', ');
      lines.push(r.status==='ok'?'OK Filial '+r.filial+' ['+itens+'] Sol#'+r.solId:'ERRO Filial '+r.filial+' ['+itens+'] '+r.motivo);
    });
    navigator.clipboard.writeText(lines.join('\n'));
  }
}

// ═══ INIT ════════════════════════════════════════════
injectCSS();
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(buildPanel,600);});}
else{setTimeout(buildPanel,600);}
syncTok();

})();
