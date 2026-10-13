import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

/**
 * Embed de Cal para sitios de terceros:
 *   <script src="https://zerosoft.ai/api/calendar/embed.js" data-url="https://zerosoft.ai/en/book/ana/intro" async></script>
 * data-mode="inline" (default): iframe en el lugar del script, alto automático.
 * data-mode="popup": botón flotante (data-label) que abre la reserva en un modal.
 * El iframe avisa su alto y cuándo se confirmó la reserva vía postMessage.
 */
const SCRIPT = `(function () {
  var script = document.currentScript;
  if (!script) return;
  var url = script.getAttribute('data-url');
  if (!url) return;
  var mode = script.getAttribute('data-mode') || 'inline';
  var label = script.getAttribute('data-label') || 'Book a meeting';
  var color = script.getAttribute('data-color') || '#0d0d0d';
  var origin;
  try { origin = new URL(url).origin; } catch (e) { return; }
  var src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'embed=1';

  function frame(height) {
    var f = document.createElement('iframe');
    f.src = src;
    f.title = label;
    f.loading = 'lazy';
    f.style.cssText = 'width:100%;border:0;display:block;height:' + height + 'px;color-scheme:light;';
    f.setAttribute('allow', 'clipboard-write');
    return f;
  }

  function onMessage(f, done) {
    window.addEventListener('message', function (e) {
      if (e.origin !== origin || e.source !== f.contentWindow || !e.data) return;
      if (e.data.type === 'zs-cal:height' && mode === 'inline') f.style.height = Math.ceil(e.data.height) + 'px';
      if (e.data.type === 'zs-cal:booked') {
        try { script.dispatchEvent(new CustomEvent('zs-cal:booked', { detail: e.data, bubbles: true })); } catch (x) {}
        if (done) done();
      }
    });
  }

  if (mode === 'inline') {
    var f = frame(720);
    script.parentNode.insertBefore(f, script);
    onMessage(f);
    return;
  }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;padding:12px 18px;border:0;border-radius:999px;font:500 14px/1 system-ui,sans-serif;color:#fff;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.18);background:' + color;
  btn.onclick = function () {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;max-width:900px;height:min(760px,92vh);background:#fff;border-radius:16px;overflow:hidden;';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.style.cssText = 'position:absolute;top:8px;right:12px;z-index:1;border:0;background:transparent;font:28px/1 system-ui,sans-serif;cursor:pointer;';
    var f = frame(0);
    f.style.height = '100%';
    function shut() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') shut(); }
    close.onclick = shut;
    overlay.onclick = function (e) { if (e.target === overlay) shut(); };
    document.addEventListener('keydown', esc);
    box.appendChild(close);
    box.appendChild(f);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    onMessage(f);
  };
  (document.body || document.documentElement).appendChild(btn);
})();
`;

export function GET() {
  return new NextResponse(SCRIPT, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
