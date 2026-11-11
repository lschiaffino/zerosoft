import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInToConnect } from '@/lib/oauth-signin';
import { safeCallbackUrl } from '@/lib/hosts';

const BASE = 'https://zerosoft.ai';

function nav(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, { headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers } });
}

/** A dónde manda el login después de entrar (lo que /auth/signin acepta como callbackUrl). */
function callbackOf(res: Response): string | null {
  const loc = new URL(res.headers.get('location')!);
  expect(loc.origin).toBe(BASE);
  return safeCallbackUrl(loc.searchParams.get('callbackUrl'), BASE);
}

describe('signInToConnect', () => {
  it('una navegación sin sesión va al login y vuelve a la misma ruta de inicio', () => {
    const res = signInToConnect(nav('/api/inbox/gmail', { cookie: 'a=1; NEXT_LOCALE=es; b=2' }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/es/auth/signin');
    expect(callbackOf(res)).toBe('/api/inbox/gmail?signin=1');
  });

  it('conserva la query de la ruta de inicio (?return= del onboarding)', () => {
    const res = signInToConnect(nav('/api/integrations/gmail/start?return=%2Fpt%2Fapp%2Fwelcome', { 'accept-language': 'pt-BR,pt;q=0.9' }));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pt/auth/signin');
    const back = new URL(callbackOf(res)!, BASE);
    expect(back.pathname).toBe('/api/integrations/gmail/start');
    expect(back.searchParams.get('return')).toBe('/pt/app/welcome');
  });

  it('nunca sale del sitio, venga lo que venga en la URL', () => {
    for (const path of ['/api/inbox/gmail?next=https://evil.com', '/api/inbox/gmail?callbackUrl=//evil.com']) {
      const res = signInToConnect(nav(path));
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toMatch(/^\/(en|es|pt)\/auth\/signin$/);
      const back = callbackOf(res);
      expect(back).not.toBeNull();
      expect(new URL(back!, BASE).origin).toBe(BASE);
      expect(new URL(back!, BASE).pathname).toBe('/api/inbox/gmail');
    }
    // Un path que un navegador podría leer como otro host ("//evil.com/…"): al login, sin vuelta.
    const res = signInToConnect(nav('//evil.com/api/inbox/gmail'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin).toBe(BASE);
    expect(loc.pathname).toBe('/en/auth/signin');
    expect(loc.searchParams.get('callbackUrl')).toBeNull();
  });

  it('un fetch (sin Accept: text/html) recibe el 401 de siempre', async () => {
    const res = signInToConnect(new Request(`${BASE}/api/inbox/gmail`, { headers: { accept: '*/*' } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(signInToConnect(new Request(`${BASE}/api/inbox/gmail`)).status).toBe(401);
  });

  it('una sola vuelta: si ya pasó por el login y sigue sin acceso, 401 (sin ir y volver sin fin)', () => {
    const res = signInToConnect(nav('/api/inbox/gmail?signin=1'));
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('rutas de inicio de OAuth sin sesión', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/session', () => ({
      getCurrentUser: async () => null,
      realUserId: () => '',
      userCanUseApp: () => true,
      isWorkspaceAdmin: () => true,
    }));
    vi.doMock('@/lib/mcp/identity', () => ({ delegatedIdentity: () => null }));
  });

  it.each([
    ['/api/inbox/gmail', '@/app/api/inbox/gmail/route'],
    ['/api/integrations/gmail/start', '@/app/api/integrations/gmail/start/route'],
    ['/api/integrations/google-calendar/start', '@/app/api/integrations/google-calendar/start/route'],
    ['/api/integrations/outlook/start', '@/app/api/integrations/outlook/start/route'],
    ['/api/calendar/outlook/start', '@/app/api/calendar/outlook/start/route'],
    ['/api/integrations/notion/start', '@/app/api/integrations/notion/start/route'],
    ['/api/track/slack/install', '@/app/api/track/slack/install/route'],
    ['/api/integrations/linear/connect', '@/app/api/integrations/linear/connect/route'],
  ])('%s manda al login y vuelve; no pone la cookie de state', async (path, mod) => {
    const { NextRequest } = await import('next/server');
    const { GET } = (await import(mod)) as { GET: (req: never) => Promise<Response> };
    const res = await GET(new NextRequest(`${BASE}${path}`, { headers: { accept: 'text/html' } }) as never);
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin).toBe(BASE);
    expect(loc.pathname).toBe('/en/auth/signin');
    expect(loc.searchParams.get('callbackUrl')).toBe(`${path}?signin=1`);
    expect(res.headers.get('set-cookie')).toBeNull();
    // Un cliente que no navega sigue viendo el 401.
    const api = await GET(new NextRequest(`${BASE}${path}`) as never);
    expect(api.status).toBe(401);
  });
});
