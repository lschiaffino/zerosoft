import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeMenusOutside, fitToViewport, openLayer, openLayerCount } from '@/lib/ui/layers';

/** Nodo mínimo: contains() por árbol de padres, como el DOM. */
interface FakeNode {
  name: string;
  parent: FakeNode | null;
  contains(other: FakeNode | null): boolean;
}
function node(name: string, parent: FakeNode | null = null): FakeNode {
  const n: FakeNode = {
    name,
    parent,
    contains(other) {
      for (let cur = other; cur; cur = cur.parent) if (cur === n) return true;
      return false;
    },
  };
  return n;
}
const el = (n: FakeNode) => n as unknown as HTMLElement;

const releases: Array<() => void> = [];
afterEach(() => {
  while (releases.length) releases.pop()!();
  vi.unstubAllGlobals();
});

/** Como un componente: al cerrarse se desmonta y sale del registro. */
function open(kind: 'menu' | 'dialog', root: FakeNode, trigger: FakeNode | null, onClose: (r: string) => void) {
  let release = () => {};
  ({ release } = openLayer({
    kind,
    root: () => el(root),
    trigger: () => (trigger ? el(trigger) : null),
    close: (r) => {
      onClose(r);
      release();
    },
  }));
  releases.push(() => release());
  return () => release();
}

describe('registro de capas', () => {
  it('abrir un menú cierra el que estaba abierto', () => {
    const page = node('page');
    const switcher = node('switcher', page);
    const account = node('account', page);
    const closed: string[] = [];
    open('menu', switcher, node('switcher-btn', switcher), (r) => closed.push(`switcher:${r}`));
    open('menu', account, node('account-btn', account), (r) => closed.push(`account:${r}`));
    expect(closed).toEqual(['switcher:other-layer']);
  });

  it('un submenú (botón dentro del menú abierto) no cierra a su padre', () => {
    const menu = node('menu');
    const inner = node('inner', menu);
    const closed: string[] = [];
    open('menu', menu, null, () => closed.push('menu'));
    // El submenú se portalea afuera, pero su botón vive dentro del menú.
    open('menu', node('portal'), inner, () => closed.push('inner'));
    expect(closed).toEqual([]);
  });

  it('un diálogo cierra los menús, y un menú no cierra el diálogo', () => {
    const closed: string[] = [];
    open('menu', node('menu'), null, () => closed.push('menu'));
    const dialog = node('cmdk');
    open('dialog', dialog, null, () => closed.push('dialog'));
    expect(closed).toEqual(['menu']);
    open('menu', node('picker', dialog), null, () => closed.push('picker'));
    expect(closed).toEqual(['menu']);
  });

  it('closeMenusOutside respeta el menú que contiene al nodo', () => {
    const a = node('a');
    const b = node('b');
    const closed: string[] = [];
    open('menu', a, null, () => closed.push('a'));
    open('menu', b, null, () => closed.push('b'));
    expect(closed).toEqual(['a']);
    closeMenusOutside(el(node('x', b)));
    expect(closed).toEqual(['a']);
    closeMenusOutside(el(node('y')));
    expect(closed).toEqual(['a', 'b']);
  });

  it('al soltar la capa deja de contarse', () => {
    const before = openLayerCount();
    const release = open('menu', node('m'), null, () => {});
    expect(openLayerCount()).toBe(before + 1);
    release();
    expect(openLayerCount()).toBe(before);
  });
});

describe('acomodo en pantalla', () => {
  function panelAt(rect: { left: number; top: number; width: number; height: number }) {
    const style: Record<string, string> = {};
    const r = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top };
    return { style, getBoundingClientRect: () => r } as unknown as HTMLElement & { style: Record<string, string> };
  }
  function triggerAt(rect: { left: number; top: number; width: number; height: number }) {
    const r = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
    return { getBoundingClientRect: () => r } as unknown as HTMLElement;
  }
  function viewport(w: number, h: number) {
    vi.stubGlobal('window', { innerWidth: w, innerHeight: h });
    vi.stubGlobal('document', { documentElement: { clientWidth: w } });
  }

  it('si no entra abajo y arriba hay lugar, abre para arriba sin tapar el botón', () => {
    viewport(1280, 800);
    const trigger = triggerAt({ left: 100, top: 700, width: 80, height: 30 });
    const panel = panelAt({ left: 100, top: 734, width: 200, height: 300 });
    fitToViewport(panel, trigger);
    const [, dy] = panel.style.translate.split(' ').map((v: string) => parseFloat(v));
    expect(734 + dy + 300).toBeLessThanOrEqual(700);
  });

  it('se corre a la izquierda si se sale por la derecha', () => {
    viewport(390, 844);
    const trigger = triggerAt({ left: 340, top: 10, width: 30, height: 30 });
    const panel = panelAt({ left: 340, top: 44, width: 340, height: 200 });
    fitToViewport(panel, trigger);
    const [dx] = panel.style.translate.split(' ').map((v: string) => parseFloat(v));
    expect(340 + dx + 340).toBeLessThanOrEqual(390 - 8);
    expect(340 + dx).toBeGreaterThanOrEqual(8);
  });

  it('si no entra de ningún lado se achica con scroll', () => {
    viewport(1280, 400);
    const trigger = triggerAt({ left: 10, top: 150, width: 80, height: 30 });
    const panel = panelAt({ left: 10, top: 184, width: 200, height: 600 });
    fitToViewport(panel, trigger);
    expect(parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(400 - 184);
    expect(panel.style.overflowY).toBe('auto');
  });

  it('dentro de la pantalla no lo toca', () => {
    viewport(1280, 800);
    const panel = panelAt({ left: 10, top: 40, width: 200, height: 300 });
    fitToViewport(panel, triggerAt({ left: 10, top: 6, width: 80, height: 30 }));
    expect(panel.style.translate).toBe('');
    expect(panel.style.maxHeight).toBe('');
  });
});
