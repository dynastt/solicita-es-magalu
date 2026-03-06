// Roda em world: MAIN — mesmo contexto da página
// Intercepta fetch/XHR e expõe o token via window.__MGT__
(function(){
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    const h = init.headers || {};
    const auth = h.Authorization || h.authorization || '';
    if(auth) {
      const full = auth.startsWith('Bearer ') ? auth : 'Bearer ' + auth;
      window.__MGT__ = full;
      window.__MGTS__ = Date.now();
      window.dispatchEvent(new CustomEvent('__mgt__', {detail: full}));
    }
    return origFetch.apply(this, arguments);
  };

  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(k, v) {
    if(k.toLowerCase() === 'authorization' && v) {
      const full = v.startsWith('Bearer ') ? v : 'Bearer ' + v;
      window.__MGT__ = full;
      window.__MGTS__ = Date.now();
      window.dispatchEvent(new CustomEvent('__mgt__', {detail: full}));
    }
    return origSet.call(this, k, v);
  };
})();
