import vm from 'vm';
import { describe, expect, it } from 'vitest';
import { sessionGuardScript } from '@/lib/session-guard';

/** Corre el script con un documento falso y devuelve qué hizo. */
function run(opts: { cookie: string; expected: string; online?: boolean; reloaded?: boolean }) {
  const store = new Map<string, string>(opts.reloaded ? [['zs-guard-reload', '1']] : []);
  const out = { hidden: false, reloaded: false, replaced: null as string | null, store };
  const ctx = {
    document: {
      cookie: opts.cookie,
      documentElement: {
        style: {
          set visibility(v: string) {
            out.hidden = v === 'hidden';
          },
        },
      },
    },
    navigator: { onLine: opts.online ?? true },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    location: {
      pathname: '/es/app/track',
      search: '?x=1',
      reload: () => {
        out.reloaded = true;
      },
      replace: (u: string) => {
        out.replaced = u;
      },
    },
  };
  vm.runInNewContext(sessionGuardScript(opts.expected, '/es/auth/signin'), ctx);
  return out;
}

describe('sessionGuardScript', () => {
  it('con la misma sesión no hace nada', () => {
    const r = run({ cookie: 'a=1; zs_who=abc123', expected: 'abc123' });
    expect(r).toMatchObject({ hidden: false, reloaded: false, replaced: null });
  });

  it('sin la cookie de sesión oculta la página y va al login', () => {
    const r = run({ cookie: 'a=1', expected: 'abc123', online: false });
    expect(r.hidden).toBe(true);
    expect(r.replaced).toBe(`/es/auth/signin?callbackUrl=${encodeURIComponent('/es/app/track?x=1')}`);
  });

  it('otra sesión sin red: oculta y va al login', () => {
    const r = run({ cookie: 'zs_who=fff000', expected: 'abc123', online: false });
    expect(r.hidden).toBe(true);
    expect(r.replaced).toContain('/es/auth/signin');
  });

  it('otra sesión con red: recarga una sola vez para armarla con la sesión actual', () => {
    const first = run({ cookie: 'zs_who=fff000', expected: 'abc123' });
    expect(first.hidden).toBe(true);
    expect(first.reloaded).toBe(true);
    const again = run({ cookie: 'zs_who=fff000', expected: 'abc123', reloaded: true });
    expect(again.reloaded).toBe(false);
    expect(again.replaced).toContain('/es/auth/signin');
  });

  it('página armada sin cookie en el pedido: alcanza con que la sesión tenga cookie', () => {
    const r = run({ cookie: 'zs_who=abc123', expected: '' });
    expect(r).toMatchObject({ hidden: false, reloaded: false, replaced: null });
  });

  it('el valor esperado no puede romper el script', () => {
    expect(() => run({ cookie: 'zs_who=abc', expected: "';alert(1);//" })).not.toThrow();
  });
});
