'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NotesHome from './NotesHome';
import { NotesTasksList } from './NoteTasks';
import { NoteAccessGate } from './NoteAccess';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DocsBlock } from '@/lib/docs-types';
import { registerAppServiceWorker } from '@/lib/sw-client';
import { whoCookie } from '@/lib/docs-offline';
import { fileBlockFromUpload, type DocsUploadResult } from '@/lib/docs-files';
import {
  blocksToText,
  makeSnippet,
  type NoteDetail,
  type NoteLockEnvelope,
  type NoteSummary,
  type NotebookInfo,
  type NotesSort,
  type SavedSearchInfo,
  type TagInfo,
} from '@/lib/notes-types';
import NoteEditorPane, { type SaveStatus } from './NoteEditorPane';
import { NotebookShareDrawer } from './NoteSharePeople';
import NotesAskPanel from './NotesAskPanel';
import NotesIcon from './NotesIcon';
import NotesTemplatesDialog from './NotesTemplatesDialog';
import { NotebooksNav, SavedSearchesNav, TagsNav } from './NotesNavSections';
import { PromptDialog } from './NotesModal';
import { usePopover } from './usePopover';
import {
  SEARCH_OPERATORS,
  emptyKind,
  filterQuery,
  highlightTerms,
  isTypingTarget,
  listKey,
  nextSelection,
  sameFilter,
  stepIndex,
  type NotesFilter,
} from './notes-ui';
import {
  NotesOfflineStore,
  applyPatchLocally,
  identityMatches,
  makeOp,
  offlineList,
  replayOutbox,
  retryDelay,
  withFlushLock,
  type CachedNote,
  type IdentityRecord,
  type OfflineOwner,
  type StuckOp,
} from './notesOffline';
import { isRecordingActive } from './NoteCapture';
import { parseDbUtc } from '@/lib/utils';

export type { NotesFilter } from './notes-ui';

type Pane = 'nav' | 'list' | 'editor';

interface Props {
  locale: string;
  aiEnabled: boolean;
  initialNotes: NoteSummary[];
  initialNotebooks: NotebookInfo[];
  initialTags: TagInfo[];
  initialNote: NoteDetail | null;
  /** Filtro inicial de la lista (p. ej. "Compartidas conmigo" desde un aviso). */
  initialFilter?: NotesFilter;
  /** El link abierto es de una nota del workspace sin permiso: se puede pedir acceso. */
  initialDenied?: { id: string; status: 'can_request' | 'pending' | 'denied' | 'denied_wait' } | null;
  /** Aviso de un pedido de acceso: abre Compartir en la nota. */
  openRequests?: boolean;
  /** Hay IA para buscar por significado. */
  semanticAvailable?: boolean;
  initialSearches?: SavedSearchInfo[];
  /** Búsqueda con la que abre (?q= o una búsqueda guardada de ⌘K). */
  initialQuery?: string;
  initialSearchId?: string | null;
  /** Plantilla propia elegida en ⌘K: crea la nota al entrar. */
  initialTemplate?: { title: string; content: DocsBlock[] } | null;
  /** Persona y workspace de la copia offline (IndexedDB). */
  offlineOwner?: OfflineOwner;
  startNew?: boolean;
  /** "Ahora" del render del servidor (fechas relativas sin hydration mismatch). */
  serverNow: number;
}

const TOAST_MS = 6000;
const SYNC_PAGES = 20;

/** El fetch falló por red (no por una respuesta del servidor). */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

/** Prompts del sidebar y la lista (uno a la vez). */
type Prompt =
  | { kind: 'saveSearch' }
  | { kind: 'renameSearch'; search: SavedSearchInfo }
  | { kind: 'stack'; notebook: NotebookInfo }
  | { kind: 'renameStack'; stack: string }
  | { kind: 'renameTag'; tag: string };

type Confirm =
  | { kind: 'deleteSearch'; search: SavedSearchInfo }
  | { kind: 'deleteTag'; tag: string }
  | { kind: 'bulkDelete'; ids: string[] };

/**
 * Notes: tres paneles (libretas · lista · editor), como Apple Notes. En
 * pantallas chicas se ve un panel por vez, con navegación hacia atrás.
 * Teclado: N nueva nota, / buscar, flechas para recorrer la lista, ⌘/Shift
 * clic para elegir varias. Sin red sigue andando con la copia del
 * dispositivo (components/notes/notesOffline.ts).
 */
export default function NotesApp({
  aiEnabled,
  initialNotes,
  initialNotebooks,
  initialTags,
  initialNote,
  initialFilter,
  initialDenied = null,
  openRequests = false,
  semanticAvailable = false,
  initialSearches = [],
  initialQuery = '',
  initialSearchId = null,
  initialTemplate = null,
  offlineOwner,
  startNew = false,
  serverNow,
}: Props) {
  const t = useTranslations('notes');
  const format = useFormatter();
  const locale = useLocale();
  const [filter, setFilter] = useState<NotesFilter>(initialFilter ?? { kind: 'all' });
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState<NotesSort>('updated');
  const [notes, setNotes] = useState<NoteSummary[]>(initialNotes);
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>(initialNotebooks);
  const [tags, setTags] = useState<TagInfo[]>(initialTags);
  const [searches, setSearches] = useState<SavedSearchInfo[]>(initialSearches);
  const [activeSearch, setActiveSearch] = useState<string | null>(initialSearchId);
  const [note, setNote] = useState<NoteDetail | null>(initialNote);
  const [pane, setPane] = useState<Pane>(initialNote || initialDenied ? 'editor' : 'list');
  const denied = note ? null : initialDenied;
  const [semantic, setSemantic] = useState(false);
  const [semanticDegraded, setSemanticDegraded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState(() => listKey(initialFilter ?? { kind: 'all' }, 'updated'));
  const [listError, setListError] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newNotebook, setNewNotebook] = useState(false);
  const [renamingNotebook, setRenamingNotebook] = useState<string | null>(null);
  const [sharingNotebook, setSharingNotebook] = useState<NotebookInfo | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [confirmState, setConfirmState] = useState<Confirm | null>(null);
  const [focusTitle, setFocusTitle] = useState(0);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [toast, setToast] = useState<string | null>(null);
  /** Aviso de éxito (importación); `toast` es siempre de error. */
  const [okToast, setOkToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** Selección múltiple (mover, etiquetar, papelera, exportar). */
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  /** Términos de la búsqueda con la que se abrió la nota (se resaltan). */
  const [highlight, setHighlight] = useState<string[]>(() => (initialNote && initialQuery ? highlightTerms(initialQuery) : []));
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const offlineRef = useRef(false);
  offlineRef.current = offline;
  const storeRef = useRef<NotesOfflineStore | null>(null);
  /** flushOutbox, para usarla desde sendPatch (que se define antes). */
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const importRef = useRef<HTMLInputElement>(null);
  const searchHelp = usePopover();
  const searchRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);
  /** Al cambiar de filtro, la nota abierta se cierra si no está en la lista nueva. */
  const dropStaleNote = useRef(false);
  const reqSeq = useRef(0);
  /** POSTs de notas recién creadas aún en vuelo (id → ok). */
  const pendingCreates = useRef(new Map<string, Promise<boolean>>());
  const [now, setNow] = useState(serverNow);
  /** `updated_at` que conoce este cliente por nota: va en cada PATCH (409 si cambió en otro lado). */
  const bases = useRef(new Map<string, string>(initialNote ? [[initialNote.id, initialNote.updated_at]] : []));
  /** Guardados de una nota en fila: dos en paralelo con la misma base chocarían entre sí. */
  const saveChains = useRef(new Map<string, Promise<unknown>>());
  /**
   * Conflicto: la nota cambió en otra pestaña o dispositivo (o fue a la
   * papelera). `retry` vuelve a mandar lo último propio sin chequear la base.
   */
  const [conflict, setConflict] = useState<{ id: string; trashed: boolean; retry: (() => Promise<unknown>) | null } | null>(null);
  /** Sube al recargar la nota tras un conflicto: el editor se monta de nuevo con el contenido del servidor. */
  const [editorKey, setEditorKey] = useState(0);

  const ownerUser = offlineOwner?.userId ?? '';
  const ownerWs = offlineOwner?.ws ?? '';
  /** La base del dispositivo, antes de confirmar de quién es (storeRef recién con la identidad confirmada). */
  const candidateStore = useRef<NotesOfflineStore | null>(null);
  /** Cambios que el servidor rechazó (para copiar o descartar). */
  const [stuck, setStuck] = useState<StuckOp[]>([]);
  const retryAttempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ownerUser || !NotesOfflineStore.available()) return;
    const store = new NotesOfflineStore({ userId: ownerUser, ws: ownerWs });
    candidateStore.current = store;
    return () => {
      store.close();
      if (candidateStore.current === store) candidateStore.current = null;
      if (storeRef.current === store) storeRef.current = null;
    };
  }, [ownerUser, ownerWs]);

  /**
   * ¿La copia del dispositivo es de quien está en la sesión? Con red lo dice
   * el servidor (y se guarda la cookie zs_who de ese momento); sin red, la
   * cookie actual tiene que ser esa. Hasta confirmar no se abre la copia, no
   * se reenvía la cola ni se sincroniza: una página guardada de otra persona
   * o una sesión vencida no ven ni mandan nada.
   */
  const confirmIdentity = useCallback(async (): Promise<boolean> => {
    const store = candidateStore.current;
    if (!store) return false;
    const who = whoCookie();
    const deny = () => {
      storeRef.current = null;
      return false;
    };
    if (!offlineRef.current) {
      try {
        const res = await fetch('/api/notes/sync?probe=1', { cache: 'no-store' });
        if (!res.ok) return deny();
        const data = (await res.json()) as { owner?: { userId: string; ws: string } };
        if (data.owner?.userId !== ownerUser || data.owner?.ws !== ownerWs || !who) return deny();
        await store.setMeta('identity', { who, at: Date.now() } satisfies IdentityRecord);
        storeRef.current = store;
        setStuck(await store.stuckOps().catch(() => []));
        return true;
      } catch (err) {
        if (!isNetworkError(err)) return deny();
        setOffline(true);
      }
    }
    const rec = await store.getMeta<IdentityRecord>('identity').catch(() => null);
    if (!identityMatches(rec, who)) return deny();
    storeRef.current = store;
    setStuck(await store.stuckOps().catch(() => []));
    return true;
  }, [ownerUser, ownerWs]);

  /** Encola un PATCH de la nota detrás de los anteriores. */
  const enqueue = useCallback(<T,>(id: string, run: () => Promise<T>): Promise<T> => {
    const prev = saveChains.current.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    saveChains.current.set(id, next);
    void next
      .catch(() => {})
      .finally(() => {
        if (saveChains.current.get(id) === next) saveChains.current.delete(id);
      });
    return next;
  }, []);

  /** Guarda un cambio en la copia del dispositivo y lo encola para cuando vuelva la red. */
  const saveLocally = useCallback(
    async (id: string, patch: Record<string, unknown>, base: string | null, markOffline = true): Promise<NoteDetail | null> => {
      const store = storeRef.current;
      if (!store) return null;
      const cached = await store.get(id).catch(() => null);
      if (!cached) return null;
      // La versión del servidor sobre la que se edita: la que conoce esta pestaña o la guardada con la nota.
      // Sin ninguna, el reenvío no pisa nada (queda como copia).
      await store.enqueue(makeOp({ kind: 'patch', id, patch, base: base ?? cached.server_updated_at ?? null }));
      const next = applyPatchLocally(cached, patch, new Date().toISOString());
      await store.putNote(next);
      if (markOffline) setOffline(true);
      return next as NoteDetail;
    },
    [],
  );

  /** Manda un PATCH con la base conocida (o sin ella, para "conservar la mía"). Sin red, queda en el dispositivo. */
  const sendPatch = useCallback(
    async (
      id: string,
      patch: Record<string, unknown>,
      force = false,
    ): Promise<
      { conflict: 'trashed' | 'changed'; updated?: undefined; local?: undefined } | { conflict?: undefined; updated: NoteDetail; local?: boolean }
    > => {
      const base = bases.current.get(id);
      const body = force || !base ? patch : { ...patch, base_updated_at: base };
      // Volvió la red pero la nota todavía tiene cambios offline sin subir
      // (por ejemplo, se creó sin red): va detrás de ellos en la cola.
      const store = storeRef.current;
      if (store && !offlineRef.current) {
        const pending = await store.outbox().catch(() => []);
        if (pending.some((o) => o.id === id)) {
          const local = await saveLocally(id, patch, force ? (bases.current.get(id) ?? null) : (base ?? null), false);
          if (local) {
            void flushRef.current();
            return { updated: local, local: true };
          }
        }
      }
      let res: Response;
      try {
        if (offlineRef.current) throw new TypeError('offline');
        res = await fetch(`/api/notes/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        const local = await saveLocally(id, patch, base ?? null);
        if (!local) throw err;
        return { updated: local, local: true };
      }
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        return { conflict: data?.error === 'note_trashed' ? 'trashed' : 'changed' };
      }
      if (!res.ok) throw new Error(String(res.status));
      const updated = (await res.json()) as NoteDetail;
      bases.current.set(id, updated.updated_at);
      void storeRef.current?.putDetails([updated]).catch(() => undefined);
      return { updated };
    },
    [saveLocally],
  );

  useEffect(() => {
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(h);
  }, [toast]);

  useEffect(() => {
    if (!okToast) return;
    const h = setTimeout(() => setOkToast(null), TOAST_MS);
    return () => clearTimeout(h);
  }, [okToast]);

  /** Lista desde la copia del dispositivo (sin red). */
  const listFromDevice = useCallback(
    async (key: string, seq: number) => {
      const store = storeRef.current;
      const all = store ? await store.all().catch(() => [] as CachedNote[]) : [];
      if (seq !== reqSeq.current) return;
      setNotes(offlineList(all, filter, q, sort, notebooks));
      setLoadedKey(key);
      setListError(false);
    },
    [filter, q, sort, notebooks],
  );

  const refreshList = useCallback(async () => {
    const seq = ++reqSeq.current;
    const key = listKey(filter, sort);
    setLoading(true);
    try {
      if (offlineRef.current) throw new TypeError('offline');
      const useSemantic = semantic && q.trim().length > 0;
      const res = await fetch(useSemantic ? `/api/notes/semantic?q=${encodeURIComponent(q.trim())}` : `/api/notes?${filterQuery(filter, q, sort)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { notes: NoteSummary[]; degraded?: boolean };
      if (seq === reqSeq.current) {
        setSemanticDegraded(Boolean(useSemantic && data.degraded));
        setNotes(data.notes);
        if (dropStaleNote.current) {
          dropStaleNote.current = false;
          setNote((cur) =>
            cur && !pendingCreates.current.has(cur.id) && !data.notes.some((n) => n.id === cur.id) ? null : cur,
          );
        }
        setLoadedKey(key);
        setListError(false);
      }
      if (filter.kind !== 'shared') void storeRef.current?.putSummaries(data.notes).catch(() => undefined);
    } catch (err) {
      if (isNetworkError(err) && storeRef.current) {
        setOffline(true);
        await listFromDevice(key, seq);
      } else if (seq === reqSeq.current) setListError(true);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [filter, q, sort, semantic, listFromDevice]);

  /**
   * Cambios rechazados → notas nuevas: el texto en claro, o la bloqueada con
   * su mismo sobre (se abre con la misma contraseña).
   */
  async function recoverStuck() {
    const store = storeRef.current;
    if (!store) return;
    let saved = 0;
    for (const x of stuck) {
      const id = crypto.randomUUID();
      const title = t('offline.copyTitle', { title: x.title || t('untitled') });
      try {
        const created = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, title, content: x.lock ? [] : (x.content ?? [{ id: crypto.randomUUID(), type: 'paragraph', content: x.text }]) }),
        });
        if (!created.ok) continue;
        if (x.lock) {
          const locked = await fetch(`/api/notes/${id}/lock`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'lock', lock: x.lock, content: x.content ?? [] }),
          });
          if (!locked.ok) {
            await fetch(`/api/notes/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
            await fetch(`/api/notes/${id}`, { method: 'DELETE' });
            continue;
          }
        }
        await store.dropStuck(x.opId);
        saved++;
      } catch {
        break;
      }
    }
    setStuck(await store.stuckOps().catch(() => []));
    if (saved) setOkToast(t('offline.recovered', { count: saved }));
    else setToast(t('editor.actionError'));
    void refreshList();
  }

  const refreshListRef = useRef<() => Promise<void>>(async () => undefined);
  refreshListRef.current = refreshList;

  const refreshSide = useCallback(async () => {
    if (offlineRef.current) return;
    const [nb, tg] = await Promise.all([
      fetch('/api/notes/notebooks').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/notes/tags').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (nb) setNotebooks(nb.notebooks);
    if (tg) setTags(tg.tags);
  }, []);

  /**
   * Baja a la copia del dispositivo lo que cambió desde la última vez
   * (todas las notas propias, con bloques), para abrirlas sin red.
   */
  const syncDevice = useCallback(async () => {
    const store = storeRef.current;
    if (!store || offlineRef.current) return;
    try {
      const since = await store.getMeta<string>('since');
      const keep = new Set((await store.outbox()).map((o) => o.id));
      let offset = 0;
      let stamp: string | null = null;
      for (let page = 0; page < SYNC_PAGES; page++) {
        const sp = new URLSearchParams();
        if (since) sp.set('since', since);
        if (offset) sp.set('offset', String(offset));
        const res = await fetch(`/api/notes/sync?${sp.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          notes: NoteDetail[];
          index: NoteSummary[];
          notebooks: NotebookInfo[];
          tags: TagInfo[];
          now: string;
          nextOffset: number | null;
        };
        if (page === 0) {
          stamp = data.now;
          await store.putSummaries(data.index, { prune: true, keep });
          await store.setMeta('notebooks', data.notebooks);
          await store.setMeta('tags', data.tags);
        }
        await store.putDetails(data.notes, { keep });
        if (data.nextOffset == null) break;
        offset = data.nextOffset;
      }
      if (stamp) await store.setMeta('since', stamp);
    } catch {
      /* sin red o sin almacenamiento: queda para la próxima */
    }
  }, []);

  /** Reenvía los cambios hechos sin red (uno por vez: un segundo pedido espera al que está corriendo). */
  const flushing = useRef<Promise<void> | null>(null);
  const flushOutbox = useCallback(async (): Promise<void> => {
    if (flushing.current) {
      await flushing.current;
    }
    const store = storeRef.current;
    // Una sola pestaña reenvía: la que no tiene el turno no manda nada (la otra ya lo está haciendo).
    const run = store ? withFlushLock(store, flushOnce).then(() => undefined) : Promise.resolve();
    flushing.current = run;
    try {
      await run;
    } finally {
      if (flushing.current === run) flushing.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, t]);
  flushRef.current = flushOutbox;

  async function flushOnce(): Promise<void> {
    const store = storeRef.current;
    if (!store) return;
    const ops = await store.outbox().catch(() => []);
    if (!ops.length) return;
    setSyncing(true);
    try {
      const r = await replayOutbox(ops, {
        fetch: (url, init) => fetch(url, init),
        complete: (op, serverUpdatedAt) => store.completeOp(op, serverUpdatedAt),
        stuck: (op, status) => store.stickOp(op, status),
        copyTitle: (title) => t('offline.copyTitle', { title: title || t('untitled') }),
      });
      if (r.stuck) setStuck(await store.stuckOps().catch(() => []));
      if (r.remaining) {
        // Sin red, o el servidor falló: se reintenta con espera creciente.
        if (r.retry) {
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => void flushRef.current(), retryDelay(retryAttempt.current++));
        } else setOffline(true);
        return;
      }
      retryAttempt.current = 0;
      for (const op of ops) bases.current.delete(op.id);
      if (r.copies) setToast(t('offline.copies', { count: r.copies }));
      else if (r.stuck) setToast(t('offline.stuck', { count: r.stuck }));
      else if (r.done) setOkToast(t('offline.synced', { count: r.done }));
      // Snippets y orden de la lista: los del servidor después del reenvío.
      void refreshListRef.current();
      // La nota abierta: la versión del servidor (con su base nueva), o avisar si ya no existe.
      const open = note?.id;
      if (open && ops.some((o) => o.id === open)) {
        const res = await fetch(`/api/notes/${open}`).catch(() => null);
        if (res?.status === 404) {
          setNote((cur) => (cur && cur.id === open ? null : cur));
          setPane('list');
          setToast(t('offline.deletedElsewhere'));
        } else if (res?.ok) {
          const fresh = (await res.json()) as NoteDetail;
          bases.current.set(fresh.id, fresh.updated_at);
          if (r.copies) {
            // Chocó: lo propio quedó en una copia y se muestra la versión del servidor.
            setNote((cur) => (cur && cur.id === fresh.id ? fresh : cur));
            setEditorKey((k) => k + 1);
          } else {
            // Sin volver a montar el editor: lo que se ve ya es lo que se subió.
            setNote((cur) => (cur && cur.id === fresh.id ? { ...fresh, content: cur.content, title: cur.title } : cur));
          }
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  // Red: al perderla, la lista sale del dispositivo; al volver, se suben los cambios y se baja lo nuevo.
  useEffect(() => {
    void registerAppServiceWorker();
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    if (!navigator.onLine) setOffline(true);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  const wasOffline = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = wasOffline.current;
    wasOffline.current = offline;
    if (offline) {
      void (async () => {
        await confirmIdentity();
        if (prev === false || storeRef.current) void refreshList();
      })();
      return;
    }
    // Primera carga con red, o volvió la red: primero quién es la sesión.
    void (async () => {
      if (!(await confirmIdentity())) return;
      await flushOutbox();
      await uploadPendingFiles();
      if (prev === true) {
        void refreshList();
        void refreshSide();
      }
      await syncDevice();
    })();
    // Solo cuando cambia el estado de la red.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  // Sin red al cargar: libretas y etiquetas de la última copia.
  useEffect(() => {
    if (!offline) return;
    void (async () => {
      const store = storeRef.current;
      if (!store) return;
      const nb = await store.getMeta<NotebookInfo[]>('notebooks').catch(() => null);
      const tg = await store.getMeta<TagInfo[]>('tags').catch(() => null);
      if (nb?.length && !notebooks.length) setNotebooks(nb);
      if (tg?.length && !tags.length) setTags(tg);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  // Recarga la lista al cambiar filtro/orden (inmediato) o búsqueda (debounce).
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const h = setTimeout(refreshList, q ? 180 : 0);
    return () => clearTimeout(h);
  }, [refreshList, q]);

  // Borrar la búsqueda borra también el resaltado de la nota abierta.
  useEffect(() => {
    if (!q.trim()) setHighlight([]);
  }, [q]);

  // URL compartible (?note=<id>) sin navegar.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (note) url.searchParams.set('note', note.id);
    // El pedido de acceso sobrevive a recargar.
    else if (!denied) url.searchParams.delete('note');
    if (filter.kind === 'home' || filter.kind === 'tasks') url.searchParams.set('view', filter.kind);
    else if (filter.kind !== 'shared') url.searchParams.delete('view');
    for (const k of ['new', 'search', 'template', 'q', 'requests']) url.searchParams.delete(k);
    window.history.replaceState(null, '', url.toString());
  }, [note, denied, filter.kind]);

  // La selección sale de la lista visible (filtrar o borrar la achica).
  useEffect(() => {
    setSelected((cur) => cur.filter((id) => notes.some((n) => n.id === id)));
  }, [notes]);

  const openNote = useCallback(
    async (id: string) => {
      // Grabando: la grabación no se pierde (se agrega a su nota), pero se avisa antes de cambiar.
      if (isRecordingActive() && !confirm(t('capture.confirmLeave'))) return;
      setHighlight(q.trim() ? highlightTerms(q) : []);
      try {
        if (offlineRef.current) throw new TypeError('offline');
        const res = await fetch(`/api/notes/${id}`);
        if (!res.ok) throw new Error(String(res.status));
        const opened = (await res.json()) as NoteDetail;
        bases.current.set(opened.id, opened.updated_at);
        setNote(opened);
        setConflict((c) => (c && c.id !== opened.id ? null : c));
        setPane('editor');
        setStatus('idle');
        void storeRef.current?.putDetails([opened]).catch(() => undefined);
      } catch (err) {
        if (isNetworkError(err) && storeRef.current) {
          setOffline(true);
          const cached = await storeRef.current.get(id).catch(() => null);
          if (cached?.full) {
            setNote({ ...(cached as NoteDetail), content: cached.content ?? [], share_token: cached.share_token ?? null });
            setPane('editor');
            setStatus('idle');
            return;
          }
          setToast(t('offline.notCached'));
          return;
        }
        setToast(t('editor.openError'));
      }
    },
    [t, q],
  );

  /** Abrir desde un link [[ ]] o "Enlazada desde". */
  const openLinkedNote = useCallback((id: string) => void openNote(id), [openNote]);

  /** Nota creada desde el popover [[ : entra a la lista y al conteo de su libreta. */
  const addLinkedNote = useCallback(
    (created: NoteDetail) => {
      bases.current.set(created.id, created.updated_at);
      const visible =
        filter.kind === 'all' || (filter.kind === 'notebook' && filter.id === created.notebook_id);
      if (visible) setNotes((prev) => [created, ...prev.filter((n) => n.id !== created.id)]);
      if (created.notebook_id) {
        setNotebooks((prev) =>
          prev.map((nb) => (nb.id === created.notebook_id ? { ...nb, count: nb.count + 1 } : nb)),
        );
      }
    },
    [filter],
  );

  /** La nota cambió entera (bloquear o sacar el bloqueo): se reemplaza y el editor se monta de nuevo. */
  const replaceNote = useCallback(
    (fresh: NoteDetail) => {
      bases.current.set(fresh.id, fresh.updated_at);
      setNote((cur) => (cur && cur.id === fresh.id ? fresh : cur));
      setEditorKey((k) => k + 1);
      setStatus('idle');
      if (fresh.locked) {
        // Recién bloqueada: fuera el texto en claro del dispositivo (copia, cola y páginas guardadas).
        void storeRef.current?.scrubNote(fresh).catch(() => undefined);
        // La página de Notes guardada para abrir sin red se borra y se vuelve a guardar ya sin el texto.
        const sw = navigator.serviceWorker?.controller;
        if (sw) sw.postMessage({ type: 'zs-drop-notes', refetch: [`${window.location.pathname}`] });
        else if ('serviceWorker' in navigator) setOkToast(t('offline.lockedNotCached'));
      } else {
        void storeRef.current?.putDetails([fresh]).catch(() => undefined);
      }
      void refreshList();
    },
    [refreshList, t],
  );

  /**
   * Grabación para una nota (al cambiar de nota mientras se grababa, o sin
   * red): se sube y se agrega al final de la nota en el servidor. Sin red
   * queda en el dispositivo y se sube al volver.
   */
  const addRecording = useCallback(
    async (noteId: string, file: File): Promise<'added' | 'saved' | 'failed'> => {
      const attach = async (): Promise<boolean> => {
        const form = new FormData();
        form.append('file', file);
        const up = await fetch(`/api/notes/${encodeURIComponent(noteId)}/files`, { method: 'POST', body: form });
        if (!up.ok) return false;
        const block = fileBlockFromUpload((await up.json()) as DocsUploadResult, 'audio');
        await saveChains.current.get(noteId)?.catch(() => {});
        for (let attempt = 0; attempt < 3; attempt++) {
          const cur = await fetch(`/api/notes/${encodeURIComponent(noteId)}`);
          if (!cur.ok) return false;
          const n = (await cur.json()) as NoteDetail;
          if (n.locked) return false;
          const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: [...n.content, block], base_updated_at: n.updated_at }),
          });
          if (res.ok) {
            const updated = (await res.json()) as NoteDetail;
            bases.current.set(noteId, updated.updated_at);
            return true;
          }
          if (res.status !== 409) return false;
        }
        return false;
      };
      try {
        if (offlineRef.current) throw new TypeError('offline');
        return (await attach()) ? 'added' : 'failed';
      } catch (err) {
        if (!isNetworkError(err) || !storeRef.current) return 'failed';
        await storeRef.current.addFile({ fileId: crypto.randomUUID(), noteId, name: file.name, type: file.type, blob: file, at: Date.now() });
        return 'saved';
      }
    },
    [],
  );

  /** Sube las grabaciones que quedaron en el dispositivo. */
  async function uploadPendingFiles(): Promise<void> {
    const store = storeRef.current;
    if (!store) return;
    const files = await store.files().catch(() => []);
    for (const f of files) {
      const res = await addRecording(f.noteId, new File([f.blob], f.name, { type: f.type })).catch(() => 'failed' as const);
      if (res === 'added') {
        await store.removeFile(f.fileId).catch(() => undefined);
        if (note?.id === f.noteId) void reloadNoteRef.current(f.noteId);
      }
      if (res === 'saved') break;
    }
  }

  const reloadNoteRef = useRef<(id: string) => Promise<void>>(async () => undefined);
  /** Recarga la nota abierta (después de restaurar una versión): el editor se monta de nuevo. */
  const reloadNote = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/notes/${id}`);
        if (!res.ok) throw new Error(String(res.status));
        replaceNote((await res.json()) as NoteDetail);
      } catch {
        setToast(t('editor.openError'));
      }
    },
    [replaceNote, t],
  );
  reloadNoteRef.current = reloadNote;

  /**
   * Espera el autoguardado (debounce del editor + PATCH en vuelo) y trae la
   * nota del servidor: lo que usa "Enviar a Track" para mandar lo último.
   */
  const syncNote = useCallback(async (id: string): Promise<NoteDetail | null> => {
    await new Promise((r) => setTimeout(r, 700));
    await pendingCreates.current.get(id);
    await saveChains.current.get(id)?.catch(() => {});
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as NoteDetail;
      bases.current.set(fresh.id, fresh.updated_at);
      return fresh;
    } catch {
      return null;
    }
  }, []);

  /** Importar .enex / .md: crea las notas (en la libreta abierta, si hay) y recarga la lista. */
  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setImporting(true);
      try {
        // Un archivo por request: en Vercel el cuerpo de una función tiene tope (~4.5 MB).
        let imported = 0;
        let failed = 0;
        for (const f of files) {
          const body = new FormData();
          body.append('file', f);
          if (filter.kind === 'notebook') body.append('notebook_id', filter.id);
          const res = await fetch('/api/notes/import', { method: 'POST', body });
          const data = (await res.json().catch(() => null)) as
            | { imported?: number; errors?: Array<{ file: string; code: string }>; error?: string }
            | null;
          if (!res.ok || !data) {
            failed += 1;
            continue;
          }
          imported += data.imported ?? 0;
          failed += data.errors?.length ?? 0;
        }
        if (failed && !imported) setToast(t('import.noneImported', { failed }));
        else setOkToast(failed ? t('import.partial', { count: imported, failed }) : t('import.done', { count: imported }));
        if (filter.kind === 'trash') setFilter({ kind: 'all' });
        void refreshList();
        void refreshSide();
      } catch {
        setToast(t('import.failed'));
      } finally {
        setImporting(false);
      }
    },
    [filter, refreshList, refreshSide, t],
  );

  /**
   * Creación instantánea (optimista): la nota se abre y enfoca al toque con un
   * id generado en el cliente; el POST va en paralelo y los guardados de esa
   * nota esperan a que termine (pendingCreates). Sin red queda en el
   * dispositivo y se sube al volver. Con plantilla, trae su título y bloques.
   */
  const createNote = useCallback(
    async (init?: { title: string; content: DocsBlock[] }) => {
      if (isRecordingActive() && !confirm(t('capture.confirmLeave'))) return;
      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const content = init?.content.length ? init.content : [{ id: crypto.randomUUID(), type: 'paragraph' as const, content: '' }];
      const created: NoteDetail = {
        id,
        notebook_id: filter.kind === 'notebook' ? filter.id : null,
        title: init?.title ?? '',
        snippet: init ? makeSnippet(blocksToText(content)) : '',
        tags: filter.kind === 'tag' ? [filter.tag] : [],
        pinned: filter.kind === 'pinned',
        trashed: false,
        source_url: null,
        shared: false,
        share_token: null,
        created_at: nowIso,
        updated_at: nowIso,
        content,
      };
      const body = {
        id,
        title: created.title,
        content: created.content,
        notebook_id: created.notebook_id,
        tags: created.tags,
        pinned: created.pinned,
      };
      const queueLocally = async () => {
        const store = storeRef.current;
        if (!store) return false;
        try {
          await store.enqueue(makeOp({ kind: 'create', id, body }));
          await store.putNote({ ...created, full: true });
          setOffline(true);
          return true;
        } catch {
          return false;
        }
      };
      const request = (
        offlineRef.current
          ? queueLocally()
          : fetch('/api/notes', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }).then(async (res) => {
              if (!res.ok) return false;
              const saved = (await res.json().catch(() => null)) as NoteDetail | null;
              if (saved?.updated_at) bases.current.set(id, saved.updated_at);
              if (saved) void storeRef.current?.putDetails([saved]).catch(() => undefined);
              return true;
            })
      )
        .catch((err) => (isNetworkError(err) ? queueLocally() : false))
        .finally(() => {
          pendingCreates.current.delete(id);
        });
      pendingCreates.current.set(id, request);
      if (filter.kind === 'trash' || filter.kind === 'shared') setFilter({ kind: 'all' });
      setQ('');
      setActiveSearch(null);
      setHighlight([]);
      setNotes((prev) => [created, ...prev.filter((n) => n.id !== created.id)]);
      setNote(created);
      setPane('editor');
      setFocusTitle((n) => n + 1);
      if (filter.kind === 'notebook') {
        setNotebooks((prev) => prev.map((nb) => (nb.id === filter.id ? { ...nb, count: nb.count + 1 } : nb)));
      }
    },
    [filter, t],
  );

  // Atajos: N = nueva nota, / = buscar (fuera de campos de texto); Esc sale del modo foco o de la selección.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {
        if (focusMode && !isTypingTarget(e.target)) {
          setFocusMode(false);
          return;
        }
        if (selectMode && !isTypingTarget(e.target)) {
          setSelectMode(false);
          setSelected([]);
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void createNote();
      } else if (e.key === '/') {
        e.preventDefault();
        setFocusMode(false);
        setPane('list');
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createNote, focusMode, selectMode]);

  // /app/notes?new=1 (sidebar "Nueva nota", ⌘K) crea al entrar; ?template=<id> crea desde una plantilla.
  const startedNew = useRef(false);
  useEffect(() => {
    if (!startNew && !initialTemplate) {
      startedNew.current = false;
    } else if (!startedNew.current) {
      startedNew.current = true;
      void createNote(
        initialTemplate ? { title: initialTemplate.title, content: initialTemplate.content.map((b) => ({ ...b, id: crypto.randomUUID() })) } : undefined,
      );
    }
  }, [startNew, initialTemplate, createNote]);

  /** Autosave del editor (DocsEditor ya hace debounce de 600 ms). */
  const saveContent = useCallback(
    async (id: string, patch: { title: string; content: DocsBlock[]; lock?: NoteLockEnvelope; lock_proof?: string }) => {
      setStatus('saving');
      const creating = pendingCreates.current.get(id);
      if (creating && !(await creating)) {
        setStatus('error');
        return;
      }
      const snippet = patch.lock ? '' : makeSnippet(blocksToText(patch.content).replace(/<[^>]*>/g, ''));
      const nowIso = new Date().toISOString();
      setNotes((prev) => {
        const idx = prev.findIndex((n) => n.id === id);
        if (idx < 0) return prev;
        const updated = { ...prev[idx], title: patch.title, snippet, updated_at: nowIso };
        const rest = prev.filter((n) => n.id !== id);
        return sort === 'updated' ? [updated, ...rest] : prev.map((n) => (n.id === id ? updated : n));
      });
      const run = async (force: boolean): Promise<void> => {
        try {
          const res = await sendPatch(id, patch, force);
          if (res.conflict) {
            setStatus('idle');
            setConflict({ id, trashed: res.conflict === 'trashed', retry: () => enqueue(id, () => run(true)) });
            return;
          }
          setConflict((c) => (c?.id === id ? null : c));
          setStatus(res.local ? 'local' : 'saved');
        } catch {
          setStatus('error');
        }
      };
      await enqueue(id, () => run(false));
    },
    [sort, sendPatch, enqueue],
  );

  /** Cambios de metadatos (tags, libreta, fijada, papelera). null = falló (con aviso). */
  const patchNote = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      await pendingCreates.current.get(id);
      try {
        // Solo los cambios que tocan la nota llevan la base (mandar a la papelera o restaurar no).
        const guarded = !('trashed' in patch);
        const res = await enqueue(id, () => sendPatch(id, patch, !guarded));
        if (res.conflict) {
          setConflict({ id, trashed: res.conflict === 'trashed', retry: null });
          return null;
        }
        const updated = res.updated;
        setNote((cur) => (cur && cur.id === id ? { ...updated, content: cur.content, title: cur.title, lock: cur.lock } : cur));
        void refreshList();
        void refreshSide();
        return updated;
      } catch {
        setToast(t('editor.actionError'));
        return null;
      }
    },
    [refreshList, refreshSide, t, enqueue, sendPatch],
  );

  /** Conflicto: "Cargar la última versión" descarta lo propio sin guardar. */
  const reloadAfterConflict = useCallback(async () => {
    const c = conflict;
    if (!c) return;
    try {
      const res = await fetch(`/api/notes/${c.id}`);
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as NoteDetail;
      bases.current.set(fresh.id, fresh.updated_at);
      setConflict(null);
      setNote((cur) => (cur && cur.id === fresh.id ? fresh : cur));
      setEditorKey((k) => k + 1);
      setStatus('idle');
      void refreshList();
    } catch {
      setToast(t('editor.openError'));
    }
  }, [conflict, refreshList, t]);

  /** Conflicto: "Conservar la mía" guarda lo de esta pestaña encima, a sabiendas. */
  const overwriteAfterConflict = useCallback(async () => {
    const retry = conflict?.retry;
    if (!retry) return;
    setStatus('saving');
    await retry();
  }, [conflict]);

  const trash = useCallback(
    async (id: string) => {
      if (!(await patchNote(id, { trashed: true }))) return;
      setNote(null);
      setPane('list');
    },
    [patchNote],
  );

  const restore = useCallback(
    async (id: string) => {
      const updated = await patchNote(id, { trashed: false });
      if (updated) setNote(updated);
    },
    [patchNote],
  );

  const deleteForever = useCallback(
    async (id: string) => {
      if (!confirm(t('trash.confirmDelete'))) return;
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      setNote(null);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setPane('list');
    },
    [t],
  );

  const emptyTrash = useCallback(async () => {
    if (!confirm(t('trash.confirmEmpty'))) return;
    const res = await fetch('/api/notes/trash', { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setToast(t('editor.actionError'));
      return;
    }
    setNotes([]);
    setNote(null);
  }, [t]);

  const addNotebook = useCallback(
    async (name: string) => {
      setNewNotebook(false);
      if (!name.trim()) return;
      const res = await fetch('/api/notes/notebooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      const nb = (await res.json()) as NotebookInfo;
      setNotebooks((prev) => [...prev, nb].sort((a, b) => a.name.localeCompare(b.name)));
      setFilter({ kind: 'notebook', id: nb.id });
      setPane('list');
    },
    [t],
  );

  const patchNotebook = useCallback(
    async (nb: NotebookInfo, body: { name?: string; stack?: string | null }) => {
      setNotebooks((prev) => prev.map((x) => (x.id === nb.id ? { ...x, ...body } : x)));
      const res = await fetch(`/api/notes/notebooks/${nb.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res?.ok) setToast(t('editor.actionError'));
      void refreshSide();
      return Boolean(res?.ok);
    },
    [refreshSide, t],
  );

  const renameNotebook = useCallback(
    async (nb: NotebookInfo, raw: string) => {
      setRenamingNotebook(null);
      const name = raw.trim();
      if (!name || name === nb.name) return;
      await patchNotebook(nb, { name });
    },
    [patchNotebook],
  );

  const deleteNotebook = useCallback(
    async (nb: NotebookInfo) => {
      if (!confirm(t('notebooks.confirmDelete', { name: nb.name }))) return;
      const res = await fetch(`/api/notes/notebooks/${nb.id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      setFilter({ kind: 'all' });
      if (note?.notebook_id === nb.id) setNote(null);
      void refreshSide();
    },
    [note, refreshSide, t],
  );

  const renameStack = useCallback(
    async (from: string, to: string | null) => {
      setNotebooks((prev) => prev.map((x) => (x.stack === from ? { ...x, stack: to } : x)));
      if (filter.kind === 'stack' && filter.stack === from) setFilter(to ? { kind: 'stack', stack: to } : { kind: 'all' });
      const res = await fetch('/api/notes/stacks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      }).catch(() => null);
      if (!res?.ok) setToast(t('editor.actionError'));
      void refreshSide();
      return Boolean(res?.ok);
    },
    [filter, refreshSide, t],
  );

  // ---------- Etiquetas ----------

  const renameTag = useCallback(
    async (from: string, to: string) => {
      const res = await fetch('/api/notes/tags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return false;
      }
      const data = (await res.json()) as { tag: string };
      if (filter.kind === 'tag' && (filter.tag === from || filter.tag.startsWith(`${from}/`))) setFilter({ kind: 'tag', tag: data.tag });
      if (note) void reloadNote(note.id);
      void refreshList();
      void refreshSide();
      return true;
    },
    [filter, note, refreshList, refreshSide, reloadNote, t],
  );

  const deleteTag = useCallback(
    async (tag: string) => {
      const res = await fetch(`/api/notes/tags?tag=${encodeURIComponent(tag)}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      if (filter.kind === 'tag' && (filter.tag === tag || filter.tag.startsWith(`${tag}/`))) setFilter({ kind: 'all' });
      if (note) void reloadNote(note.id);
      void refreshList();
      void refreshSide();
    },
    [filter, note, refreshList, refreshSide, reloadNote, t],
  );

  // ---------- Búsquedas guardadas ----------

  const saveSearch = useCallback(
    async (name: string) => {
      const res = await fetch('/api/notes/searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, query: q.trim() }),
      }).catch(() => null);
      if (!res?.ok) {
        setToast(res?.status === 409 ? t('searches.limit') : t('editor.actionError'));
        return false;
      }
      const created = (await res.json()) as SavedSearchInfo;
      setSearches((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveSearch(created.id);
      setOkToast(t('searches.saved'));
      return true;
    },
    [q, t],
  );

  const patchSearch = useCallback(
    async (s: SavedSearchInfo, body: { name?: string; query?: string }) => {
      const res = await fetch(`/api/notes/searches/${s.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return false;
      }
      const updated = (await res.json()) as SavedSearchInfo;
      setSearches((prev) => prev.map((x) => (x.id === s.id ? updated : x)).sort((a, b) => a.name.localeCompare(b.name)));
      return true;
    },
    [t],
  );

  const deleteSearch = useCallback(
    async (s: SavedSearchInfo) => {
      const prev = searches;
      setSearches((cur) => cur.filter((x) => x.id !== s.id));
      if (activeSearch === s.id) setActiveSearch(null);
      const res = await fetch(`/api/notes/searches/${s.id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        setSearches(prev);
        setToast(t('editor.actionError'));
      }
    },
    [activeSearch, searches, t],
  );

  function pickSearch(s: SavedSearchInfo) {
    dropStaleNote.current = true;
    setFilter({ kind: 'all' });
    setQ(s.query);
    setActiveSearch(s.id);
    setPane('list');
  }

  // ---------- Selección múltiple ----------

  const runBulk = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const ids = selected;
      if (!ids.length) return;
      setBulkBusy(true);
      try {
        const res = await fetch('/api/notes/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, action, ...extra }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { changed: string[] };
        setOkToast(t('select.updated', { count: data.changed.length }));
        if (note && data.changed.includes(note.id)) {
          if (action === 'trash' || action === 'delete') setNote(null);
          else void reloadNote(note.id);
        }
        if (action === 'trash' || action === 'delete' || action === 'restore') setSelected([]);
        void refreshList();
        void refreshSide();
      } catch {
        setToast(t('select.error'));
      } finally {
        setBulkBusy(false);
      }
    },
    [selected, note, reloadNote, refreshList, refreshSide, t],
  );

  function exportSelected() {
    window.location.href = `/api/notes/export?ids=${encodeURIComponent(selected.join(','))}&locale=${locale}`;
  }

  function onItemClick(e: React.MouseEvent, id: string) {
    const ids = notes.map((n) => n.id);
    if (selectMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      if (!selectMode) {
        setSelectMode(true);
        // ⌘clic con una nota abierta: la abierta entra en la selección también.
        const start = note && ids.includes(note.id) && note.id !== id && !e.shiftKey ? [note.id] : [];
        setSelected(nextSelection(start, ids, id, e.shiftKey ? 'range' : 'toggle', anchor ?? note?.id ?? null));
      } else {
        setSelected((cur) => nextSelection(cur, ids, id, e.shiftKey ? 'range' : 'toggle', anchor));
      }
      if (!e.shiftKey) setAnchor(id);
      return;
    }
    void openNote(id);
  }

  function choose(f: NotesFilter) {
    if (!sameFilter(f, filter)) dropStaleNote.current = true;
    setFilter(f);
    setActiveSearch(null);
    setPane('list');
  }

  const isActive = (f: NotesFilter) => sameFilter(f, filter) && !activeSearch;

  const listTitle = useMemo(() => {
    if (activeSearch) return searches.find((s) => s.id === activeSearch)?.name ?? t('nav.savedSearches');
    if (filter.kind === 'home') return t('nav.home');
    if (filter.kind === 'tasks') return t('nav.tasks');
    if (filter.kind === 'pinned') return t('nav.pinned');
    if (filter.kind === 'trash') return t('nav.trash');
    if (filter.kind === 'shared') return t('nav.shared');
    if (filter.kind === 'notebook') return notebooks.find((n) => n.id === filter.id)?.name ?? t('nav.notebooks');
    if (filter.kind === 'stack') return filter.stack;
    if (filter.kind === 'tag') return `#${filter.tag}`;
    return t('nav.all');
  }, [filter, notebooks, t, activeSearch, searches]);

  const relTime = (iso: string) => {
    const d = parseDbUtc(iso);
    const diff = now - d.getTime();
    if (diff < 60_000) return t('list.justNow');
    if (diff < 7 * 86_400_000) return format.relativeTime(d, new Date(now));
    return format.dateTime(d, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
  };

  /** Flechas en la lista: mueven el foco y abren la nota, como en Apple Notes. Espacio marca en modo selección. */
  function onListKey(e: React.KeyboardEvent) {
    const items = Array.from(itemsRef.current?.querySelectorAll<HTMLButtonElement>('.notes-item') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (selectMode && e.key === ' ' && current >= 0) {
      e.preventDefault();
      const id = items[current].dataset.id;
      if (id) setSelected((cur) => nextSelection(cur, notes.map((n) => n.id), id, 'toggle', null));
      return;
    }
    const next = stepIndex(current, e.key, items.length);
    if (next == null) return;
    e.preventDefault();
    items[next].focus();
    const id = items[next].dataset.id;
    if (id && id !== note?.id && !selectMode) void openNote(id);
  }

  const showSkeleton = loading && loadedKey !== listKey(filter, sort);
  const empty = emptyKind(filter, q);
  const inTrash = filter.kind === 'trash';
  const navItem = (f: NotesFilter, label: string, icon?: 'pin' | 'trash' | 'users' | 'home' | 'clock') => (
    <button
      type="button"
      className="notes-nav-item"
      aria-current={isActive(f) ? 'true' : undefined}
      onClick={() => choose(f)}
    >
      {icon && <NotesIcon name={icon} size={14} />}
      <span className="notes-nav-name">{label}</span>
    </button>
  );
  const stacks = useMemo(() => [...new Set(notebooks.map((n) => n.stack).filter((s): s is string => Boolean(s)))].sort(), [notebooks]);
  const activeSearchQuery = activeSearch ? searches.find((s) => s.id === activeSearch)?.query : null;

  return (
    <div className="notes-app" data-home={filter.kind === 'home' ? 'true' : undefined} data-pane={pane} data-focus={focusMode ? 'true' : undefined} data-offline={offline ? 'true' : undefined}>
      {/* ---------- Libretas / filtros ---------- */}
      <aside className="notes-nav" aria-label={t('nav.label')}>
        <div className="notes-nav-top">
          <button type="button" className="btn btn-primary btn-block notes-new" onClick={() => void createNote()}>
            <NotesIcon name="plus" size={14} />
            {t('actions.newNote')}
            <kbd className="kbd">N</kbd>
          </button>
          <button type="button" className="btn btn-block notes-new-template" onClick={() => setTemplatesOpen(true)} disabled={offline}>
            <NotesIcon name="template" size={14} />
            {t('actions.newFromTemplate')}
          </button>
        </div>
        <nav className="notes-nav-list" aria-label={t('nav.label')}>
          {navItem({ kind: 'home' }, t('nav.home'), 'home')}
          {navItem({ kind: 'tasks' }, t('nav.tasks'), 'clock')}
          {navItem({ kind: 'all' }, t('nav.all'))}
          {navItem({ kind: 'pinned' }, t('nav.pinned'), 'pin')}
          {navItem({ kind: 'shared' }, t('nav.shared'), 'users')}

          <SavedSearchesNav
            searches={searches}
            activeId={activeSearch}
            onPick={pickSearch}
            onRename={(s) => setPrompt({ kind: 'renameSearch', search: s })}
            onUpdate={(s) => void patchSearch(s, { query: q.trim() })}
            onDelete={(s) => setConfirmState({ kind: 'deleteSearch', search: s })}
            canUpdate={Boolean(q.trim())}
          />

          <div className="notes-nav-section">
            <h2>{t('nav.notebooks')}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setNewNotebook(true)}
              aria-label={t('notebooks.new')}
              title={t('notebooks.new')}
            >
              <NotesIcon name="plus" size={14} />
            </button>
          </div>
          {newNotebook && (
            <input
              className="input notes-nav-input"
              autoFocus
              placeholder={t('notebooks.namePlaceholder')}
              aria-label={t('notebooks.namePlaceholder')}
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNotebook(e.currentTarget.value);
                if (e.key === 'Escape') setNewNotebook(false);
              }}
              onBlur={(e) => void addNotebook(e.currentTarget.value)}
            />
          )}
          <NotebooksNav
            notebooks={notebooks}
            isActive={isActive}
            onChoose={choose}
            renaming={renamingNotebook}
            onStartRename={(nb) => setRenamingNotebook(nb.id)}
            onRename={(nb, name) => void renameNotebook(nb, name)}
            onCancelRename={() => setRenamingNotebook(null)}
            onShare={setSharingNotebook}
            onDelete={(nb) => void deleteNotebook(nb)}
            onMoveToStack={(nb) => setPrompt({ kind: 'stack', notebook: nb })}
            onRemoveFromStack={(nb) => void patchNotebook(nb, { stack: null })}
            onExport={(nb) => (window.location.href = `/api/notes/export?notebook=${encodeURIComponent(nb.id)}&locale=${locale}`)}
            onRenameStack={(stack) => setPrompt({ kind: 'renameStack', stack })}
            onUngroupStack={(stack) => void renameStack(stack, null)}
          />
          {notebooks.length === 0 && !newNotebook && <p className="notes-nav-hint">{t('notebooks.empty')}</p>}

          <TagsNav
            tags={tags}
            isActive={isActive}
            onChoose={choose}
            onRename={(tag) => setPrompt({ kind: 'renameTag', tag })}
            onDelete={(tag) => setConfirmState({ kind: 'deleteTag', tag })}
          />

          <div className="notes-nav-spacer" />
          <button
            type="button"
            className="notes-nav-item"
            onClick={() => importRef.current?.click()}
            aria-busy={importing}
            disabled={importing || offline}
            title={t('import.hint')}
          >
            <NotesIcon name="import" size={14} />
            <span className="notes-nav-name">{importing ? t('import.importing') : t('import.button')}</span>
          </button>
          <button
            type="button"
            className="notes-nav-item"
            disabled={offline}
            onClick={() => (window.location.href = `/api/notes/export?locale=${locale}`)}
          >
            <NotesIcon name="export" size={14} />
            <span className="notes-nav-name">{t('nav.exportAll')}</span>
          </button>
          <input
            ref={importRef}
            type="file"
            hidden
            multiple
            accept=".enex,.md,.markdown,.txt,text/markdown,text/plain"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void importFiles(files);
            }}
          />
          {navItem({ kind: 'trash' }, t('nav.trash'), 'trash')}
        </nav>
        {aiEnabled && !offline && (
          <div className="notes-nav-foot">
            <button type="button" className="notes-nav-item" onClick={() => setAskOpen(true)}>
              <NotesIcon name="ask" size={14} />
              <span className="notes-nav-name">{t('ask.open')}</span>
            </button>
          </div>
        )}
      </aside>

      {/* ---------- Lista ---------- */}
      {filter.kind === 'home' ? (
        <div className="notes-home-pane">
          <button type="button" className="btn btn-ghost btn-sm notes-pane-back" onClick={() => setPane('nav')}>
            <NotesIcon name="back" size={14} />
            {t('nav.label')}
          </button>
          <NotesHome
            notebooks={notebooks}
            tags={tags}
            searches={searches}
            onOpenNote={(id) => {
              setFilter({ kind: 'all' });
              void openNote(id);
            }}
            onChoose={choose}
            onPickSearch={(s) => {
              setFilter({ kind: 'all' });
              setQ(s.query);
              setActiveSearch(s.id);
            }}
            onNewNote={async (title, text) => {
              const res = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  title,
                  content: text
                    .split(/\n{2,}/)
                    .slice(0, 500)
                    .map((part) => ({ id: crypto.randomUUID(), type: 'paragraph', content: part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') })),
                }),
              }).catch(() => null);
              if (!res?.ok) {
                setToast(t('editor.actionError'));
                return false;
              }
              const created = (await res.json()) as { id: string };
              setFilter({ kind: 'all' });
              void openNote(created.id);
              return true;
            }}
          />
        </div>
      ) : (
        <>
      {filter.kind === 'tasks' ? (
        <div className="notes-list" role="region" aria-label={t('nav.tasks')}>
          <div className="notes-list-head">
            <button type="button" className="btn btn-ghost btn-sm notes-pane-back" onClick={() => setPane('nav')}>
              <NotesIcon name="back" size={14} />
              {t('nav.label')}
            </button>
            <div className="notes-list-title">
              <h1>{t('nav.tasks')}</h1>
            </div>
          </div>
          <div className="notes-list-items">
            <NotesTasksList
              activeNoteId={note?.id ?? null}
              onOpen={(id) => void openNote(id)}
              onChanged={(id) => {
                if (note?.id === id) {
                  void reloadNote(id);
                }
              }}
            />
          </div>
        </div>
      ) : (
      <div className="notes-list" role="region" aria-label={listTitle}>
        <div className="notes-list-head">
          <button type="button" className="notes-back" onClick={() => setPane('nav')}>
            <NotesIcon name="back" size={14} />
            {t('nav.label')}
          </button>
          {offline && (
            <p className="notes-offline-banner" role="status">
              <NotesIcon name="cloudOff" size={14} />
              {t('offline.banner')}
            </p>
          )}
          {stuck.length > 0 && (
            <div className="notes-offline-banner notes-stuck" role="alert">
              <span>{t('offline.stuckBanner', { count: stuck.length })}</span>
              <span className="notes-stuck-actions">
                <button type="button" className="btn btn-sm" onClick={() => void recoverStuck()}>
                  {t('offline.saveAsNew')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const text = stuck.map((x) => `# ${x.title}\n\n${x.text}`).join('\n\n---\n\n');
                    void navigator.clipboard?.writeText(text).then(
                      () => setOkToast(t('offline.copied')),
                      () => setToast(t('editor.actionError')),
                    );
                  }}
                >
                  {t('offline.copyText')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => {
                    if (!confirm(t('offline.confirmDiscard'))) return;
                    void storeRef.current?.dropStuck(null).then(() => setStuck([]));
                  }}
                >
                  {t('offline.discard')}
                </button>
              </span>
            </div>
          )}
          {syncing && !offline && (
            <p className="notes-offline-banner" role="status">
              {t('offline.syncing')}
            </p>
          )}
          <div className="notes-list-title">
            <h1>{listTitle}</h1>
            <button
              type="button"
              className={`btn btn-ghost btn-sm notes-select-toggle${selectMode ? ' is-on' : ''}`}
              aria-pressed={selectMode}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected([]);
              }}
              disabled={offline || filter.kind === 'shared'}
            >
              {selectMode ? t('select.done') : t('select.start')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-icon notes-list-new"
              onClick={() => void createNote()}
              aria-label={t('actions.newNote')}
              title={t('actions.newNote')}
            >
              <NotesIcon name="plus" size={14} />
            </button>
          </div>
          <div className="notes-list-tools">
            <label className="notes-search">
              <NotesIcon name="search" size={14} />
              <input
                ref={searchRef}
                className="input"
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  if (activeSearch && e.target.value !== activeSearchQuery) setActiveSearch(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && q) {
                    e.preventDefault();
                    setQ('');
                    setActiveSearch(null);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    itemsRef.current?.querySelector<HTMLButtonElement>('.notes-item')?.focus();
                  }
                }}
                placeholder={t('list.search')}
                aria-label={t('list.search')}
                aria-keyshortcuts="/"
              />
              {!q && (
                <kbd className="kbd" title={t('list.searchHint')} aria-hidden="true">
                  /
                </kbd>
              )}
            </label>
            {semanticAvailable && !offline && (
              <button
                type="button"
                className={`btn btn-ghost btn-sm btn-icon${semantic ? ' is-on' : ''}`}
                aria-pressed={semantic}
                onClick={() => setSemantic((v) => !v)}
                aria-label={t('list.semantic')}
                title={t('list.semanticHint')}
              >
                <NotesIcon name="sparkle" size={14} />
              </button>
            )}
            {q.trim() && !activeSearch && !offline && (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setPrompt({ kind: 'saveSearch' })}
                aria-label={t('searches.save')}
                title={t('searches.save')}
              >
                <NotesIcon name="saved" size={14} />
              </button>
            )}
            <div className="note-share-wrap" ref={searchHelp.wrapRef}>
              <button
                ref={searchHelp.buttonRef}
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={searchHelp.toggle}
                aria-expanded={searchHelp.open}
                aria-haspopup="dialog"
                aria-label={t('searchHelp.button')}
                title={t('searchHelp.button')}
              >
                ?
              </button>
              {searchHelp.open && (
                <div className="notes-pop notes-search-help" role="dialog" aria-label={t('searchHelp.title')}>
                  <p className="notes-pop-title">{t('searchHelp.title')}</p>
                  <dl>
                    {SEARCH_OPERATORS.map((op) => (
                      <div key={op}>
                        <dt>
                          <button
                            type="button"
                            className="notes-search-op"
                            onClick={() => {
                              const syntax = t(`searchHelp.items.${op}.syntax`);
                              setQ((cur) => `${cur.trim() ? `${cur.trim()} ` : ''}${syntax}`);
                              searchHelp.close();
                              searchRef.current?.focus();
                            }}
                          >
                            {t(`searchHelp.items.${op}.syntax`)}
                          </button>
                        </dt>
                        <dd>{t(`searchHelp.items.${op}.desc`)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
          {semantic && semanticDegraded && (
            <p className="notes-home-hint" role="status" data-testid="semantic-degraded">
              {t('list.semanticDegraded')}
            </p>
          )}
          <div className="notes-list-meta">
            <span className="notes-list-count">{q.trim() ? t('list.resultCount', { count: notes.length }) : t('list.count', { count: notes.length })}</span>
            <select
              className="select notes-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as NotesSort)}
              aria-label={t('list.sortLabel')}
            >
              <option value="updated">{t('list.sort.updated')}</option>
              <option value="created">{t('list.sort.created')}</option>
              <option value="title">{t('list.sort.title')}</option>
            </select>
          </div>
          {selectMode && (
            <div className="notes-bulk" role="toolbar" aria-label={t('select.label')}>
              <div className="notes-bulk-row">
                <label className="notes-bulk-all">
                  <input
                    type="checkbox"
                    checked={notes.length > 0 && selected.length === notes.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && selected.length < notes.length;
                    }}
                    onChange={(e) => setSelected(e.target.checked ? notes.map((n) => n.id) : [])}
                  />
                  {t('select.all')}
                </label>
                <span className="notes-bulk-count num" aria-live="polite">
                  {t('select.count', { count: selected.length })}
                </span>
              </div>
              {selected.length > 0 && (
                <div className="notes-bulk-row notes-bulk-actions">
                  {inTrash ? (
                    <>
                      <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={() => void runBulk('restore')}>
                        {t('select.restore')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={bulkBusy}
                        onClick={() => setConfirmState({ kind: 'bulkDelete', ids: selected })}
                      >
                        {t('select.deleteForever')}
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        className="select"
                        aria-label={t('select.move')}
                        value=""
                        disabled={bulkBusy}
                        onChange={(e) => {
                          if (e.target.value === '') return;
                          void runBulk('move', { notebook_id: e.target.value === '__none' ? null : e.target.value });
                        }}
                      >
                        <option value="">{t('select.move')}</option>
                        <option value="__none">{t('select.noNotebook')}</option>
                        {notebooks.map((nb) => (
                          <option key={nb.id} value={nb.id}>
                            {nb.stack ? `${nb.stack} / ${nb.name}` : nb.name}
                          </option>
                        ))}
                      </select>
                      <form
                        className="notes-bulk-tag"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!bulkTag.trim()) return;
                          void runBulk('tag', { tag: bulkTag.trim() }).then(() => setBulkTag(''));
                        }}
                      >
                        <input
                          className="input"
                          value={bulkTag}
                          onChange={(e) => setBulkTag(e.target.value)}
                          placeholder={t('select.tagPlaceholder')}
                          aria-label={t('select.tag')}
                          maxLength={60}
                        />
                        <button type="submit" className="btn btn-sm" disabled={bulkBusy || !bulkTag.trim()}>
                          {t('select.tagApply')}
                        </button>
                      </form>
                      <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={() => void runBulk('pin')}>
                        {t('select.pin')}
                      </button>
                      <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={exportSelected}>
                        {t('select.export')}
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" disabled={bulkBusy} onClick={() => void runBulk('trash')}>
                        {t('select.trash')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {filter.kind === 'trash' && notes.length > 0 && !selectMode && (
            <button type="button" className="btn btn-sm btn-danger notes-empty-trash" onClick={() => void emptyTrash()}>
              {t('trash.empty')}
            </button>
          )}
        </div>
        <div
          ref={itemsRef}
          className={`notes-list-items${loading && !showSkeleton ? ' is-refreshing' : ''}`}
          aria-busy={loading}
          onKeyDown={onListKey}
        >
          {listError ? (
            <div className="notes-list-error" role="alert">
              <p>{t('list.loadError')}</p>
              <button type="button" className="btn btn-sm" onClick={() => void refreshList()}>
                {t('list.retry')}
              </button>
            </div>
          ) : showSkeleton ? (
            <div className="notes-skeleton" aria-label={t('list.loading')}>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="notes-skeleton-item">
                  <span className="ui-skeleton ui-skeleton-text" style={{ width: `${70 - i * 6}%` }} />
                  <span className="ui-skeleton ui-skeleton-text" />
                </div>
              ))}
            </div>
          ) : notes.length === 0 ? (
            empty === 'search' ? (
              <div className="notes-no-results">
                <p>{t('list.noResults', { q })}</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setQ('');
                    setActiveSearch(null);
                    searchRef.current?.focus();
                  }}
                >
                  {t('list.clearSearch')}
                </button>
              </div>
            ) : empty === 'trash' ? (
              <EmptyState quiet product="notes" className="notes-empty" title={t('trash.emptyState')} body={t('trash.emptyStateBody')} />
            ) : empty === 'shared' ? (
              <EmptyState quiet product="notes" className="notes-empty" title={t('list.emptySharedTitle')} body={t('list.emptySharedBody')} />
            ) : (
              <EmptyState
                quiet
                product="notes"
                className="notes-empty"
                title={
                  empty === 'pinned'
                    ? t('list.emptyPinnedTitle')
                    : empty === 'notebook'
                      ? t('list.emptyNotebookTitle')
                      : t('list.emptyTitle')
                }
                body={
                  empty === 'pinned'
                    ? t('list.emptyPinnedBody')
                    : empty === 'notebook'
                      ? t('list.emptyNotebookBody')
                      : t('list.emptyBody')
                }
                action={
                  empty === 'pinned' ? undefined : (
                    <button type="button" className="btn btn-primary" onClick={() => void createNote()}>
                      {t('actions.newNote')}
                    </button>
                  )
                }
                secondary={
                  empty === 'all' ? (
                    <span className="notes-empty-links">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTemplatesOpen(true)}>
                        {t('actions.newFromTemplate')}
                      </button>
                      <Link href="/app/notes/clip">{t('list.emptyClip')}</Link>
                    </span>
                  ) : undefined
                }
              />
            )
          ) : (
            notes.map((n) => {
              const isSel = selected.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  data-id={n.id}
                  className={`notes-item${selectMode ? ' is-selecting' : ''}${isSel ? ' is-selected' : ''}`}
                  aria-current={!selectMode && note?.id === n.id ? 'true' : undefined}
                  aria-pressed={selectMode ? isSel : undefined}
                  aria-label={selectMode ? t('select.checkbox', { title: n.title || t('untitled') }) : undefined}
                  onClick={(e) => onItemClick(e, n.id)}
                >
                  {selectMode && (
                    <span className={`notes-item-check${isSel ? ' is-on' : ''}`} aria-hidden="true">
                      {isSel && <NotesIcon name="check" size={12} />}
                    </span>
                  )}
                  <span className="notes-item-title">
                    {n.pinned && !n.trashed && (
                      <span className="notes-pin" title={t('editor.pinned')}>
                        <NotesIcon name="pin" size={12} />
                        <span className="sr-only">{t('editor.pinned')}</span>
                      </span>
                    )}
                    {n.locked && (
                      <span className="notes-pin" title={t('lock.itemLabel')}>
                        <NotesIcon name="lock" size={12} />
                        <span className="sr-only">{t('lock.itemLabel')}</span>
                      </span>
                    )}
                    {n.title || <span className="notes-untitled">{t('untitled')}</span>}
                  </span>
                  {n.snippet && <span className="notes-item-snippet">{n.snippet}</span>}
                  <span className="notes-item-meta">
                    <time dateTime={n.updated_at}>{relTime(n.updated_at)}</time>
                    {n.shared_by && <span className="notes-item-owner">{t('list.sharedBy', { name: n.shared_by })}</span>}
                    {n.tags.slice(0, 3).map((tg) => (
                      <span key={tg} className="notes-item-tag">
                        #{tg}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      )}
      {/* ---------- Editor ---------- */}
      <div className="notes-editor">
        {note && conflict?.id === note.id && (
          <div className="docs-banner docs-banner-bad" role="alert">
            <span>{conflict.trashed ? t('editor.conflictTrashed') : t('editor.conflict')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reloadAfterConflict()}>
              {t('editor.conflictReload')}
            </button>
            {!conflict.trashed && conflict.retry && (
              <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void overwriteAfterConflict()}>
                {t('editor.conflictOverwrite')}
              </button>
            )}
          </div>
        )}
        {note ? (
          <NoteEditorPane
            key={`${note.id}:${editorKey}`}
            note={note}
            notebooks={notebooks}
            focusTitle={focusTitle}
            status={status}
            onBack={() => {
              setFocusMode(false);
              setPane('list');
            }}
            onSaveContent={saveContent}
            onPatch={patchNote}
            onTrash={trash}
            onRestore={restore}
            onDeleteForever={deleteForever}
            onShareChange={(token) => {
              setNote((cur) => (cur ? { ...cur, share_token: token, shared: token != null } : cur));
            }}
            onError={(msg) => {
              setToast(msg ?? t('editor.actionError'));
            }}
            onNotice={setOkToast}
            onOpenNote={openLinkedNote}
            onCreated={addLinkedNote}
            onReload={(id) => void reloadNote(id)}
            onReplace={replaceNote}
            onSync={syncNote}
            onTracked={(id, issues) => {
              setOkToast(t('track.done', { count: issues.length, list: issues.map((i) => i.identifier).join(', ') }));
              void reloadNote(id);
            }}
            offline={offline}
            onRecording={addRecording}
            focusMode={focusMode}
            onToggleFocus={() => setFocusMode((v) => !v)}
            highlight={highlight}
            openShare={openRequests && note.id === initialNote?.id}
          />
        ) : denied ? (
          <NoteAccessGate key={denied.id} noteId={denied.id} initial={denied.status} />
        ) : (
          <div className="notes-editor-empty">
            {notes.length > 0 && (
              <p className="notes-editor-empty-hint">
                <kbd className="kbd">N</kbd>
                {t('editor.hintNew')}
                <span aria-hidden="true">·</span>
                <kbd className="kbd">/</kbd>
                {t('editor.hintSearch')}
              </p>
            )}
          </div>
        )}
      </div>

        </>
      )}

      {sharingNotebook && (
        <NotebookShareDrawer notebookId={sharingNotebook.id} name={sharingNotebook.name} onClose={() => setSharingNotebook(null)} />
      )}

      {askOpen && aiEnabled && (
        <NotesAskPanel
          onClose={() => setAskOpen(false)}
          onOpenNote={(id) => {
            setAskOpen(false);
            void openNote(id);
          }}
        />
      )}

      {templatesOpen && (
        <NotesTemplatesDialog
          onClose={() => setTemplatesOpen(false)}
          onError={setToast}
          onPick={(tpl) => {
            setTemplatesOpen(false);
            void createNote(tpl);
          }}
        />
      )}

      {prompt?.kind === 'saveSearch' && (
        <PromptDialog
          title={t('searches.save')}
          label={t('searches.nameLabel')}
          initial={q.trim().slice(0, 80)}
          confirmLabel={t('templates.save')}
          cancelLabel={t('templates.cancel')}
          hint={<code>{q.trim()}</code>}
          onSubmit={saveSearch}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'renameSearch' && (
        <PromptDialog
          title={t('searches.rename')}
          label={t('searches.nameLabel')}
          initial={prompt.search.name}
          confirmLabel={t('templates.save')}
          cancelLabel={t('templates.cancel')}
          onSubmit={(name) => patchSearch(prompt.search, { name })}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'stack' && (
        <PromptDialog
          title={t('stacks.moveTo')}
          label={t('stacks.nameLabel')}
          initial={prompt.notebook.stack ?? ''}
          placeholder={t('stacks.namePlaceholder')}
          hint={t('stacks.hint')}
          suggestions={stacks}
          confirmLabel={t('stacks.save')}
          cancelLabel={t('stacks.cancel')}
          onSubmit={(stack) => patchNotebook(prompt.notebook, { stack })}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'renameStack' && (
        <PromptDialog
          title={t('stacks.renameTitle')}
          label={t('stacks.nameLabel')}
          initial={prompt.stack}
          confirmLabel={t('templates.save')}
          cancelLabel={t('stacks.cancel')}
          onSubmit={(to) => renameStack(prompt.stack, to)}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'renameTag' && (
        <PromptDialog
          title={t('tags.renameTitle', { tag: prompt.tag })}
          label={t('tags.renameLabel')}
          initial={prompt.tag}
          hint={t('tags.renameHint')}
          maxLength={60}
          confirmLabel={t('tags.save')}
          cancelLabel={t('tags.cancel')}
          onSubmit={(to) => renameTag(prompt.tag, to)}
          onClose={() => setPrompt(null)}
        />
      )}
      <ConfirmDialog
        open={confirmState !== null}
        title={
          confirmState?.kind === 'deleteSearch'
            ? t('searches.confirmDelete', { name: confirmState.search.name })
            : confirmState?.kind === 'deleteTag'
              ? t('tags.confirmDelete', { tag: confirmState.tag })
              : confirmState?.kind === 'bulkDelete'
                ? t('select.confirmDelete', { count: confirmState.ids.length })
                : ''
        }
        confirmLabel={
          confirmState?.kind === 'bulkDelete' ? t('select.deleteForever') : confirmState?.kind === 'deleteTag' ? t('tags.delete') : t('searches.delete')
        }
        cancelLabel={t('templates.cancel')}
        danger
        onConfirm={() => {
          const c = confirmState;
          setConfirmState(null);
          if (c?.kind === 'deleteSearch') void deleteSearch(c.search);
          else if (c?.kind === 'deleteTag') void deleteTag(c.tag);
          else if (c?.kind === 'bulkDelete') void runBulk('delete');
        }}
        onCancel={() => setConfirmState(null)}
      />

      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && (
          <div className="ui-toast" data-tone="error">
            {toast}
            <button type="button" className="ui-toast-action" onClick={() => setToast(null)}>
              {t('ask.close')}
            </button>
          </div>
        )}
        {okToast && !toast && (
          <div className="ui-toast" data-tone="ok">
            {okToast}
            <button type="button" className="ui-toast-action" onClick={() => setOkToast(null)}>
              {t('ask.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
