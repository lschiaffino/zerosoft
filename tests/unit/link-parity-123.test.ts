import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { applyLinkPatch, createLink, deleteLink, getUserLink, linkPatchSchema } from '@/lib/links';
import { localSafetyCheck, recheckLinkSafety } from '@/lib/link-safety';
import { diffLink, listLinkActivity } from '@/lib/link-activity';
import { attributeStripeEvent, linkConversionTotals, trackLead, trackSale, ConversionError } from '@/lib/link-conversions';
import { newClickId, withClickId } from '@/lib/link-click-id';
import { recordClick, contextFromHeaders } from '@/lib/track';
import {
  connectLinkIntegration,
  handleShopifyWebhook,
  listLinkIntegrations,
  segmentPayload,
  shopifyClickId,
  shopifySignature,
  toMinorUnits,
} from '@/lib/link-integrations';
import { matchDeferredClick, recordDeferredClick } from '@/lib/link-deferred';
import { listLinkEvents } from '@/lib/link-events';
import { renderQrSvg, qrSvgSize, DEFAULT_QR_STYLE } from '@/lib/link-qr-render';
import { createQrTemplate, deleteQrTemplate, listQrTemplates, qrStyleSchema } from '@/lib/link-qr';
import { handleLinkRpc } from '@/lib/link-mcp';
import { fetchRebrandlyLinks, fetchShortioLinks } from '@/lib/link-import-sources';
import { accentInk } from '@/lib/link-bio-theme';
import { getBioSettings, getPublicBio, saveBioSettings } from '@/lib/link-bio';
import { getWorkspaceConversions, parseWorkspaceRange } from '@/lib/link-analytics';
import { cloakHtml } from '@/lib/link-targeting';
import { makeUser } from './helpers';

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const redirectRoute = await import('@/app/r/[slug]/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const ctx = () => contextFromHeaders(new Headers({ 'user-agent': 'Mozilla/5.0 (Macintosh)' }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function linkWithClick(label: string, opts: { trackConversion?: boolean } = {}) {
  const u = await makeUser(label);
  const r = await createLink(u.id, { url: 'https://shop.example.com/', slug: slug(label), trackConversion: opts.trackConversion ?? true });
  if (!r.ok) throw new Error(r.code);
  const clickId = newClickId();
  await recordClick(r.link.id, ctx(), { clickId });
  return { u, link: r.link, clickId };
}

describe('Link 123: protección contra phishing y malware', () => {
  it('reglas locales: credenciales en la URL y dominios bloqueados por la instancia', () => {
    expect(localSafetyCheck('https://paypal.com@evil.example/login', [])).toBe('credentials');
    expect(localSafetyCheck('https://sub.bad.example/x', ['bad.example'])).toBe('blocked_domain');
    expect(localSafetyCheck('https://good.example/x', ['bad.example'])).toBeNull();
  });

  it('con Safe Browsing (fake) no deja crear ni editar hacia un destino de phishing', async () => {
    vi.stubEnv('LINK_SAFETY_FAKE', '1');
    const u = await makeUser('phish');
    const bad = await createLink(u.id, { url: 'https://testsafebrowsing.appspot.com/s/phishing.html' });
    expect(bad).toEqual({ ok: false, code: 'unsafe_url' });
    const ok = await createLink(u.id, { url: 'https://example.com/ok', slug: slug('ok') });
    if (!ok.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, ok.link.id))!;
    expect(link.safety_checked_at).not.toBeNull();
    const res = await applyLinkPatch(link, linkPatchSchema.parse({ url: 'https://testsafebrowsing.appspot.com/s/malware.html' }));
    expect(res).toEqual({ error: 'unsafe_url', status: 400 });
  });

  it('el cron bloquea un destino que pasó a ser peligroso y el redirect muestra el aviso', async () => {
    vi.stubEnv('LINK_SAFETY_FAKE', '1');
    const u = await makeUser('recheck');
    // Alta masiva: solo reglas locales en el momento; Safe Browsing lo revisa el cron.
    const r = await createLink(u.id, { url: 'https://testsafebrowsing.appspot.com/s/phishing.html', slug: slug('rc'), deferSafety: true });
    if (!r.ok) throw new Error('setup');
    await getDb().prepare("UPDATE links SET safety_checked_at = NULL WHERE id = ?").run(r.link.id);
    await recheckLinkSafety({ limit: 2000 });
    const after = (await getUserLink(u.id, r.link.id))!;
    expect(after.safety).toBe('blocked');
    expect(after.safety_reason).toBe('phishing');
    const res = await redirectRoute.GET(new NextRequest(`http://localhost:3000/r/${after.slug}`), {
      params: Promise.resolve({ slug: after.slug }),
    });
    expect(res.headers.get('location')).toContain('/gone?reason=blocked');
    // Cambiar el destino por uno limpio lo desbloquea y queda en la actividad.
    expect(await applyLinkPatch(after, linkPatchSchema.parse({ url: 'https://example.com/clean' }), { id: u.id, admin: true })).toBeNull();
    const fixed = (await getUserLink(u.id, r.link.id))!;
    expect(fixed.safety).toBeNull();
    const act = await listLinkActivity(u.id, { linkId: r.link.id });
    expect(act.rows.map((a) => a.action)).toEqual(expect.arrayContaining(['created', 'blocked', 'unblocked']));
  });
});

describe('Link 123: registro de actividad', () => {
  it('anota alta, edición con antes y después, archivado y borrado (con quién)', async () => {
    const u = await makeUser('act');
    const r = await createLink(u.id, { url: 'https://a.example.com/', slug: slug('act'), createdBy: u.id });
    if (!r.ok) throw new Error('setup');
    let link = (await getUserLink(u.id, r.link.id))!;
    await applyLinkPatch(link, linkPatchSchema.parse({ url: 'https://b.example.com/', password: 'secret' }), { id: u.id, admin: true });
    link = (await getUserLink(u.id, r.link.id))!;
    await applyLinkPatch(link, linkPatchSchema.parse({ archived: true }), { id: u.id, admin: true });
    link = (await getUserLink(u.id, r.link.id))!;
    await deleteLink(link, { actorId: u.id });
    const { rows } = await listLinkActivity(u.id, { linkId: r.link.id });
    expect(rows.map((a) => a.action)).toEqual(['deleted', 'archived', 'updated', 'created']);
    const edit = rows.find((a) => a.action === 'updated')!;
    expect(edit.changes?.url).toEqual(['https://a.example.com/', 'https://b.example.com/']);
    // La contraseña nunca se guarda: solo que cambió.
    expect(edit.changes?.password).toBe('set');
    expect(edit.actor_id).toBe(u.id);
  });

  it('diffLink ignora campos sin cambios', () => {
    expect(diffLink({ url: 'a', title: null }, { url: 'a', title: '' })).toEqual({});
    expect(diffLink({ slug: 'x' }, { slug: 'y' })).toEqual({ slug: ['x', 'y'] });
  });
});

describe('Link 123: conversiones', () => {
  it('el redirect de un link con conversiones manda ?zs_id= y guarda el click id', async () => {
    const u = await makeUser('zsid');
    const r = await createLink(u.id, { url: 'https://dest.example.com/landing?a=1', slug: slug('zs'), trackConversion: true });
    if (!r.ok) throw new Error('setup');
    const res = await redirectRoute.GET(
      new NextRequest(`http://localhost:3000/r/${r.link.slug}?zs_id=spoofed1234567890abcd`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh)' },
      }),
      { params: Promise.resolve({ slug: r.link.slug }) },
    );
    const location = new URL(res.headers.get('location')!);
    const id = location.searchParams.get('zs_id');
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(id).not.toBe('spoofed1234567890abcd');
    expect(location.searchParams.get('a')).toBe('1');
    const row = (await getDb().prepare('SELECT click_id FROM clicks WHERE link_id = ?').get(r.link.id)) as { click_id: string };
    expect(row.click_id).toBe(id);
  });

  it('sin conversiones no hay click id (camino rápido)', async () => {
    const u = await makeUser('nozs');
    const r = await createLink(u.id, { url: 'https://dest.example.com/', slug: slug('nz') });
    if (!r.ok) throw new Error('setup');
    const res = await redirectRoute.GET(
      new NextRequest(`http://localhost:3000/r/${r.link.slug}`, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh)' } }),
      { params: Promise.resolve({ slug: r.link.slug }) },
    );
    expect(res.headers.get('location')).toBe('https://dest.example.com/');
  });

  it('lead → venta por cliente, sin duplicar por cliente+evento ni por invoiceId', async () => {
    const { u, link, clickId } = await linkWithClick('lead');
    const lead = await trackLead(u.id, { clickId, customer: { externalId: 'user_1', email: 'a@b.co' } });
    expect(lead.duplicate).toBe(false);
    expect((await trackLead(u.id, { clickId, customer: { externalId: 'user_1' } })).duplicate).toBe(true);
    const sale = await trackSale(u.id, { customerExternalId: 'user_1', amount: 4900, currency: 'usd', invoiceId: 'inv_1' });
    expect(sale.conversion.linkId).toBe(link.id);
    expect(sale.conversion.currency).toBe('USD');
    expect((await trackSale(u.id, { customerExternalId: 'user_1', amount: 4900, invoiceId: 'inv_1' })).duplicate).toBe(true);
    const totals = await linkConversionTotals(link.id);
    expect(totals).toEqual({ leads: 1, sales: 1, revenue: [{ currency: 'USD', amount: 4900 }] });
  });

  it('un click de otro workspace no se puede usar', async () => {
    const { clickId } = await linkWithClick('own');
    const other = await makeUser('other');
    await expect(trackLead(other.id, { clickId, customer: { externalId: 'x' } })).rejects.toBeInstanceOf(ConversionError);
    await expect(trackSale(other.id, { customerExternalId: 'nobody', amount: 100 })).rejects.toMatchObject({ code: 'customer_not_found' });
  });

  it('Stripe: Checkout con zs_id_ y después las facturas del mismo cliente', async () => {
    const { u, link, clickId } = await linkWithClick('stripe');
    const checkout = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 2000, currency: 'eur', customer: 'cus_9', invoice: 'in_1', client_reference_id: `zs_id_${clickId}` } },
    };
    expect(await attributeStripeEvent(u.id, checkout)).toBe('sale');
    // La primera factura de la suscripción es la misma venta.
    expect(await attributeStripeEvent(u.id, { id: 'evt_2', type: 'invoice.paid', data: { object: { id: 'in_1', amount_paid: 2000, currency: 'eur', customer: 'cus_9' } } })).toBe('duplicate');
    expect(await attributeStripeEvent(u.id, { id: 'evt_3', type: 'invoice.paid', data: { object: { id: 'in_2', amount_paid: 2000, currency: 'eur', customer: 'cus_9' } } })).toBe('sale');
    expect(await attributeStripeEvent(u.id, { id: 'evt_4', type: 'invoice.paid', data: { object: { id: 'in_3', amount_paid: 900, currency: 'eur', customer: 'cus_unknown' } } })).toBe('ignored');
    const totals = await linkConversionTotals(link.id);
    expect(totals.sales).toBe(2);
    expect(totals.revenue).toEqual([{ currency: 'EUR', amount: 4000 }]);
  });

  it('las analytics del workspace suman leads, ventas e ingresos', async () => {
    const { u, clickId } = await linkWithClick('wsconv');
    await trackLead(u.id, { clickId, customer: { externalId: 'c1' } });
    await trackSale(u.id, { customerExternalId: 'c1', amount: 1500, currency: 'USD' });
    const today = new Date().toISOString().slice(0, 10);
    const c = await getWorkspaceConversions(u.id, parseWorkspaceRange(today, today));
    expect(c.leads).toBe(1);
    expect(c.sales).toBe(1);
    expect(c.revenue).toEqual([{ currency: 'USD', amount: 1500 }]);
    expect(c.topLinks[0].leads).toBe(1);
  });

  it('withClickId suma el parámetro también a un esquema de app', () => {
    expect(withClickId('myapp://item/1', 'AbCdEfGhIjKlMnOpQrSt')).toBe('myapp://item/1?zs_id=AbCdEfGhIjKlMnOpQrSt');
  });
});

describe('Link 123: Shopify y Segment', () => {
  it('Shopify: firma HMAC, atribución por landing_site y pedido repetido', async () => {
    const { u, link, clickId } = await linkWithClick('shopify');
    await connectLinkIntegration(u.id, 'shopify', { secret: 'shpss_0123456789abcdef' }, u.id);
    const view = (await listLinkIntegrations(u.id)).find((i) => i.key === 'shopify')!;
    expect(view.connected).toBe(true);
    expect(view.hint).not.toContain('0123456789');
    const token = new URL(view.webhookUrl!).searchParams.get('token')!;
    const body = JSON.stringify({ id: 555, total_price: '49.90', currency: 'USD', landing_site: `/products/x?zs_id=${clickId}`, customer: { id: 77 } });
    const sig = shopifySignature(body, 'shpss_0123456789abcdef');
    await expect(handleShopifyWebhook(token, body, { hmac: 'bad', topic: 'orders/paid' })).rejects.toMatchObject({ code: 'invalid_signature' });
    expect(await handleShopifyWebhook(token, body, { hmac: sig, topic: 'orders/paid' })).toBe('sale');
    expect(await handleShopifyWebhook(token, body, { hmac: sig, topic: 'orders/paid' })).toBe('duplicate');
    expect((await linkConversionTotals(link.id)).revenue).toEqual([{ currency: 'USD', amount: 4990 }]);
  });

  it('click id del pedido y montos en unidades menores', () => {
    expect(shopifyClickId({ note_attributes: [{ name: 'zs_id', value: 'AbCdEfGhIjKlMnOpQrSt' }] })).toBe('AbCdEfGhIjKlMnOpQrSt');
    expect(shopifyClickId({ landing_site: '/?utm_source=x' })).toBeNull();
    expect(toMinorUnits('10.5', 'USD')).toBe(1050);
    expect(toMinorUnits('1000', 'JPY')).toBe(1000);
  });

  it('Segment: eventos track sin IP', () => {
    const p = segmentPayload('link.clicked', { link: { id: 'l1', short_url: 's' }, click: { country: 'AR', device: 'mobile' } })!;
    expect(p.event).toBe('Link Clicked');
    expect(JSON.stringify(p)).not.toMatch(/\bip\b/i);
    const sale = segmentPayload('link.sale', { link: { id: 'l1' }, sale: { amount: 4900, currency: 'USD', customer: { externalId: 'u1' } } })!;
    expect(sale).toMatchObject({ event: 'Sale Created', userId: 'u1', properties: { revenue: 49 } });
    expect(segmentPayload('link.updated', {})).toBeNull();
  });
});

describe('Link 123: deep linking diferido', () => {
  it('la app reclama la visita de su IP y plataforma una sola vez', async () => {
    const { u, link, clickId } = await linkWithClick('deferred');
    const other = await makeUser('deferredother');
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    await recordDeferredClick({ ip, platform: 'ios', linkId: link.id, clickId });
    expect(await matchDeferredClick({ ws: u.id, ip, platform: 'android' })).toBeNull();
    // Otro workspace (otra publishable key) no recibe la visita.
    expect(await matchDeferredClick({ ws: other.id, ip, platform: 'ios' })).toBeNull();
    // Un dominio propio que no es el del link tampoco; el de zerosoft sí (links sin dominio propio).
    expect(await matchDeferredClick({ ws: u.id, ip, platform: 'ios', domain: 'go.other.example' })).toBeNull();
    expect(await matchDeferredClick({ ws: u.id, ip, platform: 'ios', domain: 'localhost:3000' })).toEqual({ linkId: link.id, clickId });
    expect(await matchDeferredClick({ ws: u.id, ip, platform: 'ios' })).toBeNull();
  });

  it('track/open exige la publishable key y aplica las puertas del redirect', async () => {
    const route = await import('@/app/api/v1/links/track/open/route');
    const { getPublishableKey } = await import('@/lib/link-publishable');
    const u = await makeUser('openkey');
    const key = await getPublishableKey(u.id);
    const pw = await createLink(u.id, { url: 'https://secret.example.com/', slug: slug('pw'), password: 'x' });
    const old = await createLink(u.id, { url: 'https://old.example.com/', slug: slug('old'), expiresAt: '2020-01-01T00:00:00Z' });
    if (!pw.ok || !old.ok) throw new Error('setup');
    const call = (body: unknown, auth?: string) =>
      route.POST(
        new NextRequest('http://localhost:3000/api/v1/links/track/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
          body: JSON.stringify(body),
        }),
      );
    expect((await call({ platform: 'ios', deepLink: `http://localhost:3000/${pw.link.slug}` })).status).toBe(401);
    const res = await call({ platform: 'ios', deepLink: `http://localhost:3000/${pw.link.slug}` }, key);
    const data = (await res.json()) as { link: { url: string | null; protected: boolean } };
    expect(data.link).toMatchObject({ url: null, protected: true });
    expect((await call({ platform: 'ios', deepLink: `http://localhost:3000/${old.link.slug}` }, key)).status).toBe(404);
    // La key de otro workspace no resuelve links ajenos.
    const other = await makeUser('openother');
    const otherKey = await getPublishableKey(other.id);
    expect((await call({ platform: 'ios', deepLink: `http://localhost:3000/${pw.link.slug}` }, otherKey)).status).toBe(404);
  });
});

describe('Link 123: anti-phishing en todos los destinos', () => {
  it('la redirección al vencer también se revisa (alta, edición y cron)', async () => {
    vi.stubEnv('LINK_SAFETY_FAKE', '1');
    const u = await makeUser('expsafe');
    const bad = 'https://testsafebrowsing.appspot.com/s/phishing.html';
    expect(await createLink(u.id, { url: 'https://example.com/', expiredUrl: bad })).toEqual({ ok: false, code: 'unsafe_url' });
    const ok = await createLink(u.id, { url: 'https://example.com/', slug: slug('ex') });
    if (!ok.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, ok.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ expiredUrl: bad }))).toEqual({ error: 'unsafe_url', status: 400 });
    await getDb().prepare('UPDATE links SET expired_url = ?, safety_checked_at = NULL WHERE id = ?').run(bad, link.id);
    await recheckLinkSafety({ limit: 2000 });
    expect((await getUserLink(u.id, link.id))!.safety).toBe('blocked');
  });

  it('homógrafos IDN: mezcla de alfabetos o cirílico que imita al latino', () => {
    expect(localSafetyCheck(`https://${new URL('https://pаypal.com').hostname}/`, [])).toBe('mixed_script');
    expect(localSafetyCheck(`https://${new URL('https://раураl.com').hostname}/`, [])).toBe('mixed_script');
    expect(localSafetyCheck('https://münchen.de/', [])).toBeNull();
    // ӏ (U+04CF) cirílica y ɡ (U+0261) latina no ASCII: homógrafos de un solo alfabeto contra marcas.
    expect(localSafetyCheck(`https://${new URL('https://аррӏе.com').hostname}/`, [])).toBe('mixed_script');
    expect(localSafetyCheck(`https://${new URL('https://ɡoogle.com').hostname}/`, [])).toBe('mixed_script');
    expect(localSafetyCheck(`https://${new URL('https://ɡato.com').hostname}/`, [])).toBeNull();
    expect(localSafetyCheck('https://пример.рф/', [])).toBeNull();
  });

  it('una API key no registra leads de links de carpetas que su creador no ve', async () => {
    const { u, clickId, link } = await linkWithClick('folderlead');
    const folder = crypto.randomUUID();
    await getDb().prepare("INSERT INTO link_folders (id, user_id, name, default_access) VALUES (?, ?, 'Privada', 'none')").run(folder, u.id);
    await getDb().prepare('UPDATE links SET folder_id = ? WHERE id = ?').run(folder, link.id);
    await expect(
      trackLead(u.id, { clickId, customer: { externalId: 'x1' }, viewer: { id: 'someone-else', admin: false } }),
    ).rejects.toMatchObject({ code: 'click_not_found' });
    expect((await trackLead(u.id, { clickId, customer: { externalId: 'x1' }, viewer: { id: u.id, admin: true } })).duplicate).toBe(false);
  });
});

describe('Link 123: stream de eventos', () => {
  it('trae los últimos y después solo lo nuevo con el cursor', async () => {
    const { u, link, clickId } = await linkWithClick('events');
    const first = await listLinkEvents(u.id, {});
    expect(first.events.some((e) => e.type === 'click' && e.linkId === link.id)).toBe(true);
    await trackLead(u.id, { clickId, customer: { externalId: 'ev1' } });
    await recordClick(link.id, ctx(), { source: 'qr' });
    const next = await listLinkEvents(u.id, { after: first.cursor });
    expect(next.events.map((e) => e.type).sort()).toEqual(['lead', 'scan']);
    const none = await listLinkEvents(u.id, { after: next.cursor });
    expect(none.events).toEqual([]);
    // Otro workspace no ve estos eventos.
    const other = await makeUser('evother');
    expect((await listLinkEvents(other.id, {})).events).toEqual([]);
  });
});

describe('Link 123: QR con marco y plantillas', () => {
  it('el marco con texto agranda el alto y escapa el texto', () => {
    const plain = renderQrSvg('https://x.co/a?qr=1', DEFAULT_QR_STYLE);
    const framed = renderQrSvg('https://x.co/a?qr=1', { ...DEFAULT_QR_STYLE, frame: 'label', label: '<Scan>' });
    expect(qrSvgSize(plain).width).toBe(qrSvgSize(plain).height);
    expect(qrSvgSize(framed).height).toBeGreaterThan(qrSvgSize(framed).width);
    expect(framed).toContain('&lt;Scan&gt;');
    expect(framed).not.toContain('<Scan>');
  });

  it('plantillas del workspace: crear, listar y borrar', async () => {
    const u = await makeUser('qrtpl');
    const style = qrStyleSchema.parse({ fg: '#112233', frame: 'border' });
    const tpl = await createQrTemplate(u.id, { name: 'Marca', style }, u.id);
    if (typeof tpl === 'string') throw new Error(tpl);
    expect((await listQrTemplates(u.id)).map((t) => t.name)).toEqual(['Marca']);
    expect(await deleteQrTemplate(u.id, tpl.id)).toBe(true);
    expect(await listQrTemplates(u.id)).toEqual([]);
  });
});

describe('Link 123: servidor MCP', () => {
  it('lista herramientas, crea un link y respeta los scopes', async () => {
    const u = await makeUser('mcp');
    const base = { ws: u.id, personId: u.id, role: 'owner' as const };
    const list = await handleLinkRpc({ ...base, scopes: ['links:read'] }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = ((list?.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['create_link', 'list_links', 'get_analytics', 'get_link_analytics']));
    const denied = await handleLinkRpc({ ...base, scopes: ['links:read'] }, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_link', arguments: { url: 'https://mcp.example.com' } },
    });
    expect((denied?.result as { isError: boolean }).isError).toBe(true);
    const created = await handleLinkRpc({ ...base, scopes: ['links:write'] }, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_link', arguments: { url: 'https://mcp.example.com', title: 'Desde MCP' } },
    });
    const out = (created?.result as { structuredContent: { id: string; title: string } }).structuredContent;
    expect(out.title).toBe('Desde MCP');
    const act = await listLinkActivity(u.id, { linkId: out.id });
    expect(act.rows[0]).toMatchObject({ action: 'created', via: 'mcp' });
  });
});

describe('Link 123: importar de Rebrandly y Short.io (fake)', () => {
  it('devuelve links con su short URL y tags', async () => {
    vi.stubEnv('LINK_IMPORT_FAKE', '1');
    const r = await fetchRebrandlyLinks('abcdef123');
    expect(r).toHaveLength(3);
    expect(r[0].shortUrl).toMatch(/^https:\/\/rebrand\.ly\//);
    const s = await fetchShortioLinks('abcdef123');
    expect(s[0].tags).toEqual(['from-shortio']);
    await expect(fetchShortioLinks('bad')).rejects.toThrow('shortio_unauthorized');
  });
});

describe('Link 123: bio con tema y color', () => {
  it('guarda tema y acento y la página pública los usa', async () => {
    const u = await makeUser('biotheme');
    await getDb().prepare('UPDATE users SET handle = ? WHERE id = ?').run(`bt${crypto.randomUUID().slice(0, 6)}`, u.id);
    const handle = ((await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(u.id)) as { handle: string }).handle;
    await saveBioSettings(u.id, { title: 'Hola', bio: '', avatarUrl: null, published: true, linkIds: [], theme: 'dark', accent: '#FFCC00' });
    const s = await getBioSettings(u.id);
    expect(s).toMatchObject({ theme: 'dark', accent: '#ffcc00' });
    expect((await getPublicBio(handle))?.theme).toBe('dark');
    expect(accentInk('#ffcc00')).toBe('#111111');
    expect(accentInk('#1a1a6e')).toBe('#ffffff');
  });
});

describe('Link 123: cloaking', () => {
  it('solo con dominio propio, y la página escapa la URL', async () => {
    const u = await makeUser('cloak');
    expect(await createLink(u.id, { url: 'https://example.com', cloak: true })).toEqual({ ok: false, code: 'cloak_needs_domain' });
    const html = cloakHtml('https://example.com/?a="><script>', null);
    expect(html).not.toContain('"><script>');
    expect(html).toContain('<iframe src="https://example.com/?a=&#34;&#62;&#60;script&#62;"');
  });
});
