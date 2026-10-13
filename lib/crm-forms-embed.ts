/**
 * Embed de formularios del CRM para sitios de terceros:
 *   <script src="https://zerosoft.ai/api/crm/forms/embed.js" data-form="<slug|token>" async></script>
 * Inserta un iframe con /<locale>/f/<key>?embed=1 en el lugar del script, le
 * pasa los UTM / gclid / fbclid y la URL de la página que lo contiene, y
 * ajusta el alto con postMessage (zs-form:height). Al enviarse emite el evento
 * DOM `zs-form:submitted` en el <script> y, si el form redirige, navega la
 * página contenedora (el iframe no puede hacerlo sin activación del usuario).
 * Mismo enfoque que el embed de Cal (app/api/calendar/embed.js).
 */
export const FORM_EMBED_SCRIPT = `(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-form');
  if (!key || !/^[a-z0-9-]{2,62}$/i.test(key)) return;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { return; }
  var locale = script.getAttribute('data-locale');
  if (locale !== 'es' && locale !== 'pt') locale = 'en';
  var params = new URLSearchParams();
  params.set('embed', '1');
  try {
    var here = new URL(window.location.href);
    here.searchParams.forEach(function (v, k) {
      if (/^(utm_[a-z]+|gclid|fbclid)$/.test(k)) params.set(k, v.slice(0, 300));
    });
    params.set('page_url', window.location.href.slice(0, 1500));
    if (document.referrer) params.set('ref', document.referrer.slice(0, 500));
  } catch (e) {}
  var f = document.createElement('iframe');
  f.src = origin + '/' + locale + '/f/' + encodeURIComponent(key) + '?' + params.toString();
  f.title = script.getAttribute('data-title') || 'Form';
  f.loading = 'lazy';
  f.setAttribute('data-zs-form', key);
  f.style.cssText = 'width:100%;border:0;display:block;height:480px;color-scheme:light;background:transparent;';
  script.parentNode.insertBefore(f, script);
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'zs-form:height' && typeof e.data.height === 'number') {
      f.style.height = Math.ceil(Math.min(e.data.height, 10000)) + 'px';
    }
    if (e.data.type === 'zs-form:submitted') {
      try { script.dispatchEvent(new CustomEvent('zs-form:submitted', { detail: e.data, bubbles: true })); } catch (x) {}
      if (typeof e.data.redirectUrl === 'string' && /^https?:\\/\\//i.test(e.data.redirectUrl)) {
        window.location.href = e.data.redirectUrl;
      }
    }
  });
})();
`;
