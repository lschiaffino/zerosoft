'use client';

/**
 * Edición simultánea en el editor de Docs: une el motor
 * (lib/docs-coedit-client.ts) con el editor y con el feed en vivo de la
 * página (SSE, con polling de respaldo; lib/realtime-client.ts).
 * - Lo que se escribe en un bloque que ya existe en el servidor sale como
 *   operación a los ~120 ms; lo de las demás personas entra en la pantalla
 *   tecla por tecla, con el caret corrido y fuera del deshacer propio.
 * - Los cursores de las demás personas llegan por el mismo feed.
 * - Si la persona pierde el acceso, el servidor corta el stream y el editor
 *   deja de mostrar y mandar cambios.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { CoeditEngine, type CoeditScreen, type CoeditTransport } from '@/lib/docs-coedit-client';
import type { CoeditEvent, CoeditOpResult } from '@/lib/docs-coedit-shared';
import { hasUnsafeMarkup, isCoeditBlock } from '@/lib/docs-coedit-shared';
import { sanitizeHtml } from '@/lib/docs-richtext';
import type { DocsBlock } from '@/lib/docs-types';
import type { TextOp } from '@/lib/docs-ot';
import { useRealtime, type RealtimeStatus } from '@/lib/realtime-client';
import type { DocsEditorApi } from './useDocsCollab';

type CursorEvent = Extract<CoeditEvent, { kind: 'cursor' }>;

export interface CoeditOptions {
  pageId: string;
  session: string;
  /** Puede escribir (modo edición): manda operaciones. Sin esto solo recibe. */
  canSend: boolean;
  /** Abre el stream (acceso interno a la página). */
  enabled: boolean;
  editorApi: MutableRefObject<DocsEditorApi | null>;
  bypassLock: () => boolean;
  selfUserId: string | null;
  onCursor: (ev: CursorEvent) => void;
  onLeave: (session: string) => void;
  onSaved: () => void;
  onAccess: (access: string) => void;
  onRevoked: () => void;
  onSendError?: (code: string) => void;
  onSendOk?: () => void;
  /** Un bloque dejó de viajar por operaciones: su texto tiene que salir por el guardado. */
  onUnmanaged?: (block: string, reason: 'unsupported' | 'too_large') => void;
}

const statusCode = (status: number) => (status === 403 ? 'forbidden' : status === 423 ? 'locked' : status === 404 ? 'not_found' : `http_${status}`);

export function useDocsCoedit(o: CoeditOptions): {
  engine: MutableRefObject<CoeditEngine | null>;
  status: RealtimeStatus;
  localChanged: () => void;
  register: (blocks: DocsBlock[], prune?: boolean) => void;
  manages: (id: string) => boolean;
  sendCursor: (cursor: { block: string | null; start: number | null; end: number | null; mode: string }) => void;
  sendItems: (items: Parameters<CoeditTransport['send']>[0]) => Promise<CoeditOpResult[] | null>;
} {
  const opts = useRef(o);
  opts.current = o;
  const engineRef = useRef<CoeditEngine | null>(null);
  const url = `/api/docs/collab?page=${encodeURIComponent(o.pageId)}`;

  const post = useCallback(
    async (body: Record<string, unknown>) =>
      fetch('/api/docs/collab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: opts.current.pageId, session: opts.current.session, ...body }),
      }),
    [],
  );

  // Motor: uno por página y sesión.
  if (!engineRef.current || engineRef.current.session !== o.session) {
    engineRef.current?.stop();
    // Cambios pendientes de pintar (varias operaciones en el mismo instante van juntas).
    const overlay = new Map<string, { text: string; steps: Array<{ op: TextOp; prev: string }> }>();
    let scheduled = false;
    const paint = () => {
      scheduled = false;
      const api = opts.current.editorApi.current;
      if (!api || !overlay.size) return;
      const changes: Record<string, string> = {};
      const steps: Record<string, Array<{ op: TextOp; prev: string }>> = {};
      for (const [id, v] of overlay) {
        // Defensa en profundidad: el servidor ya no reparte HTML que el editor no admite; si llegara, se sanea antes de pintarlo.
        changes[id] = hasUnsafeMarkup(v.text) ? sanitizeHtml(v.text) : v.text;
        steps[id] = v.steps;
      }
      overlay.clear();
      // Las operaciones exactas: corren el caret y rebasan el deshacer (solo se deshace lo propio).
      api.applyBlockText(changes, steps);
    };
    const screen: CoeditScreen = {
      get: (block) => overlay.get(block)?.text ?? opts.current.editorApi.current?.blockText(block) ?? null,
      set: (block, text, op, prev) => {
        const cur = overlay.get(block);
        overlay.set(block, { text, steps: [...(cur?.steps ?? []), { op, prev }] });
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(paint);
        }
      },
      busy: () => opts.current.editorApi.current?.busy() ?? false,
    };
    const transport: CoeditTransport = {
      send: async (items) => {
        const res = await fetch('/api/docs/collab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: opts.current.pageId, session: opts.current.session, items, bypass_lock: opts.current.bypassLock() || undefined }),
        });
        if (!res.ok) throw new Error(statusCode(res.status));
        return ((await res.json()) as { results: CoeditOpResult[] }).results;
      },
      snapshot: async (blocks) => {
        const res = await fetch(`/api/docs/collab?page=${encodeURIComponent(opts.current.pageId)}&blocks=${blocks.map(encodeURIComponent).join(',')}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(statusCode(res.status));
        return ((await res.json()) as { blocks: Record<string, { rev: number; text: string } | null> }).blocks;
      },
    };
    engineRef.current = new CoeditEngine(o.session, screen, transport, {
      onError: (c) => opts.current.onSendError?.(c),
      onOk: () => opts.current.onSendOk?.(),
      onUnmanaged: (block, reason) => opts.current.onUnmanaged?.(block, reason),
    });
  }

  useEffect(() => () => engineRef.current?.stop(), []);

  // Volvió la red: lo pendiente sale ya.
  useEffect(() => {
    const online = () => engineRef.current?.resume();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);

  const lastSaved = useRef(0);
  const onEvents = useCallback((events: CoeditEvent[]) => {
    const c = opts.current;
    for (const ev of events) {
      switch (ev.kind) {
        case 'op':
          engineRef.current?.receive(ev);
          break;
        case 'cursor':
          if (ev.session !== c.session && ev.user !== c.selfUserId) c.onCursor(ev);
          break;
        case 'leave':
          if (ev.session !== c.session) c.onLeave(ev.session);
          break;
        case 'save':
          // Otra persona guardó la estructura: el pulso trae la versión nueva ya.
          if (Date.now() - lastSaved.current > 300) {
            lastSaved.current = Date.now();
            c.onSaved();
          }
          break;
        case 'access':
          c.onAccess(ev.access);
          break;
        case 'revoked':
          c.onRevoked();
          break;
      }
    }
  }, []);

  const { status } = useRealtime<CoeditEvent>({
    streamUrl: url,
    pollUrl: `${url}&poll=1`,
    cursor: 0,
    enabled: o.enabled,
    heartbeatMs: 15_000,
    pollMs: 1_000,
    onEvents,
    // Reconectó: lo que se perdió llegó por el atraso; lo propio pendiente sale ya.
    onConnect: () => engineRef.current?.resume(),
    onReset: () => engineRef.current?.forgetRevs(),
    onRevoked: () => opts.current.onRevoked(),
  });

  const localChanged = useCallback(() => {
    if (opts.current.canSend) engineRef.current?.localChanged();
  }, []);

  const register = useCallback((blocks: DocsBlock[], prune = false) => {
    engineRef.current?.register(
      blocks.filter((b) => isCoeditBlock(b)).map((b) => ({ id: b.id, text: b.content })),
      { prune },
    );
  }, []);

  const lastCursor = useRef<{ at: number; key: string; timer: ReturnType<typeof setTimeout> | null }>({ at: 0, key: '', timer: null });
  const sendCursor = useCallback(
    (cursor: { block: string | null; start: number | null; end: number | null; mode: string }) => {
      const key = JSON.stringify(cursor);
      const st = lastCursor.current;
      if (key === st.key) return;
      if (st.timer) clearTimeout(st.timer);
      const run = () => {
        st.timer = null;
        st.at = Date.now();
        st.key = key;
        void post({ cursor }).catch(() => undefined);
      };
      // A lo sumo uno cada 200 ms.
      const wait = Math.max(0, 200 - (Date.now() - st.at));
      if (wait === 0) run();
      else st.timer = setTimeout(run, wait);
    },
    [post],
  );

  const sendItems = useCallback(async (items: Parameters<CoeditTransport['send']>[0]) => {
    const res = await post({ items, bypass_lock: opts.current.bypassLock() || undefined }).catch(() => null);
    if (!res?.ok) return null;
    return ((await res.json()) as { results: CoeditOpResult[] }).results;
  }, [post]);

  return { engine: engineRef, status, localChanged, register, manages: (id) => engineRef.current?.manages(id) ?? false, sendCursor, sendItems };
}
