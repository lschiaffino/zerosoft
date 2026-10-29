import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decode } from 'next-auth/jwt';
import { createHash, randomBytes } from 'crypto';
import { makeUser } from './helpers';

const session: { user: Record<string, unknown> | null } = { user: null };
vi.mock('@/lib/session', async (orig) => ({ ...(await orig<object>()), getCurrentUser: async () => session.user }));

import { createDesktopLoginCode, exchangeDesktopLoginCode, mintSessionToken, pkceChallenge, sessionCookieInfo } from '@/lib/desktop-auth';
import { desktopDownloads, pickDesktopRelease, rewriteUpdateYml, type GhRelease } from '@/lib/desktop-release';
import { talkBadgeCount, desktopBadge } from '@/lib/desktop-badge';
import { confirmPage, escapeHtml, returnPage } from '@/lib/desktop-login-page';
import { createNotification } from '@/lib/notifications';
import { GET as loginGet, POST as loginPost } from '@/app/api/desktop/login/route';
import { POST as tokenPost } from '@/app/api/desktop/token/route';
import { GET as badgeGet } from '@/app/api/desktop/badge/route';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
};
const STATE = 'state_' + 'x'.repeat(20);

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  session.user = null;
});
afterEach(() => vi.unstubAllEnvs());

describe('desktop: códigos de login (PKCE)', () => {
  it('canje con el verifier correcto, una sola vez', async () => {
    const u = await makeUser('desk');
    const { verifier, challenge } = pkce();
    expect(pkceChallenge(verifier)).toBe(challenge);
    const code = await createDesktopLoginCode(u.id, challenge);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await exchangeDesktopLoginCode(code, verifier))?.id).toBe(u.id);
    expect(await exchangeDesktopLoginCode(code, verifier)).toBeNull();
  });

  it('un verifier ajeno quema el código; vencido o con forma rara no sirve', async () => {
    const u = await makeUser('desk2');
    const a = pkce();
    const code = await createDesktopLoginCode(u.id, a.challenge);
    expect(await exchangeDesktopLoginCode(code, pkce().verifier)).toBeNull();
    expect(await exchangeDesktopLoginCode(code, a.verifier)).toBeNull();
    const old = await createDesktopLoginCode(u.id, a.challenge, Date.now() - 3 * 60_000);
    expect(await exchangeDesktopLoginCode(old, a.verifier)).toBeNull();
    expect(await exchangeDesktopLoginCode('nope', a.verifier)).toBeNull();
    expect(await exchangeDesktopLoginCode(code, 'short')).toBeNull();
    await expect(createDesktopLoginCode(u.id, 'not-a-challenge')).rejects.toThrow('invalid_challenge');
  });

  it('emite el mismo JWT de NextAuth que el login web', async () => {
    const u = await makeUser('desk3');
    const token = await mintSessionToken(u);
    const payload = await decode({ token, secret: process.env.NEXTAUTH_SECRET! });
    expect(payload?.email).toBe(u.email);
    expect(payload?.uid).toBe(u.id);
    vi.stubEnv('NEXTAUTH_URL', 'https://zerosoft.example');
    expect(sessionCookieInfo().name).toBe('__Secure-next-auth.session-token');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    expect(sessionCookieInfo()).toMatchObject({ name: 'next-auth.session-token', secure: false });
  });
});

describe('desktop: /api/desktop/login y /api/desktop/token', () => {
  it('sin sesión manda al login y vuelve; con sesión pide confirmar', async () => {
    const { challenge } = pkce();
    const url = `http://x/api/desktop/login?challenge=${challenge}&state=${STATE}&locale=es`;
    const anon = await loginGet(new NextRequest(url));
    expect(anon.status).toBe(307);
    const loc = new URL(anon.headers.get('location')!);
    expect(loc.pathname).toBe('/es/auth/signin');
    expect(loc.searchParams.get('callbackUrl')).toContain('/api/desktop/login?challenge=');
    const u = await makeUser('desk4');
    session.user = { ...u, role: 'owner' };
    const page = await loginGet(new NextRequest(url));
    expect(page.status).toBe(200);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    const html = await page.text();
    expect(html).toContain(u.email);
    expect(html).toContain('method="post"');
    const bad = await loginGet(new NextRequest('http://x/api/desktop/login?challenge=x&state=y'));
    expect(bad.status).toBe(400);
  });

  it('confirmar crea el código (mismo origen) y el canje devuelve la cookie', async () => {
    const u = await makeUser('desk5');
    session.user = { ...u, role: 'owner' };
    const { verifier, challenge } = pkce();
    const form = new URLSearchParams({ challenge, state: STATE, locale: 'en' });
    const cross = await loginPost(
      new NextRequest('http://x.test/api/desktop/login', { method: 'POST', body: form, headers: { origin: 'https://evil.test', host: 'x.test', 'content-type': 'application/x-www-form-urlencoded' } }),
    );
    expect(cross.status).toBe(403);
    const res = await loginPost(
      new NextRequest('http://x.test/api/desktop/login', { method: 'POST', body: form, headers: { origin: 'http://x.test', host: 'x.test', 'content-type': 'application/x-www-form-urlencoded' } }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    const link = /href="(zerosoft:\/\/auth\/callback\?[^"]+)"/.exec(html)?.[1].replace(/&amp;/g, '&');
    expect(link).toBeTruthy();
    const params = new URL(link!).searchParams;
    expect(params.get('state')).toBe(STATE);
    const code = params.get('code')!;

    const wrong = await tokenPost(new NextRequest('http://x.test/api/desktop/token', { method: 'POST', body: JSON.stringify({ code, verifier: pkce().verifier }) }));
    expect(wrong.status).toBe(400);
    // El código quedó quemado por el intento con otro verifier: hace falta uno nuevo.
    const again = await loginPost(
      new NextRequest('http://x.test/api/desktop/login', { method: 'POST', body: form, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' } }),
    );
    const code2 = new URL(/href="(zerosoft:[^"]+)"/.exec(await again.text())![1].replace(/&amp;/g, '&')).searchParams.get('code')!;
    const ok = await tokenPost(new NextRequest('http://x.test/api/desktop/token', { method: 'POST', body: JSON.stringify({ code: code2, verifier }) }));
    expect(ok.status).toBe(200);
    const data = (await ok.json()) as { token: string; cookie: { name: string; maxAge: number }; user: { email: string } };
    expect(data.user.email).toBe(u.email);
    expect(data.cookie.name).toMatch(/next-auth\.session-token$/);
    expect(data.cookie.maxAge).toBe(30 * 24 * 60 * 60);
    expect((await decode({ token: data.token, secret: process.env.NEXTAUTH_SECRET! }))?.email).toBe(u.email);
  });

  it('el HTML escapa lo que viene de afuera', () => {
    expect(escapeHtml('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(confirmPage('en', { email: '<b>@x.com', challenge: 'c', state: 's' })).not.toContain('<b>@');
    expect(returnPage('pt', 'zerosoft://auth/callback?code=a&state=b')).toContain('zerosoft://auth/callback?code=a&amp;state=b');
  });
});

describe('desktop: contador y avisos', () => {
  it('Talk cuenta menciones y DMs sin leer', () => {
    expect(
      talkBadgeCount([
        { kind: 'public', unread: true, mentions: 0 },
        { kind: 'public', unread: true, mentions: 2 },
        { kind: 'dm', unread: true, mentions: 0 },
        { kind: 'group', unread: true, mentions: 3 },
        { kind: 'dm', unread: false, mentions: 0 },
      ]),
    ).toBe(6);
  });

  it('la campana sin leer y los avisos nuevos desde la última consulta', async () => {
    const u = await makeUser('badge');
    session.user = { ...u, role: 'owner', apps: '*' };
    const before = new Date(Date.now() - 1000).toISOString();
    await createNotification({ userId: u.id, type: 'mention', title: 'Ana te mencionó', body: 'TRK-1', href: '/app/track/issues/1', sourceType: 'issue', sourceId: '1' });
    const res = await badgeGet(new NextRequest(`http://x/api/desktop/badge?since=${encodeURIComponent(before)}`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Awaited<ReturnType<typeof desktopBadge>>;
    expect(data.bell).toBe(1);
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.notifications.map((n) => n.title)).toEqual(['Ana te mencionó']);
    const later = (await (await badgeGet(new NextRequest(`http://x/api/desktop/badge?since=${encodeURIComponent(data.now)}`))).json()) as typeof data;
    expect(later.notifications).toEqual([]);
    session.user = null;
    expect((await badgeGet(new NextRequest('http://x/api/desktop/badge'))).status).toBe(401);
  });
});

describe('desktop: releases y feed de actualizaciones', () => {
  const rel = (tag: string, extra: Partial<GhRelease> = {}): GhRelease => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    published_at: '2026-10-29T00:00:00Z',
    assets: [],
    ...extra,
  });

  it('elige el último desktop-v estable', () => {
    const picked = pickDesktopRelease([rel('v9.0.0'), rel('desktop-v0.2.0'), rel('desktop-v0.10.0'), rel('desktop-v1.0.0', { prerelease: true }), rel('desktop-v2.0.0', { draft: true }), rel('desktop-vx')]);
    expect(picked?.tag_name).toBe('desktop-v0.10.0');
    expect(pickDesktopRelease([rel('v1.0.0')])).toBeNull();
  });

  it('instaladores por sistema', () => {
    const asset = (name: string) => ({ name, size: 1, browser_download_url: `https://dl/${name}` });
    const d = desktopDownloads(
      rel('desktop-v0.3.1', { assets: ['zerosoft-0.3.1-mac-arm64.dmg', 'zerosoft-0.3.1-mac-x64.dmg', 'zerosoft-0.3.1-win-x64.exe', 'zerosoft-0.3.1-win-x64.exe.blockmap'].map(asset) }),
    );
    expect(d).toMatchObject({ version: '0.3.1', macArm64: 'https://dl/zerosoft-0.3.1-mac-arm64.dmg', macX64: 'https://dl/zerosoft-0.3.1-mac-x64.dmg', win: 'https://dl/zerosoft-0.3.1-win-x64.exe' });
  });

  it('latest-mac.yml con URLs absolutas', () => {
    const yml = 'version: 0.3.1\nfiles:\n  - url: zerosoft-0.3.1-mac-arm64.zip\n    sha512: abc\n  - url: other.zip\npath: zerosoft-0.3.1-mac-arm64.zip\n';
    const out = rewriteUpdateYml(yml, [{ name: 'zerosoft-0.3.1-mac-arm64.zip', size: 1, browser_download_url: 'https://dl/a.zip' }]);
    expect(out).toContain('  - url: https://dl/a.zip\n');
    expect(out).toContain('path: https://dl/a.zip');
    expect(out).toContain('  - url: other.zip');
    expect(out).toContain('sha512: abc');
  });
});
