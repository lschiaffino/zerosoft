/**
 * Embed de formularios (motor común: CRM y la app Forms comparten /f/<key>):
 *   <script src="https://zerosoft.ai/api/forms/embed.js" data-form="<slug|token>" async></script>
 * Inserta un iframe con /<locale>/f/<key>?embed=1 en el lugar del script, le
 * pasa los UTM / gclid / fbclid (y los parámetros de data-params, para los
 * campos ocultos de Forms) y la URL de la página que lo contiene, y ajusta el
 * alto con postMessage (zs-form:height). Al enviarse emite el evento DOM
 * `zs-form:submitted` en el <script> y, si el form redirige, navega la página
 * contenedora (el iframe no puede hacerlo sin activación del usuario).
 *
 * data-mode="popup": en vez del iframe en línea pone un botón (data-button)
 * que abre el formulario en una ventana encima de la página; Esc o la X la
 * cierran (también Esc con el foco dentro del formulario, que avisa con
 * zs-form:close), el foco queda atrapado en la ventana y vuelve al botón.
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
  var extra = (script.getAttribute('data-params') || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return /^[a-z0-9_]{1,40}$/i.test(s); });
  var params = new URLSearchParams();
  params.set('embed', '1');
  try {
    var here = new URL(window.location.href);
    here.searchParams.forEach(function (v, k) {
      if (/^(utm_[a-z]+|gclid|fbclid)$/.test(k) || extra.indexOf(k) >= 0) params.set(k, v.slice(0, 300));
    });
    params.set('page_url', window.location.href.slice(0, 1500));
    if (document.referrer) params.set('ref', document.referrer.slice(0, 500));
  } catch (e) {}
  var popup = script.getAttribute('data-mode') === 'popup';
  if (popup) params.set('popup', '1');
  var f = document.createElement('iframe');
  f.src = origin + '/' + locale + '/f/' + encodeURIComponent(key) + '?' + params.toString();
  f.title = script.getAttribute('data-title') || 'Form';
  f.loading = 'lazy';
  f.setAttribute('data-zs-form', key);
  f.style.cssText = 'width:100%;border:0;display:block;height:480px;color-scheme:light;background:transparent;';
  var overlay = null;
  var button = null;
  function closePopup() {
    if (!overlay) return;
    overlay.style.display = 'none';
    if (button) button.focus();
  }
  if (popup) {
    button = document.createElement('button');
    button.type = 'button';
    button.textContent = script.getAttribute('data-button') || 'Open form';
    button.setAttribute('data-zs-form-button', key);
    button.style.cssText = 'font:inherit;padding:10px 16px;border:0;border-radius:4px;background:#111;color:#fff;cursor:pointer;';
    script.parentNode.insertBefore(button, script);
    overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', f.title);
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px;';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;max-width:720px;height:min(640px,90vh);background:#fff;border-radius:6px;overflow:hidden;';
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.style.cssText = 'position:absolute;top:6px;right:8px;z-index:1;border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#333;';
    x.addEventListener('click', closePopup);
    f.style.height = '100%';
    box.appendChild(x);
    box.appendChild(f);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePopup(); });
    // Foco atrapado: con la ventana abierta, el foco no sale a la página de atrás.
    document.addEventListener('focusin', function (e) { if (overlay.style.display === 'flex' && !overlay.contains(e.target)) x.focus(); });
    button.addEventListener('click', function () {
      if (!overlay.parentNode) document.body.appendChild(overlay);
      overlay.style.display = 'flex';
      x.focus();
    });
  } else {
    script.parentNode.insertBefore(f, script);
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'zs-form:height' && typeof e.data.height === 'number' && !popup) {
      f.style.height = Math.ceil(Math.min(e.data.height, 10000)) + 'px';
    }
    if (e.data.type === 'zs-form:close') closePopup();
    if (e.data.type === 'zs-form:submitted') {
      try { script.dispatchEvent(new CustomEvent('zs-form:submitted', { detail: e.data, bubbles: true })); } catch (x) {}
      if (typeof e.data.redirectUrl === 'string' && /^https?:\\/\\//i.test(e.data.redirectUrl)) {
        window.location.href = e.data.redirectUrl;
      }
    }
  });
})();
`;
