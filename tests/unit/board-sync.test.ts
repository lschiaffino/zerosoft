import { describe, expect, it, vi } from 'vitest';
import {
  baseFrom,
  clearDraft,
  draftDiffers,
  flushOnLeave,
  mergeBoardScenes,
  readDraft,
  writeDraft,
  type PutResult,
  type Reconcile,
  type SyncEl,
} from '@/lib/board-sync';
import type { BoardScene } from '@/lib/boards-types';

/**
 * Misma regla que reconcileElements de @excalidraw/excalidraw 0.18 (que no se
 * puede importar en node: toca window al cargar): gana la versión mayor, el
 * empate lo decide el versionNonce menor, y lo que se está editando queda local.
 */
const reconcile: Reconcile = (local, remote, appState) => {
  const localMap = new Map((local as SyncEl[]).map((e) => [e.id, e]));
  const editing = (appState.editingTextElement as { id?: string } | null)?.id;
  const out: SyncEl[] = [];
  const added = new Set<string>();
  for (const r of remote as SyncEl[]) {
    const l = localMap.get(r.id);
    const keepLocal =
      l &&
      (l.id === editing ||
        (l.version ?? 0) > (r.version ?? 0) ||
        ((l.version ?? 0) === (r.version ?? 0) && (l.versionNonce ?? 0) < (r.versionNonce ?? 0)));
    out.push(keepLocal ? l! : r);
    added.add(r.id);
  }
  for (const l of local as SyncEl[]) if (!added.has(l.id)) out.push(l);
  return out;
};

const el = (id: string, version: number, extra: Partial<SyncEl> & Record<string, unknown> = {}) => ({
  id,
  version,
  versionNonce: version * 7,
  type: 'rectangle',
  ...extra,
});
const scene = (elements: unknown[], bg = '#ffffff', files: Record<string, unknown> = {}): BoardScene => ({
  elements,
  appState: { viewBackgroundColor: bg },
  files,
});
const ids = (els: unknown[]) => (els as SyncEl[]).filter((e) => !e.isDeleted).map((e) => e.id).sort();
const byId = (els: unknown[], id: string) => (els as SyncEl[]).find((e) => e.id === id);

describe('mergeBoardScenes', () => {
  const baseEls = [el('a', 1), el('b', 1), el('c', 1)];
  const base = baseFrom(baseEls);

  it('suma lo que agregó cada lado en vez de pisar la escena entera', () => {
    const local = [...baseEls, el('mine', 1)];
    const server = scene([...baseEls, el('theirs', 1)]);
    const r = mergeBoardScenes({ local, localAppState: {}, localFiles: {}, server, base, reconcile });
    expect(r.ambiguous).toEqual([]);
    expect(ids(r.elements)).toEqual(['a', 'b', 'c', 'mine', 'theirs']);
  });

  it('cada elemento toma la versión más nueva de su lado', () => {
    const local = [el('a', 3, { x: 10 }), el('b', 1), el('c', 1)];
    const server = scene([el('a', 1), el('b', 4, { x: 99 }), el('c', 1)]);
    const r = mergeBoardScenes({ local, localAppState: {}, localFiles: {}, server, base, reconcile });
    expect(byId(r.elements, 'a')).toMatchObject({ version: 3, x: 10 });
    expect(byId(r.elements, 'b')).toMatchObject({ version: 4, x: 99 });
  });

  it('lo que el otro borró y acá no se tocó desaparece', () => {
    const r = mergeBoardScenes({
      local: baseEls,
      localAppState: {},
      localFiles: {},
      server: scene([el('a', 1), el('b', 1)]),
      base,
      reconcile,
    });
    expect(r.ambiguous).toEqual([]);
    expect(ids(r.elements)).toEqual(['a', 'b']);
  });

  it('lo que borré acá se mantiene borrado aunque el server lo tenga sin cambios', () => {
    const local = [el('a', 1), el('b', 1), el('c', 2, { isDeleted: true })];
    const r = mergeBoardScenes({ local, localAppState: {}, localFiles: {}, server: scene(baseEls), base, reconcile });
    expect(r.ambiguous).toEqual([]);
    expect(ids(r.elements)).toEqual(['a', 'b']);
  });

  it('editado acá y borrado allá: ambiguo, resuelto a favor de lo local hasta que la persona elija', () => {
    const local = [el('a', 5), el('b', 1), el('c', 1)];
    const r = mergeBoardScenes({ local, localAppState: {}, localFiles: {}, server: scene([el('b', 1), el('c', 1)]), base, reconcile });
    expect(r.ambiguous).toEqual(['a']);
    expect(byId(r.elements, 'a')).toMatchObject({ version: 5 });
  });

  it('borrado acá y editado allá: ambiguo aunque el server tenga versión mayor', () => {
    const local = [el('a', 2, { isDeleted: true }), el('b', 1), el('c', 1)];
    const r = mergeBoardScenes({ local, localAppState: {}, localFiles: {}, server: scene([el('a', 6), el('b', 1), el('c', 1)]), base, reconcile });
    expect(r.ambiguous).toEqual(['a']);
    expect(byId(r.elements, 'a')).toMatchObject({ isDeleted: true });
  });

  it('el texto que se está editando no se reemplaza', () => {
    const local = [el('a', 2), el('b', 1), el('c', 1)];
    const r = mergeBoardScenes({
      local,
      localAppState: { editingTextElement: { id: 'a' } },
      localFiles: {},
      server: scene([el('a', 9), el('b', 1), el('c', 1)]),
      base,
      reconcile,
    });
    expect(byId(r.elements, 'a')).toMatchObject({ version: 2 });
  });

  it('fondo: gana el lado que lo cambió; los archivos se suman', () => {
    const server = scene(baseEls, '#000000', { f1: { id: 'f1' } });
    const kept = mergeBoardScenes({
      local: baseEls,
      localAppState: { viewBackgroundColor: '#ffffff' },
      localFiles: { f2: { id: 'f2' } },
      server,
      base,
      baseBackground: '#ffffff',
      reconcile,
    });
    expect(kept.appState.viewBackgroundColor).toBe('#000000');
    expect(Object.keys(kept.files).sort()).toEqual(['f1', 'f2']);
    const mine = mergeBoardScenes({
      local: baseEls,
      localAppState: { viewBackgroundColor: '#ff0000' },
      localFiles: {},
      server,
      base,
      baseBackground: '#ffffff',
      reconcile,
    });
    expect(mine.appState.viewBackgroundColor).toBe('#ff0000');
  });

  it('sin base (borrador viejo) lo que falta en el server se conserva', () => {
    const r = mergeBoardScenes({ local: baseEls, localAppState: {}, localFiles: {}, server: scene([el('a', 1)]), base: null, reconcile });
    expect(ids(r.elements)).toEqual(['a', 'b', 'c']);
    expect(r.ambiguous).toEqual([]);
  });
});

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe('borradores locales', () => {
  it('guarda, lee y borra; uno vencido no se ofrece', () => {
    const s = memoryStorage();
    const d = { baseVersion: 3, scene: scene([el('a', 1)]), savedAt: 1000 };
    expect(writeDraft(s, 'b1', d)).toBe(true);
    expect(readDraft(s, 'b1', 2000)).toEqual(d);
    expect(readDraft(s, 'b1', 1000 + 15 * 24 * 3600 * 1000)).toBeNull();
    expect(s.m.size).toBe(0);
    writeDraft(s, 'b1', d);
    clearDraft(s, 'b1');
    expect(readDraft(s, 'b1')).toBeNull();
  });

  it('tolera storage lleno o roto', () => {
    const broken = {
      getItem: () => '{nope',
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {},
    };
    expect(writeDraft(broken, 'b', { baseVersion: 1, scene: scene([]), savedAt: 0 })).toBe(false);
    expect(readDraft(broken, 'b')).toBeNull();
    expect(readDraft(null, 'b')).toBeNull();
  });

  it('solo se ofrece si difiere de lo que hay en el servidor', () => {
    const server = scene([el('a', 1)]);
    expect(draftDiffers({ baseVersion: 1, scene: scene([el('a', 1)]), savedAt: 0 }, server)).toBe(false);
    expect(draftDiffers({ baseVersion: 1, scene: scene([el('a', 2)]), savedAt: 0 }, server)).toBe(true);
  });
});

describe('flushOnLeave: último guardado al salir del editor', () => {
  it('espera el guardado en vuelo y usa la versión que devolvió', async () => {
    let version = 5;
    let release!: () => void;
    const inFlight = new Promise<void>((r) => {
      release = () => {
        version = 6; // el PUT en vuelo terminó y subió la versión
        r();
      };
    });
    const put = vi.fn(async (_s: BoardScene, v: number): Promise<PutResult> => ({ ok: true, version: v + 1 }));
    const dropDraft = vi.fn();
    const done = flushOnLeave({
      inFlight,
      getPending: () => scene([el('a', 2)]),
      isBlocked: () => false,
      getVersion: () => version,
      put,
      saveDraft: () => {},
      dropDraft,
    });
    await Promise.resolve();
    expect(put).not.toHaveBeenCalled();
    release();
    expect(await done).toBe('saved');
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1]).toBe(6);
    expect(dropDraft).toHaveBeenCalled();
  });

  it('si el último PUT falla (409, red), queda el borrador local', async () => {
    const saveDraft = vi.fn();
    const dropDraft = vi.fn();
    const res = await flushOnLeave({
      inFlight: null,
      getPending: () => scene([el('a', 2)]),
      isBlocked: () => false,
      getVersion: () => 1,
      put: async () => ({ ok: false, status: 409 }),
      saveDraft,
      dropDraft,
    });
    expect(res).toBe('kept_draft');
    expect(saveDraft).toHaveBeenCalledWith(expect.anything(), 1);
    expect(dropDraft).not.toHaveBeenCalled();
    const offline = await flushOnLeave({
      inFlight: Promise.reject(new Error('net')),
      getPending: () => scene([el('a', 2)]),
      isBlocked: () => false,
      getVersion: () => 1,
      put: async () => {
        throw new Error('offline');
      },
      saveDraft,
      dropDraft,
    });
    expect(offline).toBe('kept_draft');
  });

  it('trabado (conflicto) o sin cambios: no manda nada', async () => {
    const put = vi.fn();
    const saveDraft = vi.fn();
    const common = { inFlight: null, getVersion: () => 1, put, saveDraft, dropDraft: () => {} };
    expect(await flushOnLeave({ ...common, getPending: () => null, isBlocked: () => false })).toBe('nothing');
    expect(await flushOnLeave({ ...common, getPending: () => scene([]), isBlocked: () => true })).toBe('kept_draft');
    expect(put).not.toHaveBeenCalled();
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});
