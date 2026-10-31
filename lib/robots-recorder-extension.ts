/**
 * Robots — extensión de Chrome del grabador, armada al vuelo y bajada como .zip.
 *
 * El bookmarklet hay que volver a tocarlo en cada página y la CSP del sitio
 * puede frenar el envío. La extensión lo inyecta sola en cada carga de la
 * pestaña que se está grabando, en su mundo aislado (la CSP de la página no le
 * frena el fetch), y lleva los pasos de una página a la otra.
 */
import { buildRecorderScript, type RecorderLabels } from './robots-recorder';

export interface RecorderPopupLabels {
  title: string;
  code: string;
  url: string;
  start: string;
  stop: string;
  active: string;
  invalid: string;
}

const BACKGROUND = `
async function current() { return (await chrome.storage.session.get('rec')).rec || null; }
async function inject(tabId, rec) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (c) => { window.__zsRecCfg = c; }, args: [{ url: rec.url, token: rec.token, state: rec.state || null }] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['recorder.js'] });
}
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const rec = await current();
  if (rec && rec.tabId === tabId) inject(tabId, rec).catch(() => {});
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await current();
  if (rec && rec.tabId === tabId) await chrome.storage.session.remove('rec');
});
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.zsState) {
      const rec = await current();
      if (rec && sender.tab && rec.tabId === sender.tab.id) await chrome.storage.session.set({ rec: { ...rec, state: msg.zsState } });
    } else if (msg.zsStop) {
      await chrome.storage.session.remove('rec');
    } else if (msg.zsStart) {
      const tab = await chrome.tabs.create({ url: msg.zsStart.startUrl });
      await chrome.storage.session.set({ rec: { url: msg.zsStart.url, token: msg.zsStart.token, tabId: tab.id, state: null } });
    } else if (msg.zsStatus) {
      reply({ active: !!(await current()) });
      return;
    }
    reply({ ok: true });
  })();
  return true;
});
`;

const POPUP_JS = `
const code = document.getElementById('code');
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const url = document.getElementById('url');
const msg = document.getElementById('msg');
function show(active) { start.hidden = active; stop.hidden = !active; code.disabled = active; url.disabled = active; if (active) msg.textContent = LABELS.active; }
chrome.runtime.sendMessage({ zsStatus: true }, (r) => show(!!(r && r.active)));
start.addEventListener('click', () => {
  const parts = code.value.trim().split('#');
  let ok = parts.length === 2 && parts[1].length > 10;
  let startUrl = url.value.trim();
  try { ok = ok && /^https?:$/.test(new URL(parts[0]).protocol) && /^https?:$/.test(new URL(startUrl).protocol); } catch (e) { ok = false; }
  if (!ok) { msg.textContent = LABELS.invalid; return; }
  chrome.runtime.sendMessage({ zsStart: { url: parts[0], token: parts[1], startUrl } }, () => window.close());
});
stop.addEventListener('click', () => chrome.runtime.sendMessage({ zsStop: true }, () => show(false)));
`;

function popupHtml(l: RecorderPopupLabels): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px/1.4 system-ui,sans-serif;width:280px;margin:12px;color:#111}label{display:block;margin:8px 0 2px}
input{width:100%;box-sizing:border-box;padding:6px;border:1px solid #bbb;border-radius:4px;font:inherit}
button{margin-top:10px;padding:6px 10px;border:1px solid #111;border-radius:4px;background:#111;color:#fff;font:inherit;cursor:pointer}
button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:1px}p{margin:8px 0 0}</style></head><body>
<strong>${esc(l.title)}</strong>
<label for="code">${esc(l.code)}</label><input id="code" autocomplete="off">
<label for="url">${esc(l.url)}</label><input id="url" type="url" placeholder="https://">
<button id="start">${esc(l.start)}</button><button id="stop" hidden>${esc(l.stop)}</button>
<p id="msg" role="status"></p><script src="labels.js"></script><script src="popup.js"></script></body></html>`;
}

/** Archivos de la extensión (ruta → contenido). */
export function recorderExtensionFiles(labels: RecorderLabels, popup: RecorderPopupLabels): Record<string, string> {
  return {
    'manifest.json': JSON.stringify(
      {
        manifest_version: 3,
        name: 'zerosoft Robots recorder',
        version: '1.0.0',
        description: popup.title,
        action: { default_popup: 'popup.html', default_title: popup.title },
        background: { service_worker: 'background.js' },
        permissions: ['scripting', 'storage'],
        host_permissions: ['http://*/*', 'https://*/*'],
      },
      null,
      2,
    ),
    'background.js': BACKGROUND,
    'recorder.js': buildRecorderScript(labels),
    'popup.html': popupHtml(popup),
    'popup.js': POPUP_JS,
    'labels.js': `const LABELS = ${JSON.stringify({ active: popup.active, invalid: popup.invalid })};\n`,
  };
}

// ---------- .zip sin compresión (alcanza para unos pocos archivos de texto) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function storedZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(files).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export function recorderExtensionZip(labels: RecorderLabels, popup: RecorderPopupLabels): Buffer {
  return storedZip(recorderExtensionFiles(labels, popup));
}
