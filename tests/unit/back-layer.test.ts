import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLayer, openLayers, resetBackLayers } from '@/components/groups/wa/backLayer';

/**
 * "Atrás" en el teléfono (components/groups/wa/backLayer.ts): un historial falso como el del navegador
 * (pushState síncrono, go() asíncrono con su popstate) y las capas de Lines e Inbox encima.
 */

type Entry = { state: Record<string, unknown> | null };

function fakeWindow() {
  const entries: Entry[] = [{ state: { __NA: true } }];
  let index = 0;
  const listeners = new Set<(e: { state: unknown }) => void>();
  const fire = () => listeners.forEach((l) => l({ state: entries[index].state }));
  const history = {
    get state() {
      return entries[index].state;
    },
    get length() {
      return entries.length;
    },
    pushState(state: Record<string, unknown>) {
      entries.splice(index + 1);
      entries.push({ state });
      index++;
    },
    replaceState(state: Record<string, unknown>) {
      entries[index] = { state };
    },
    go(delta: number) {
      setTimeout(() => {
        index = Math.max(0, Math.min(entries.length - 1, index + delta));
        fire();
      }, 0);
    },
  };
  const win = {
    history,
    addEventListener: (type: string, fn: (e: { state: unknown }) => void) => type === 'popstate' && listeners.add(fn),
    removeEventListener: (type: string, fn: (e: { state: unknown }) => void) => type === 'popstate' && listeners.delete(fn),
  };
  return { win, back: () => history.go(-1), depth: () => (entries[index].state?.zsLayer as number | undefined) ?? 0, entries: () => entries.length, index: () => index };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

let fake: ReturnType<typeof fakeWindow>;
beforeEach(() => {
  fake = fakeWindow();
  (globalThis as unknown as { window: unknown }).window = fake.win;
  resetBackLayers();
});
afterEach(() => {
  resetBackLayers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('capas de "atrás"', () => {
  it('cada capa suma una entrada y "atrás" cierra la de arriba primero', async () => {
    const closed: string[] = [];
    openLayer(() => closed.push('chat'));
    openLayer(() => closed.push('menu'));
    await tick();
    expect(fake.depth()).toBe(2);
    fake.back();
    await tick();
    expect(closed).toEqual(['menu']);
    expect(openLayers()).toBe(1);
    fake.back();
    await tick();
    expect(closed).toEqual(['menu', 'chat']);
    expect(openLayers()).toBe(0);
  });

  it('cerrar con la interfaz saca su entrada: el próximo "atrás" no queda gastado', async () => {
    const closed: string[] = [];
    openLayer(() => closed.push('chat'));
    const removeMenu = openLayer(() => closed.push('menu'));
    await tick();
    removeMenu();
    await tick();
    expect(fake.depth()).toBe(1);
    expect(closed).toEqual([]);
    fake.back();
    await tick();
    expect(closed).toEqual(['chat']);
  });

  it('cerrar el menú y abrir la selección con el mismo toque reusa la entrada', async () => {
    openLayer(() => {});
    const removeMenu = openLayer(() => {});
    await tick();
    const before = fake.entries();
    removeMenu();
    const closed: string[] = [];
    openLayer(() => closed.push('selection'));
    await tick();
    expect(fake.depth()).toBe(2);
    expect(fake.entries()).toBe(before);
    fake.back();
    await tick();
    expect(closed).toEqual(['selection']);
  });

  it('varias capas que se cierran juntas vuelven en un solo paso', async () => {
    const closed: string[] = [];
    const removeChat = openLayer(() => closed.push('chat'));
    const removeSel = openLayer(() => closed.push('selection'));
    await tick();
    removeSel();
    removeChat();
    await tick();
    expect(fake.depth()).toBe(0);
    expect(fake.index()).toBe(0);
    expect(closed).toEqual([]);
  });

  it('una capa que se abre mientras vuelve el historial queda con su entrada', async () => {
    const remove = openLayer(() => {});
    await tick();
    remove();
    // El go(-1) todavía no llegó: la nueva capa espera y después suma su entrada.
    await Promise.resolve();
    const closed: string[] = [];
    openLayer(() => closed.push('new'));
    await tick();
    await tick();
    expect(fake.depth()).toBe(1);
    fake.back();
    await tick();
    expect(closed).toEqual(['new']);
  });
});
