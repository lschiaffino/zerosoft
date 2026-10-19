import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RETURN_PATH_HEADER, RETURN_PATH_MAX, fitReturnPath, pathWithQuery, safeInternalPath, signInPath } from '@/lib/return-path';
import { safeCallbackUrl } from '@/lib/hosts';

const state = vi.hoisted(() => ({ header: null as string | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => null, default: () => null }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.header ? { 'x-zs-return-path': state.header } : {}),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { requireUser } = await import('@/lib/session');

beforeEach(() => {
  state.header = null;
});

describe('safeInternalPath', () => {
  it('acepta paths internos con query', () => {
    expect(safeInternalPath('/es/app/notes?note=abc')).toBe('/es/app/notes?note=abc');
  });
  it.each(['https://evil.com/x', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'es/app', '/a\nb', '', null, undefined])(
    'rechaza %s',
    (raw) => {
      expect(safeInternalPath(raw as string)).toBeNull();
    },
  );
});

describe('fitReturnPath', () => {
  it('deja intacto lo que entra', () => {
    expect(fitReturnPath('/en/app/notes?note=1')).toBe('/en/app/notes?note=1');
  });
  it('recorta el parámetro más largo (la selección del clip) y conserva el resto', () => {
    const sel = 'á'.repeat(5000);
    const path = pathWithQuery('/es/app/notes/clip', { url: 'https://example.com/post', title: 'Un post', selection: sel });
    const fitted = fitReturnPath(path);
    expect(fitted.length).toBeLessThanOrEqual(RETURN_PATH_MAX);
    const u = new URL(fitted, 'http://x');
    expect(u.pathname).toBe('/es/app/notes/clip');
    expect(u.searchParams.get('url')).toBe('https://example.com/post');
    expect(u.searchParams.get('title')).toBe('Un post');
    expect(sel.startsWith(u.searchParams.get('selection')!)).toBe(true);
    expect(u.searchParams.get('selection')!.length).toBeGreaterThan(100);
  });
});

describe('signInPath', () => {
  it('pasa callbackUrl y el sign-in lo acepta', () => {
    const href = signInPath('es', '/es/app/notes?note=n1');
    expect(href).toBe(`/es/auth/signin?callbackUrl=${encodeURIComponent('/es/app/notes?note=n1')}`);
    const cb = new URL(href, 'http://x').searchParams.get('callbackUrl');
    expect(safeCallbackUrl(cb, 'http://localhost:3000')).toBe('/es/app/notes?note=n1');
  });
  it('un clip largo sigue entrando en el callbackUrl del sign-in', () => {
    const path = pathWithQuery('/en/app/notes/clip', { url: 'https://a.com', selection: 'x'.repeat(8000) });
    const cb = new URL(signInPath('en', path), 'http://x').searchParams.get('callbackUrl');
    expect(safeCallbackUrl(cb, 'http://localhost:3000')).toBe(cb);
  });
  it('sin path seguro, sign-in a secas', () => {
    expect(signInPath('pt', 'https://evil.com')).toBe('/pt/auth/signin');
    expect(signInPath('pt', null)).toBe('/pt/auth/signin');
  });
});

describe('requireUser', () => {
  it('redirige al sign-in con el path que le pasa la página', async () => {
    await expect(requireUser('es', '/es/app/notes/clip?url=https%3A%2F%2Fa.com&title=Hola')).rejects.toThrow(
      `REDIRECT:/es/auth/signin?callbackUrl=${encodeURIComponent('/es/app/notes/clip?url=https%3A%2F%2Fa.com&title=Hola')}`,
    );
  });
  it('sin path explícito usa el header del middleware (layouts)', async () => {
    expect(RETURN_PATH_HEADER).toBe('x-zs-return-path');
    state.header = '/en/app/notes?note=abc';
    await expect(requireUser('en')).rejects.toThrow(`REDIRECT:/en/auth/signin?callbackUrl=${encodeURIComponent('/en/app/notes?note=abc')}`);
  });
  it('un destino externo se ignora', async () => {
    state.header = '//evil.com/x';
    await expect(requireUser('en')).rejects.toThrow(/^REDIRECT:\/en\/auth\/signin$/);
  });
});
