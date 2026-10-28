/*
 * zerosoft Link: conversiones. Pegalo en tu sitio (el destino de tus links):
 *   <script src="https://zerosoft.ai/link-tracking.js" defer></script>
 * Si la visita llega con ?zs_id=<click id>, lo guarda 90 días en una cookie
 * de tu propio dominio (zs_id). Al registrar un lead o una venta desde tu
 * servidor, leé esa cookie y mandala como clickId a
 * POST /api/v1/links/track/lead. En el navegador: window.zsLink.clickId().
 * No manda nada a zerosoft ni pone cookies de terceros.
 */
(function () {
  var NAME = 'zs_id';
  var RE = /^[A-Za-z0-9]{16,32}$/;
  function read() {
    var m = document.cookie.match(/(?:^|;\s*)zs_id=([^;]+)/);
    return m && RE.test(m[1]) ? m[1] : null;
  }
  try {
    var id = new URLSearchParams(window.location.search).get(NAME);
    if (id && RE.test(id)) {
      var secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = NAME + '=' + id + '; Max-Age=7776000; Path=/; SameSite=Lax' + secure;
    }
  } catch (e) {
    /* sin cookies: no pasa nada */
  }
  window.zsLink = { clickId: read };
})();
