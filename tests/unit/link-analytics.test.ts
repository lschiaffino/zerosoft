import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { createLink } from '@/lib/links';
import {
  exportWorkspaceClicks,
  getWorkspaceAnalytics,
  MAX_RANGE_DAYS,
  parseWorkspaceRange,
  workspaceClicksToCsv,
} from '@/lib/link-analytics';
import { getQrStyle, qrStyleSchema, qrTarget, renderQrSvg, saveQrStyle } from '@/lib/link-qr';
import { DEFAULT_QR_STYLE, hasEnoughContrast } from '@/lib/link-qr-render';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string }) => u.id,
}));

const analyticsRoute = await import('@/app/api/links/analytics/route');
const exportRoute = await import('@/app/api/links/analytics/export.csv/route');
const v1Analytics = await import('@/app/api/v1/links/analytics/route');
const qrRoute = await import('@/lib/routes/links/[id]/qr/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

async function click(linkId: string, ts: string, c: Partial<Record<'source' | 'country' | 'device' | 'browser' | 'referrer', string>> = {}) {
  await getDb()
    .prepare('INSERT INTO clicks (link_id, ts, referrer, country, device, browser, os, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(linkId, ts, c.referrer ?? 'direct', c.country ?? 'AR', c.device ?? 'desktop', c.browser ?? 'Chrome', 'Mac OS', c.source ?? 'link');
}

async function seed() {
  const a = await makeUser('an');
  const b = await makeUser('bn');
  const mk = async (userId: string, s: string) => {
    const r = await createLink(userId, { url: `https://${s}.example.com`, slug: slug(s) });
    if (!r.ok) throw new Error(r.code);
    return r.link;
  };
  const l1 = await mk(a.id, 'one');
  const l2 = await mk(a.id, 'two');
  const foreign = await mk(b.id, 'foreign');
  // Rango 2026-03-01..2026-03-03 + uno el día anterior (período previo) y uno después.
  await click(l1.id, '2026-02-28 12:00:00');
  await click(l1.id, '2026-03-01 00:00:00', { country: 'AR', referrer: 'x.com' });
  await click(l1.id, '2026-03-01 23:59:59', { country: 'UY', source: 'qr', device: 'mobile' });
  await click(l1.id, '2026-03-03 10:00:00', { country: 'AR', browser: 'Safari' });
  await click(l2.id, '2026-03-02 08:00:00', { source: 'qr', device: 'mobile', referrer: 'x.com' });
  await click(l2.id, '2026-03-04 00:00:00');
  await click(foreign.id, '2026-03-02 09:00:00', { country: 'US' });
  return { a, b, l1, l2, foreign, range: { from: '2026-03-01', to: '2026-03-03' } };
}

describe('Link analytics del workspace', () => {
  it('rango: por defecto 30 días, invierte from>to, tope 366 días, ignora fechas inválidas', () => {
    expect(parseWorkspaceRange(null, null, '2026-03-30')).toEqual({ from: '2026-03-01', to: '2026-03-30' });
    expect(parseWorkspaceRange('2026-03-10', '2026-03-01')).toEqual({ from: '2026-03-01', to: '2026-03-10' });
    expect(parseWorkspaceRange('2026-02-30', '2026-03-05')).toEqual({ from: '2026-02-04', to: '2026-03-05' });
    const wide = parseWorkspaceRange('2020-01-01', '2026-03-01');
    expect(wide.to).toBe('2026-03-01');
    const days = (Date.parse(wide.to) - Date.parse(wide.from)) / 86_400_000 + 1;
    expect(days).toBe(MAX_RANGE_DAYS);
  });

  it('agrega clics y escaneos por día, top links y breakdowns sin mezclar workspaces', async () => {
    const { a, l1, l2, range } = await seed();
    const r = await getWorkspaceAnalytics(a.id, range);
    expect(r.clicks).toBe(2);
    expect(r.scans).toBe(2);
    expect(r.previous).toEqual({ clicks: 1, scans: 0 });
    expect(r.byDay).toEqual([
      { date: '2026-03-01', clicks: 1, scans: 1 },
      { date: '2026-03-02', clicks: 0, scans: 1 },
      { date: '2026-03-03', clicks: 1, scans: 0 },
    ]);
    expect(r.topLinks.map((l) => [l.id, l.clicks, l.scans])).toEqual([
      [l1.id, 2, 1],
      [l2.id, 0, 1],
    ]);
    expect(r.countries).toEqual([
      { name: 'AR', count: 3 },
      { name: 'UY', count: 1 },
    ]);
    expect(r.referrers).toEqual([
      { name: 'x.com', count: 2 },
      { name: 'direct', count: 2 },
    ].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)));
    expect(r.devices.find((d) => d.name === 'mobile')?.count).toBe(2);
    expect(r.browsers.find((d) => d.name === 'Safari')?.count).toBe(1);
    expect(r.countries.some((c) => c.name === 'US')).toBe(false);
  });

  it('CSV: una fila por visita del rango, con origen', async () => {
    const { a, range } = await seed();
    const rows = await exportWorkspaceClicks(a.id, range);
    expect(rows).toHaveLength(4);
    const csv = workspaceClicksToCsv(rows);
    expect(csv.split('\n')[0]).toBe('timestamp,short_url,source,variant,country,referrer,device,browser,os,region,city,referrer_url');
    expect(csv.split('\n').filter((l) => l.includes(',qr,'))).toHaveLength(2);
  });

  it('endpoints: 401 sin sesión, cada workspace ve solo lo suyo (app, CSV y v1)', async () => {
    const { a, b, range } = await seed();
    const q = `from=${range.from}&to=${range.to}`;
    session.user = null;
    expect((await analyticsRoute.GET(new NextRequest(`http://x/api/links/analytics?${q}`))).status).toBe(401);
    expect((await exportRoute.GET(new NextRequest(`http://x/api/links/analytics/export.csv?${q}`))).status).toBe(401);

    session.user = b as unknown as Record<string, unknown>;
    const bRes = (await (await analyticsRoute.GET(new NextRequest(`http://x/api/links/analytics?${q}`))).json()) as {
      clicks: number;
      countries: Array<{ name: string }>;
    };
    expect(bRes.clicks).toBe(1);
    expect(bRes.countries.map((c) => c.name)).toEqual(['US']);

    session.user = a as unknown as Record<string, unknown>;
    const csv = await (await exportRoute.GET(new NextRequest(`http://x/api/links/analytics/export.csv?${q}`))).text();
    expect(csv.split('\n')).toHaveLength(5);
    expect(csv).not.toContain('foreign');

    const call = (key?: string) =>
      v1Analytics.GET(
        new NextRequest(`http://x/api/v1/links/analytics?${q}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }),
      );
    expect((await call()).status).toBe(401);
    const key = await createApiKey(a.id, 'k', a.id, ['links:read']);
    const v1 = (await (await call(key.key)).json()) as { clicks: number; scans: number };
    expect(v1).toMatchObject({ clicks: 2, scans: 2 });
    const crmOnly = await createApiKey(a.id, 'k2', a.id, ['crm:read']);
    expect((await call(crmOnly.key)).status).toBe(403);
  });
});

describe('QR con marca', () => {
  it('el QR apunta a la URL corta con ?qr=1', () => {
    expect(qrTarget({ slug: 'abc', domain_hostname: 'go.acme.com' })).toBe('https://go.acme.com/abc?qr=1');
  });

  it('render: colores, módulos, logo con corrección H y zona libre', () => {
    const target = 'https://zs.ai/abc?qr=1';
    const plain = renderQrSvg(target, DEFAULT_QR_STYLE);
    expect(plain).toContain('fill="#000000"');
    expect(plain).toContain('<path d="M');
    const sizeM = QRCode.create(target, { errorCorrectionLevel: 'M' }).modules.size;
    expect(plain).toContain(`viewBox="0 0 ${sizeM + 4} ${sizeM + 4}"`);

    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const styled = renderQrSvg(target, { fg: '#2f6bff', bg: '#fafafa', dots: 'dots', logo });
    const sizeH = QRCode.create(target, { errorCorrectionLevel: 'H' }).modules.size;
    expect(sizeH).toBeGreaterThanOrEqual(sizeM);
    expect(styled).toContain(`viewBox="0 0 ${sizeH + 4} ${sizeH + 4}"`);
    expect(styled).toContain('<circle');
    expect(styled).toContain(`href="${logo}"`);
    expect(styled).toContain('fill="#2f6bff"');
    // Determinístico.
    expect(renderQrSvg(target, { fg: '#2f6bff', bg: '#fafafa', dots: 'dots', logo })).toBe(styled);
  });

  it('valida colores y logos (sin SVG ni URLs remotas) y avisa poco contraste', () => {
    expect(qrStyleSchema.safeParse({ fg: 'red' }).success).toBe(false);
    expect(qrStyleSchema.safeParse({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).success).toBe(false);
    expect(qrStyleSchema.safeParse({ logo: 'https://evil.example.com/x.png' }).success).toBe(false);
    expect(qrStyleSchema.parse({})).toEqual(DEFAULT_QR_STYLE);
    expect(hasEnoughContrast('#000000', '#ffffff')).toBe(true);
    expect(hasEnoughContrast('#ffffff', '#000000')).toBe(false);
    expect(hasEnoughContrast('#dddddd', '#ffffff')).toBe(false);
  });

  it('PUT/GET del estilo: solo el dueño del link', async () => {
    const owner = await makeUser('qo');
    const other = await makeUser('qx');
    const r = await createLink(owner.id, { url: 'https://q.example.com', slug: slug('q') });
    if (!r.ok) throw new Error(r.code);
    const params = { params: Promise.resolve({ id: r.link.id }) };
    const put = (body: unknown) =>
      qrRoute.PUT(
        new NextRequest(`http://x/api/links/${r.link.id}/qr`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        params,
      );

    session.user = other as unknown as Record<string, unknown>;
    expect((await put({ fg: '#111111' })).status).toBe(404);
    expect((await qrRoute.GET(new NextRequest(`http://x/api/links/${r.link.id}/qr`), params)).status).toBe(404);
    // Aunque alguien escriba directo con otro user_id, el upsert no pisa el estilo ajeno.
    await saveQrStyle(owner.id, r.link.id, { ...DEFAULT_QR_STYLE, fg: '#123456' });
    await saveQrStyle(other.id, r.link.id, { ...DEFAULT_QR_STYLE, fg: '#ff0000' });
    expect((await getQrStyle(owner.id, r.link.id)).fg).toBe('#123456');
    expect(await getQrStyle(other.id, r.link.id)).toEqual(DEFAULT_QR_STYLE);

    session.user = owner as unknown as Record<string, unknown>;
    expect((await put({ fg: 'nope' })).status).toBe(400);
    expect((await put({ fg: '#2f6bff', bg: '#ffffff', dots: 'rounded', logo: null })).status).toBe(200);
    const json = (await (await qrRoute.GET(new NextRequest(`http://x/api/links/${r.link.id}/qr?format=json`), params)).json()) as {
      style: { dots: string };
      target: string;
    };
    expect(json.style.dots).toBe('rounded');
    expect(json.target).toMatch(/\?qr=1$/);
    const svg = await (await qrRoute.GET(new NextRequest(`http://x/api/links/${r.link.id}/qr`), params)).text();
    expect(svg).toContain('fill="#2f6bff"');
    const png = await qrRoute.GET(new NextRequest(`http://x/api/links/${r.link.id}/qr?format=png`), params);
    expect(png.headers.get('content-type')).toBe('image/png');
  });
});
