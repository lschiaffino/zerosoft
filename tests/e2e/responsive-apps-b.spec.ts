import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

/**
 * Celular: Rec, Voice, Notes, Talk, Books, People, Hiring, Sign, Shop, Forms, Send,
 * Social, Flow, Agents y Robots, más las páginas públicas que exponen (video
 * compartido, formulario, empleos, tienda). Recorre cada pantalla a 390 y 360 de
 * ancho y abre los menús y diálogos que encuentra: nada puede generar scroll
 * horizontal, quedar fuera de la pantalla ni usar campos de menos de 16px (iOS
 * hace zoom). Con RESP_AUDIT=<carpeta> recorre además 768 y oscuro, guarda
 * capturas y un informe JSON sin fallar (es la herramienta de la pasada visual).
 */

const AUDIT = process.env.RESP_AUDIT || '';
const APPS = ['rec', 'voice', 'notes', 'talk', 'books', 'people', 'hiring', 'sign', 'shop', 'forms', 'send', 'social', 'flow', 'agents', 'robots'];
const VIEWPORTS = AUDIT
  ? [
      { name: '390', width: 390, height: 844 },
      { name: '360', width: 360, height: 740 },
      { name: '768', width: 768, height: 1024 },
    ]
  : [
      { name: '390', width: 390, height: 844 },
      { name: '360', width: 360, height: 740 },
    ];
const SCHEMES: Array<'light' | 'dark'> = AUDIT ? ['light', 'dark'] : ['light'];

const uid = () => Math.random().toString(36).slice(2, 8);

type Issue = { kind: string; detail: string };
type Finding = { url: string; vp: string; scheme: string; overlay?: string; issues: Issue[]; shot?: string };

async function json<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T | null> {
  try {
    const r = await res;
    if (!r.ok()) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Una cosa de cada app, para que existan las pantallas de detalle y las públicas. */
async function seed(request: APIRequestContext): Promise<string[]> {
  const urls: string[] = [];
  const t = `Responsive ${uid()} con un título bastante largo para ver cómo corta`;
  const rec = await json<{ video: { id: string; shareId: string } }>(request.post('/api/rec/videos', { data: { title: t, mode: 'camera', contentType: 'video/webm' } }));
  if (rec) {
    const body = Buffer.alloc(2048, 1);
    await request.put(`/api/rec/videos/${rec.video.id}/parts?kind=video&n=1`, { data: body, headers: { 'content-type': 'application/octet-stream' } });
    await request.post(`/api/rec/videos/${rec.video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } });
    await request.post(`/api/rec/videos/${rec.video.id}/finalize`, { data: { durationSec: 3 } });
    urls.push(`/en/app/rec/${rec.video.id}`, `/en/v/${rec.video.shareId}`);
  }
  const voice = await json<{ id: string }>(request.post('/api/voice/sessions', { data: { title: t } }));
  if (voice) urls.push(`/en/app/voice/meetings/${voice.id}`);
  const note = await json<{ id: string }>(request.post('/api/notes', { data: { title: t, content: [{ id: crypto.randomUUID(), type: 'paragraph', content: 'Una nota con un link https://example.com/a/very/long/path/that/should/wrap' }] } }));
  if (note) urls.push(`/en/app/notes?note=${note.id}`);
  const ch = await json<{ id: string }>(request.post('/api/talk/channels', { data: { name: `resp-${uid()}`, kind: 'public' } }));
  if (ch) {
    await request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'Un mensaje con un link https://example.com/a/very/long/path/that/should/wrap/inside/the/bubble' } });
    urls.push(`/en/app/talk/${ch.id}`);
  }
  const emp = await json<{ employee: { id: string } }>(request.post('/api/people/employees', { data: { name: `Persona ${uid()} Apellidolargo`, jobTitle: 'Head of Design' } }));
  if (emp) urls.push(`/en/app/people/employees/${emp.employee.id}`);
  const job = await json<{ job: { id: string } }>(request.post('/api/hiring/jobs', { data: { title: `Support ${uid()}`, template: 'customer-support' } }));
  if (job) {
    await request.patch(`/api/hiring/jobs/${job.job.id}`, { data: { status: 'published' } });
    await request.put('/api/hiring/settings', { data: { published: true } });
    const s = await json<{ settings: { handle: string } }>(request.get('/api/hiring/settings'));
    if (s) urls.push(`/careers/${s.settings.handle}`);
    urls.push(`/en/app/hiring/jobs/${job.job.id}`);
  }
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) pdfDoc.addPage([612, 792]).drawText(`Services agreement, page ${i + 1}`, { x: 60, y: 720, size: 14 });
  const pdf = Buffer.from(await pdfDoc.save());
  const env = await json<{ envelope: { id: string } }>(request.post('/api/sign/envelopes', { data: { title: t } }));
  if (env) {
    const id = env.envelope.id;
    urls.push(`/en/app/sign/envelopes/${id}`);
    // Un sobre enviado: su página pública de firma sale del email (lib/email.ts escribe E2E_MAIL_FILE).
    const signer = `firma-${uid()}@example.com`;
    await request.post(`/api/sign/envelopes/${id}/document`, { multipart: { file: { name: 'doc.pdf', mimeType: 'application/pdf', buffer: pdf } } });
    const rec = await json<{ envelope: { recipients: Array<{ id: string }> } }>(request.put(`/api/sign/envelopes/${id}/recipients`, { data: { recipients: [{ role: 'signer', name: 'Ana Firmante', email: signer, routingOrder: 1 }] } }));
    if (rec) {
      const fields = rec.envelope.recipients.map((r) => ({ recipientId: r.id, kind: 'signature', page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.06 }));
      await request.put(`/api/sign/envelopes/${id}/fields`, { data: { fields } });
      await request.post(`/api/sign/envelopes/${id}/actions`, { data: { action: 'send' } });
      const mailFile = process.env.E2E_MAIL_FILE;
      for (let i = 0; i < 20 && mailFile; i++) {
        const text = fs.existsSync(mailFile) ? fs.readFileSync(mailFile, 'utf8') : '';
        const line = text.split('\n').reverse().find((l) => l.includes(signer));
        const m = line && /\/(?:en|es|pt)(\/sign\/[A-Za-z0-9_-]{43})/.exec(line);
        if (m) {
          urls.push(`/en${m[1]}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  const sendDoc = await json<{ document: { id: string }; version: { id: string } }>(request.post('/api/send/documents', { data: { title: t, file: { name: 'deck.pdf', mime: 'application/pdf', size: pdf.length } } }));
  if (sendDoc) {
    await request.put(`/api/send/versions/${sendDoc.version.id}/parts/0`, { data: pdf, headers: { 'content-type': 'application/octet-stream' } });
    await request.post(`/api/send/versions/${sendDoc.version.id}/complete`, { data: {} });
    for (let i = 0; i < 30; i++) {
      const v = await json<{ version: { status: string } }>(request.post(`/api/send/versions/${sendDoc.version.id}/process`));
      if (!v || v.version.status !== 'processing') break;
    }
    urls.push(`/en/app/send/documents/${sendDoc.document.id}`);
    const link = await json<{ link: { path: string } }>(request.post(`/api/send/documents/${sendDoc.document.id}/links`, { data: { name: 'Responsive' } }));
    if (link) urls.push(`/en${link.link.path}`);
  }
  await request.put('/api/shop/payments', { data: { manual: { enabled: true, instructions: 'Bank 123' } } });
  await request.post('/api/shop/products', { data: { title: `Producto ${uid()} con un nombre largo que tiene que cortar bien`, status: 'active', variants: [{ options: [], priceCents: 999, initialStock: 3 }] } });
  await request.patch('/api/shop/store', { data: { published: true } });
  const store = await json<{ store: { handle: string } }>(request.get('/api/shop/store'));
  if (store) urls.push(`/store/${store.store.handle}`, `/store/${store.store.handle}/cart`, `/store/${store.store.handle}/checkout`);
  const form = await json<{ form: { id: string; slug: string } }>(request.post('/api/forms', { data: { name: `Contacto ${uid()}`, template: 'contact' } }));
  if (form) {
    await request.patch(`/api/forms/${form.form.id}`, { data: { status: 'published' } });
    urls.push(`/en/f/${form.form.slug}`);
  }
  await request.post('/api/social/connect', { data: { network: 'facebook' } });
  await request.post('/api/social/posts', { data: { text: `Borrador ${uid()}`, accountIds: [], action: 'draft' } });
  const flow = await json<{ id?: string; flow?: { id: string } }>(request.post('/api/flow/flows', { data: { name: `Flow ${uid()}`, template: 'leadToCrmSlack' } }));
  const flowId = flow?.id ?? flow?.flow?.id;
  if (flowId) urls.push(`/en/app/flow/${flowId}`);
  const agent = await json<{ id: string }>(request.post('/api/agents', { data: { name: `Agente ${uid()}` } }));
  if (agent) urls.push(`/en/app/agents/${agent.id}`);
  const robot = await json<{ id: string }>(request.post('/api/robots', { data: { name: `Robot ${uid()}`, template: 'booksCatalog' } }));
  if (robot) urls.push(`/en/app/robots/${robot.id}`);
  return urls;
}

/** Links internos de la app que se ven en la pantalla (sidebar, pestañas, filas). */
async function appLinks(page: Page, prefix: string, max: number): Promise<string[]> {
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') || ''));
  const out = new Map<string, string>();
  for (const h of hrefs) {
    const p = h.split('#')[0];
    if (!p.startsWith(prefix)) continue;
    // Una sola variante por ruta: ?tab=x cuenta como otra pantalla, el resto de la query no (días del calendario).
    const [pathname, query = ''] = p.split('?');
    const tab = new URLSearchParams(query).get('tab');
    const key = `${pathname}${tab ? `?tab=${tab}` : ''}`;
    if (!out.has(key)) out.set(key, p);
    if (out.size >= max) break;
  }
  return [...out.values()];
}

/** Los chequeos de la pantalla actual (página u overlay abierto). */
async function check(page: Page, scope: string | null): Promise<Issue[]> {
  return page.evaluate((scopeSel) => {
    const issues: { kind: string; detail: string }[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const desc = (el: Element) => {
      const c = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${label ? ` "${label}"` : ''}`;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // Dentro de algo que scrollea o recorta en horizontal: ahí salirse es esperable.
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
          const r = p.getBoundingClientRect();
          if (r.right <= vw + 1 && r.left >= -1) return true;
        }
        if (s.position === 'fixed' && (p.getBoundingClientRect().right <= 0 || p.getBoundingClientRect().left >= vw)) return true;
      }
      return false;
    };
    const root = scopeSel ? document.querySelector(scopeSel) : document.body;
    if (!root) return issues;
    if (!scopeSel) {
      const sw = document.scrollingElement!.scrollWidth;
      if (sw > vw + 1) issues.push({ kind: 'hscroll', detail: `${sw} > ${vw}` });
    } else {
      const r = root.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1 || r.top < -1) issues.push({ kind: 'overlay-offscreen', detail: `${desc(root)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]` });
      if (r.bottom > vh + 1 && getComputedStyle(root).overflowY === 'visible') issues.push({ kind: 'overlay-below-fold', detail: `${desc(root)} bottom ${Math.round(r.bottom)} > ${vh}` });
    }
    const off: string[] = [];
    const small: string[] = [];
    const zoom: string[] = [];
    for (const el of Array.from(root.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], h1, h2, h3, p, label, img, video, table'))) {
      if (!visible(el)) continue;
      // Lo que está debajo de un overlay abierto no cuenta en la pasada del overlay.
      if (!scopeSel && el.closest('dialog[open], [role="dialog"], [role="menu"], [role="listbox"]')) continue;
      const r = el.getBoundingClientRect();
      // Lo que está entero fuera de la pantalla es a propósito (saltar al contenido, honeypots); lo que asoma cortado, no.
      const straddles = (r.left < -1 && r.right > 0) || (r.right > vw + 1 && r.left < vw);
      if (straddles && !clipped(el)) off.push(desc(el));
      const tag = el.tagName;
      const interactive = /^(BUTTON|SELECT)$/.test(tag) || (tag === 'INPUT' && !/^(checkbox|radio|hidden|range|color|file)$/.test((el as HTMLInputElement).type)) || el.matches('[role="button"],[role="tab"],[role="menuitem"]') || (tag === 'A' && !el.closest('p, li > p, .prose, article'));
      if (interactive && (r.height < 40 && r.width < 40 || r.height < 28) && !el.closest('[aria-hidden="true"]')) small.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || el.getAttribute('contenteditable') === 'true') {
        const type = (el as HTMLInputElement).type;
        if (!/^(checkbox|radio|hidden|range|color|file|submit|button)$/.test(type) && parseFloat(getComputedStyle(el).fontSize) < 16) zoom.push(`${desc(el)} ${getComputedStyle(el).fontSize}`);
      }
    }
    if (off.length) issues.push({ kind: 'offscreen', detail: off.slice(0, 6).join(' | ') + (off.length > 6 ? ` (+${off.length - 6})` : '') });
    if (zoom.length) issues.push({ kind: 'input-zoom', detail: zoom.slice(0, 6).join(' | ') + (zoom.length > 6 ? ` (+${zoom.length - 6})` : '') });
    if (small.length) issues.push({ kind: 'tap-small', detail: small.slice(0, 8).join(' | ') + (small.length > 8 ? ` (+${small.length - 8})` : '') });
    return issues;
  }, scope);
}

/** Lo que abre un overlay: menús, compartir, nuevo, filtros, más acciones. */
const TRIGGER = /share|compart|more|options|actions|filter|sort|new|create|add|invite|menu|settings|export|download|record|upload|import|\+|⋯|…/i;

async function overlayTriggers(page: Page): Promise<number> {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    let n = 0;
    const risky = /delete|remove|archive|discard|offboard|sign out|log out|leave|revoke|disconnect|void|cancel|close|publish|send|save|submit|start|stop|record|upload|import|copy|approve|reject|decline|run|test|apply|update|refresh|connect|borrar|eliminar/i;
    // El contenido de la app y las páginas públicas; la banda, el sidebar y el asistente los recorre la otra mitad.
    const scope = document.querySelector('.app-content') ? '.app-content' : 'body';
    for (const el of Array.from(document.querySelectorAll(`${scope} button, ${scope} [role="button"], ${scope} [aria-haspopup]`))) {
      const b = el as HTMLElement;
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || b.closest('dialog[open],[role="dialog"],.app-band,.side,.assistant,[class*="feedback"]') || (b as HTMLButtonElement).disabled) continue;
      if ((b as HTMLButtonElement).type === 'submit') continue;
      const name = `${b.getAttribute('aria-label') || ''} ${b.innerText || ''} ${b.getAttribute('title') || ''}`;
      const opener = b.hasAttribute('aria-haspopup') || b.hasAttribute('aria-expanded') || re.test(name);
      if (!opener && risky.test(name)) continue;
      if (/delete|remove|archive|discard|offboard|revoke|disconnect|sign out|log out|huddle/i.test(name)) continue;
      b.setAttribute('data-resp-trigger', String(n++));
    }
    return n;
  }, TRIGGER.source);
}

/** Marca lo que ya flota antes del clic, para reconocer lo que abre. */
async function markFloating(page: Page) {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('[data-resp-pre]'))) el.removeAttribute('data-resp-pre');
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const s = getComputedStyle(el);
      if ((s.position === 'absolute' || s.position === 'fixed') && s.display !== 'none' && s.visibility !== 'hidden') el.setAttribute('data-resp-pre', '1');
    }
  });
}

/** El overlay que quedó abierto (diálogo, menú o cualquier capa nueva), marcado para revisarlo. */
async function openOverlay(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ok = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width >= 60 && r.height >= 30 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const cands = (Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"], [role="listbox"], [role="alertdialog"]')) as HTMLElement[]).filter(ok);
    let el: Element | undefined = cands[cands.length - 1];
    if (!el) {
      // Una capa nueva con position absolute/fixed que antes no estaba (menús caseros, popovers).
      const fresh = Array.from(document.querySelectorAll('body *')).filter((e) => {
        if (e.hasAttribute('data-resp-pre')) return false;
        const s = getComputedStyle(e);
        return (s.position === 'absolute' || s.position === 'fixed') && ok(e) && !e.closest('.ui-toasts, [role="status"], [role="tooltip"]');
      });
      el = fresh.find((e) => !fresh.some((o) => o !== e && o.contains(e)));
    }
    if (!el) return null;
    el.setAttribute('data-resp-overlay', '1');
    return '[data-resp-overlay="1"]';
  });
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => null);
  await page.waitForTimeout(150);
}

async function crawlPage(page: Page, url: string, vp: string, scheme: string, findings: Finding[], shotDir: string | null, withOverlays: boolean) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
  if (!res || res.status() >= 400) {
    findings.push({ url, vp, scheme, issues: [{ kind: 'http', detail: String(res?.status() ?? 'no response') }] });
    return;
  }
  await settle(page);
  const slug = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
  const base: Finding = { url, vp, scheme, issues: await check(page, null) };
  if (shotDir) {
    base.shot = `${slug}__${vp}_${scheme}.png`;
    await page.screenshot({ path: path.join(shotDir, base.shot), fullPage: true }).catch(() => null);
  }
  findings.push(base);
  if (!withOverlays) return;
  const n = Math.min(await overlayTriggers(page), 40);
  const tried = new Set<string>();
  for (let i = 0; i < n && tried.size < (AUDIT ? 24 : 10); i++) {
    const trig = page.locator(`[data-resp-trigger="${i}"]`);
    if (!(await trig.isVisible().catch(() => false))) continue;
    const label = ((await trig.getAttribute('aria-label').catch(() => null)) || (await trig.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    // Un "Renombrar" por fila abre el mismo diálogo: alcanza con uno.
    const kind = label.replace(/\s+(for|de|para)\s.*$/i, '').replace(/\d+/g, '#');
    if (tried.has(kind)) continue;
    tried.add(kind);
    await markFloating(page);
    await trig.click({ timeout: 2_000 }).catch(() => null);
    await page.waitForTimeout(350);
    if (!page.url().includes(url.split('?')[0])) {
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await settle(page);
      await overlayTriggers(page);
      continue;
    }
    const sel = await openOverlay(page);
    if (sel) {
      const f: Finding = { url, vp, scheme, overlay: label, issues: await check(page, sel) };
      if (shotDir) {
        f.shot = `${slug}__${vp}_${scheme}__ov${i}.png`;
        await page.screenshot({ path: path.join(shotDir, f.shot) }).catch(() => null);
      }
      findings.push(f);
      await page.evaluate(() => document.querySelector('[data-resp-overlay]')?.removeAttribute('data-resp-overlay'));
    }
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(120);
    // Si Esc no cerró todo (o abrió un editor), se vuelve a la página limpia.
    if (await page.locator('dialog[open], [role="dialog"]:visible, [role="menu"]:visible').count().catch(() => 0)) {
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await settle(page);
      await overlayTriggers(page);
    }
  }
}

/** Lo que bloquea en CI. tap-small queda como aviso: hay íconos de 32px a propósito en barras densas. */
const BLOCKING = new Set(['hscroll', 'offscreen', 'overlay-offscreen', 'input-zoom', 'http']);

test.describe('celular: apps (segunda mitad)', () => {
  // Micrófono y cámara falsos: sin ellos getUserMedia se cuelga en headless (grabar, huddle, dictar).
  test.use({ hasTouch: true, isMobile: true, permissions: ['microphone', 'camera'], launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });
  test.setTimeout(AUDIT ? 3_600_000 : 600_000);

  test('cada pantalla y overlay entra en 390 y 360 de ancho', async ({ browser, request, baseURL }) => {
    const seeded = await seed(request);
    const shotDir = AUDIT ? path.resolve(AUDIT) : null;
    if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
    const findings: Finding[] = [];

    // Rutas: el inicio de cada app más lo que enlaza (sidebar, pestañas, filas) y lo sembrado.
    const discover = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    const dp = await discover.newPage();
    const routes = new Set<string>();
    for (const app of APPS) {
      routes.add(`/en/app/${app}`);
      await dp.goto(`/en/app/${app}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await settle(dp);
      for (const l of await appLinks(dp, `/en/app/${app}`, AUDIT ? 25 : 10)) routes.add(l);
    }
    for (const u of seeded) routes.add(u);
    // Las públicas con más de una pantalla (empleos y su aviso, tienda y su producto).
    for (const u of seeded.filter((s) => /^\/(careers|store)\/[^/]+$/.test(s))) {
      await dp.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await settle(dp);
      for (const l of await appLinks(dp, `${u}/`, 4)) routes.add(l);
    }
    await discover.close();

    for (const scheme of SCHEMES) {
      for (const vp of VIEWPORTS) {
        // Oscuro cambia colores, no medidas: alcanza con 390.
        if (scheme === 'dark' && vp.name !== '390') continue;
        const ctx = await browser.newContext({ baseURL, viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true, colorScheme: scheme, permissions: ['microphone', 'camera'] });
        const page = await ctx.newPage();
        // Overlays solo en 390 claro (y 360 en la auditoría): el resto repite lo mismo.
        const withOverlays = vp.name === '390';
        for (const url of routes) await crawlPage(page, url, vp.name, scheme, findings, shotDir, withOverlays && scheme === 'light');
        await ctx.close();
      }
    }

    const withIssues = findings.filter((f) => f.issues.length);
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'report.json'), JSON.stringify({ routes: [...routes], findings }, null, 1));
    if (!AUDIT) {
      const blocking = withIssues
        .map((f) => ({ ...f, issues: f.issues.filter((i) => BLOCKING.has(i.kind)) }))
        .filter((f) => f.issues.length)
        .map((f) => `${f.url} @${f.vp}${f.overlay ? ` [${f.overlay}]` : ''}: ${f.issues.map((i) => `${i.kind} ${i.detail}`).join('; ')}`);
      expect(blocking, blocking.join('\n')).toEqual([]);
    }
  });
});
