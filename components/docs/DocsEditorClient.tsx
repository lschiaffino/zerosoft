'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  type DocsBlock,
  type DocsComment,
  type DocsPage,
  type DocsPageShare,
  type DocsShareRole,
} from '@/lib/docs-types';
import { docsPatchTooLong, reminderContext } from '@/lib/docs-schema';
import { listSuggestions, MARK_ID_RE, type DocsSuggestion } from '@/lib/docs-marks';
import type { DocsSnapshot } from '@/lib/docs-history';
import type { DocsGuestInvite } from '@/lib/docs-guests';
import { mergeBlocks, mergeTitle, sameContent } from '@/lib/docs-merge';
import DocsEditor, { type DocsRemoteMerge } from './DocsEditor';
import ShareDialog, { type ShareRequest } from './ShareDialog';
import CommentsPanel from './CommentsPanel';
import VersionsPanel from './VersionsPanel';
import DocsExportDialog from './DocsExportDialog';
import DocsAnalyticsPanel from './DocsAnalyticsPanel';
import DocsTouchBar from './DocsTouchBar';
import { clearDraft, descendantIds, draftText, loadDraft, offlinePages, saveDraft, setOfflinePage, warmOffline, type DocsDraft } from '@/lib/docs-offline';
import SaveTemplateDialog from './SaveTemplateDialog';
import VerifyDialog from './VerifyDialog';
import Icon from '@/components/app/icons';
import DocsGlyph from './DocsGlyphs';
import DocsPageIcon from './DocsPageIcon';
import DocsFavoriteButton from './DocsFavoriteButton';
import { DocsPeerCursors, DocsPresenceAvatars } from './DocsPresence';
import { readCursor, useDocsLive, type LivePulse } from './useDocsLive';
import { useDocsCoedit } from './useDocsCoedit';
import { neutralizeTextForMerge, type CoeditEvent } from '@/lib/docs-coedit-shared';
import type { CoeditEngine } from '@/lib/docs-coedit-client';
import { diff, textHash, apply as applyOp } from '@/lib/docs-ot';
import type { DocsCoeditStructure, DocsEditorApi, DocsEditorMode } from './useDocsCollab';

interface CommentsLabels {
  title: string;
  empty: string;
  placeholder: string;
  add: string;
  resolve: string;
  unresolve: string;
  delete: string;
  resolved: string;
  blockThread: string;
  showAll: string;
  blockTag: string;
}

/** Acceso de quien edita: miembro con acceso total, invitado con total o edición, o "puede comentar". */
export type DocsEditorAccess = 'owner' | 'full' | 'edit' | 'comment';

/** Última versión del servidor que incorporó el editor. */
type ServerBase = { updated_at: string; title: string; content: DocsBlock[] };
const serverBase = (p: Pick<DocsPage, 'updated_at' | 'title' | 'content'>): ServerBase => ({ updated_at: p.updated_at, title: p.title, content: p.content });
/** Un cambio del servidor para sumar a la pantalla: de `sent` a `merged`. */
type Merge = { sent: DocsBlock[]; merged: DocsBlock[]; sentTitle?: string; title?: string };
type SaveItem = { patch: Partial<DocsPage>; rebase: Merge[] };

/** Rebasa un guardado armado antes de un cambio del servidor sobre ese cambio. */
function rebasePatch(patch: Partial<DocsPage>, m: Merge): Partial<DocsPage> {
  let out = patch;
  if (out.content) out = { ...out, content: mergeBlocks(m.sent, m.merged, out.content, 'ours') ?? out.content };
  if (out.title !== undefined && m.sentTitle !== undefined && m.title !== undefined) out = { ...out, title: mergeTitle(m.sentTitle, m.title, out.title) };
  return out;
}

export default function DocsEditorClient({
  page,
  ancestors,
  shares,
  invites = [],
  comments,
  currentUserId,
  commentNote,
  commentsLabels,
  access = 'owner',
  helpBase = null,
  feedback = null,
  backlinks = [],
  favorite = null,
  people = {},
  canVerify = false,
  allowExport = true,
  memberRoleDefault = 'full',
  offlineOwner = '',
  coedit: coeditOn = true,
}: {
  /** Edición simultánea prendida (ajuste del workspace y DOCS_COEDIT). Apagada: guardar y fusionar como antes. */
  coedit?: boolean;
  page: DocsPage;
  ancestors: DocsPage[];
  shares: DocsPageShare[];
  /** Invitaciones pendientes a personas sin cuenta (quien puede compartir). */
  invites?: DocsGuestInvite[];
  comments: DocsComment[];
  currentUserId: string;
  /** Invitado que puede comentar: el aviso dice quién la compartió (un solo banner). */
  commentNote?: string;
  commentsLabels: CommentsLabels;
  access?: DocsEditorAccess;
  helpBase?: string | null;
  feedback?: { yes: number; no: number } | null;
  /** Páginas con un link `[[` a esta (solo el dueño). */
  backlinks?: Array<{ id: string; title: string; icon: string | null }>;
  /** Está en los favoritos de la persona (null = no se puede marcar: página de otro workspace). */
  favorite?: boolean | null;
  /** Personas del workspace (id → nombre): autores de sugerencias y dueño de la wiki. */
  people?: Record<string, string>;
  /** Puede verificar la página (acceso total o dueño de la página). */
  canVerify?: boolean;
  /** Exportar habilitado (Ajustes › Seguridad) para esta persona. */
  allowExport?: boolean;
  /** Rol que heredan los miembros si la página no fija uno (para el selector de Compartir). */
  memberRoleDefault?: DocsShareRole;
  /** Persona:workspace dueña de lo guardado sin conexión en este dispositivo (lib/docs-offline.ts). */
  offlineOwner?: string;
}) {
  const router = useRouter();
  const t = useTranslations('docs');
  const locale = useLocale();
  const isOwner = access === 'owner';
  const canShare = access === 'owner' || access === 'full';
  const canWrite = access !== 'comment';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<'tooLong' | 'failed' | 'conflict' | 'offline' | null>(null);
  /**
   * Un solo mecanismo de fusión (lib/docs-merge.ts), con el servidor como
   * autoridad: cada guardado viaja con el updated_at de la última versión del
   * servidor que este editor incorporó (`base`); si otra persona guardó en el
   * medio, el servidor fusiona contra esa revisión (docs_page_revisions) y
   * devuelve lo fusionado, que el editor suma a lo que tiene en pantalla. El
   * pulso en vivo trae la versión de las demás personas cuando no hay nada
   * propio en camino (si lo hay, la respuesta de ese guardado ya la trae).
   * Lo que se guarda mientras tanto se rebasa sobre esos cambios, así cada
   * cambio entra una sola vez.
   */
  const base = useRef<ServerBase>(serverBase(page));
  /** Guardados en serie: uno en vuelo con la base vieja fusionaría de más. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  /** Guardados esperando turno: se rebasan sobre los cambios del servidor que lleguen antes. */
  const queued = useRef<SaveItem[]>([]);
  /** Última edición de los sincronizados que ya se ve (pulso en vivo). */
  const syncedSeen = useRef<string | null>(null);
  /** Cambios del servidor que el editor todavía no sumó (lo que guarde mientras tanto viene sin ellos). */
  const unapplied = useRef<Array<Merge & { seq: number }>>([]);
  const mergeSeq = useRef(0);
  const [remoteMerge, setRemoteMerge] = useState<DocsRemoteMerge | null>(null);
  /** Último cambio que no se pudo guardar tras varios intentos (para "Sobrescribir"). */
  const conflictPatch = useRef<Partial<DocsPage> | null>(null);
  /** Sesión de esta pestaña (presencia y operaciones). */
  const liveSession = useRef('');
  const coeditEngineRef = useRef<CoeditEngine | null>(null);
  /** Lo que el motor de la edición simultánea tiene sin confirmar (para el borrador sin red). */
  const coeditDraft = () => {
    const engine = coeditEngineRef.current;
    return textOpsRef.current && engine ? { session: liveSession.current, blocks: engine.exportDraft() } : undefined;
  };
  /** Texto propio sin confirmar (operaciones en vuelo o sin mandar): queda en el borrador local. */
  const keepUnconfirmedDraft = () => {
    const engine = coeditEngineRef.current;
    const snap = editorApi.current?.snapshot();
    if (!engine || !snap || !textOpsRef.current || !engine.pending()) return;
    saveDraft(offlineOwner, page.id, { content: snap.blocks }, base.current, coeditDraft());
    // Cuando el servidor confirma todo (y hay red), ese borrador ya no hace falta.
    if (draftWatch.current) return;
    draftWatch.current = setInterval(() => {
      const e = coeditEngineRef.current;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (e && e.pending()) return;
      if (draftWatch.current) clearInterval(draftWatch.current);
      draftWatch.current = null;
      clearDraft(offlineOwner, page.id);
    }, 500);
  };
  const draftWatch = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (draftWatch.current) clearInterval(draftWatch.current);
  }, []);
  /** Manda como operaciones lo escrito sin red en otra sesión (borrador local). */
  const sendDraftOps = async (draft: DocsDraft): Promise<boolean> => {
    const blocks = draft.coedit?.blocks ?? {};
    const texts = new Map((draft.patch.content ?? []).map((b) => [b.id, b.content]));
    const items: Array<{ block: string; rev: number | null; hash: string; op: Array<number | string>; seq: string; base: string }> = [];
    for (const [id, d] of Object.entries(blocks)) {
      let s0 = d.s;
      if (d.inflight) {
        items.push({ block: id, rev: d.rev, hash: textHash(s0), op: d.inflight.op, seq: d.inflight.seq, base: s0 });
        try {
          s0 = applyOp(s0, d.inflight.op);
        } catch {
          continue;
        }
      }
      const text = texts.get(id);
      if (typeof text === 'string' && text !== s0) items.push({ block: id, rev: null, hash: textHash(s0), op: diff(s0, text), seq: `draft.${textHash(s0 + text)}`, base: s0 });
    }
    if (!items.length) {
      void coeditEngineRef.current?.verify(Object.keys(blocks));
      return true;
    }
    const res = await fetch('/api/docs/collab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: page.id, session: draft.coedit!.session, items }),
    }).catch(() => null);
    if (!res?.ok) return false;
    // Lo que quedó en el servidor entra a esta pantalla ya: el stream en vivo puede no
    // estar conectado todavía (recién se abrió la página) y no lo traería.
    const data = (await res.json().catch(() => null)) as { results?: Array<{ events?: CoeditEvent[] }> } | null;
    const engine = coeditEngineRef.current;
    for (const r of data?.results ?? []) for (const e of r.events ?? []) engine?.receive(e);
    // Y por las dudas (un evento que no casó con la base de esta pantalla): se compara con el servidor.
    void engine?.verify(Object.keys(blocks));
    return true;
  };
  const editorApi = useRef<DocsEditorApi | null>(null);
  /** El borrador sin red lo escribió esta pestaña (su texto ya está en el editor). */
  const draftHere = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<DocsPage>(page);
  const [editorKey, setEditorKey] = useState(0);
  const [localShares, setLocalShares] = useState(shares);
  const [localInvites, setLocalInvites] = useState(invites);
  const [shareOpen, setShareOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [commentFocus, setCommentFocus] = useState(0);
  const [allComments, setAllComments] = useState<DocsComment[]>(comments);
  const [blockFilter, setBlockFilter] = useState<string | null>(null);
  const [side, setSide] = useState<'comments' | 'versions' | 'analytics' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** Sin red: lo escrito queda en este dispositivo (lib/docs-offline.ts) hasta que vuelva. */
  const [offline, setOffline] = useState(false);
  const [offlineOn, setOfflineOn] = useState(false);
  /** Lo escrito sin red que ya no se puede guardar (perdió el acceso o la página está bloqueada). */
  const [blockedDraft, setBlockedDraft] = useState<DocsDraft | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const blockedRef = useRef(false);
  blockedRef.current = blockedDraft !== null;
  const openComments = allComments.filter((c) => !c.resolved && !c.parent_id).length;
  const [templateOpen, setTemplateOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<DocsSuggestion[]>(() => listSuggestions(page.content));
  const [pendingAnchor, setPendingAnchor] = useState<{ id: string; quote: string; blockId: string } | null>(null);
  const [focusAnchor, setFocusAnchor] = useState<string | null>(null);
  const [commentsSig, setCommentsSig] = useState<string | undefined>(undefined);
  const [lockNote, setLockNote] = useState<string | null>(null);
  /** "Desbloquear solo para mí" (como Notion): el bloqueo sigue para los demás. */
  const [unlockedForMe, setUnlockedForMe] = useState(false);
  const bypassRef = useRef(false);

  const locked = !!current.locked;
  const lockActive = locked && !(unlockedForMe && canWrite);
  bypassRef.current = locked && unlockedForMe && canWrite;
  // Bloqueada: solo leer y comentar. "Puede comentar": leer y, si lo elige, sugerir.
  /** Perdió el acceso con la página abierta (el stream en vivo se cortó): ya no ve ni manda cambios. */
  const [revoked, setRevoked] = useState(false);
  const mode: DocsEditorMode = revoked || lockActive ? 'readonly' : suggesting ? 'suggest' : canWrite ? 'edit' : 'readonly';
  /** Edición simultánea por operaciones (lib/docs-coedit.ts): el texto de los bloques existentes no viaja en el guardado. */
  const textOps = coeditOn && mode === 'edit';
  const textOpsRef = useRef(textOps);
  textOpsRef.current = textOps;
  /** Motor de la edición simultánea (se arma más abajo, junto al pulso en vivo). */
  const coeditRef = useRef<{ manages: (id: string) => boolean; register: (blocks: DocsBlock[], prune?: boolean) => void } | null>(null);
  /** Sin el texto que ya maneja la edición simultánea (llega por el feed, transformado). */
  const neutral = useCallback((m: Merge): Merge => {
    const c = coeditRef.current;
    return c ? { ...m, merged: neutralizeTextForMerge(m.sent, m.merged, c.manages) } : m;
  }, []);
  /** Nueva base del servidor: los bloques que ya existen allá pasan a viajar por operaciones. */
  const setBase = useCallback((next: Pick<DocsPage, 'updated_at' | 'title' | 'content'>) => {
    base.current = serverBase(next);
    coeditRef.current?.register(next.content, true);
  }, []);

  useEffect(() => {
    setAllComments(comments);
  }, [comments]);

  useEffect(() => {
    setCurrent((prev) => ({ ...prev, ...page, content: prev.content }));
  }, [page]);

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allComments) {
      // Los comentarios sobre texto se ven en el resaltado, no en el badge del bloque.
      if (c.block_id && !c.anchor_id) counts[c.block_id] = (counts[c.block_id] ?? 0) + 1;
    }
    return counts;
  }, [allComments]);

  const handleBlockComment = useCallback((blockId: string) => {
    setBlockFilter(blockId);
    setSide('comments');
    setCommentFocus((n) => n + 1);
  }, []);

  const handlePageComment = useCallback(() => {
    setBlockFilter(null);
    setSide('comments');
    setCommentFocus((n) => n + 1);
  }, []);

  /** Un cambio del servidor para la pantalla y para los guardados en cola. */
  const pushMerge = useCallback((raw: Merge) => {
    const m = neutral(raw);
    const seq = ++mergeSeq.current;
    for (const q of queued.current) q.rebase.push(m);
    unapplied.current.push({ ...m, seq });
    setRemoteMerge({ seq, ...m });
  }, [neutral]);

  const onRemoteApplied = useCallback((seq: number, merged: DocsSnapshot) => {
    unapplied.current = unapplied.current.filter((m) => m.seq > seq);
    setSuggestions(listSuggestions(merged.blocks));
    setCurrent((prev) => (prev.title === merged.title ? prev : { ...prev, title: merged.title }));
  }, []);

  /** Pasa a `next` como base y suma a la pantalla lo que cambió desde la anterior. */
  const adoptServer = useCallback(
    (next: DocsPage) => {
      const old = base.current;
      setBase(next);
      if (!sameContent(old.content, next.content) || old.title !== next.title) {
        pushMerge({ sent: old.content, merged: next.content, sentTitle: old.title, title: next.title });
      }
    },
    [pushMerge, setBase],
  );

  const runSave = useCallback(
    async (item: SaveItem, force: boolean, attempt = 0): Promise<void> => {
      queued.current = queued.current.filter((q) => q !== item);
      let patch = item.patch;
      for (const m of item.rebase) patch = rebasePatch(patch, m);
      setSaving(true);
      inFlight.current++;
      let tz: string | undefined;
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        tz = undefined;
      }
      // Todo PATCH va con la base (también publicar, bloquear o el ancho): si
      // no, uno sin contenido adelantaba la base y el próximo pisaba lo ajeno.
      const withCtx = { ...patch, ...reminderContext(patch, locale, tz), ...(bypassRef.current && !('locked' in patch) ? { bypass_lock: true } : {}) };
      const body = JSON.stringify({ ...withCtx, base_updated_at: base.current.updated_at, ...(force ? { merge: 'ours' } : {}), ...(textOpsRef.current ? { text_ops: true } : {}) });
      const prevTitle = base.current.title;
      let retry: SaveItem | null = null;
      try {
        const res = await fetch(`/api/docs/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          // El guardado pendiente también se manda al cerrar/navegar (keepalive: tope de 64KB).
          keepalive: body.length < 60_000,
        });
        if (res.status === 409) {
          // El servidor no pudo fusionar (la base es muy vieja o se coló otro
          // guardado): trae la versión actual; se suma a la pantalla, este
          // guardado se rebasa sobre ella y se reintenta.
          const data = (await res.json().catch(() => null)) as { current?: DocsPage | null } | null;
          const remote = data?.current;
          if (remote && attempt < 3 && !force) {
            const old = base.current;
            adoptServer(remote);
            retry = { patch: rebasePatch(patch, neutral({ sent: old.content, merged: remote.content, sentTitle: old.title, title: remote.title })), rebase: [] };
            return;
          }
          conflictPatch.current = patch;
          setSaveError('conflict');
          return;
        }
        if (res.status === 423) {
          // Alguien la bloqueó mientras tanto.
          setCurrent((prev) => ({ ...prev, locked: true }));
          setLockNote(t('lock.lockedMeanwhile'));
          setSaveError(null);
          return;
        }
        if (res.status === 403 && patch.content && attempt < 2 && !force) {
          // Sugerencias o comentarios mientras otra persona escribe en vivo: si a esta
          // pantalla le faltaba una tecla ajena, se reintenta con lo que tiene ahora.
          await new Promise((r) => setTimeout(r, 700));
          const snap = editorApi.current?.snapshot();
          retry = { patch: { ...patch, content: snap?.blocks ?? patch.content }, rebase: [] };
          return;
        }
        if (!res.ok) {
          setSaveError('failed');
          // Un interruptor optimista que no se guardó vuelve al valor del server.
          if ('published' in patch || 'is_public' in patch || 'locked' in patch) router.refresh();
          return;
        }
        conflictPatch.current = null;
        setSaveError(null);
        const updated = (await res.json().catch(() => null)) as (DocsPage & { merged?: boolean; stale_base?: boolean }) | null;
        // Un cambio sin contenido sobre una versión vieja no adelanta la base:
        // el próximo guardado de contenido se fusiona con lo ajeno.
        if (updated?.updated_at && !updated.stale_base) setBase(updated);
        // Fusionado con lo que había guardado: el editor suma a lo suyo lo que trajo.
        if (updated?.merged && updated.content && patch.content && !sameContent(patch.content, updated.content)) {
          pushMerge({ sent: patch.content, merged: updated.content, sentTitle: patch.title, title: updated.title });
        } else if (updated?.merged && patch.title !== undefined && updated.title !== patch.title) {
          pushMerge({ sent: patch.content ?? updated.content, merged: updated.content, sentTitle: patch.title, title: updated.title });
        }
        if (updated && ('published' in patch || 'is_public' in patch || 'locked' in patch || 'member_role' in patch)) {
          setCurrent((prev) => ({
            ...prev,
            published: updated.published,
            slug: updated.slug,
            is_public: updated.is_public,
            locked: updated.locked,
            member_role: updated.member_role,
          }));
        }
        // Renombrar (o cualquier cambio que no es solo contenido): el sidebar y las listas se refrescan.
        if (!('content' in patch) || ('title' in patch && patch.title !== prevTitle)) router.refresh();
      } catch {
        // Sin red: queda en el borrador local y se manda al volver (no es un error).
        if (typeof navigator !== 'undefined' && navigator.onLine === false && saveDraft(offlineOwner, page.id, patch, base.current, coeditDraft())) {
          draftHere.current = true;
          setOffline(true);
          setSaveError('offline');
        } else setSaveError('failed');
      } finally {
        inFlight.current--;
        setSaving(false);
        if (retry) await runSave(retry, false, attempt + 1);
      }
    },
    [page.id, router, locale, adoptServer, pushMerge, t, offlineOwner, neutral, setBase],
  );

  const savePage = useCallback(
    async (patch: Partial<DocsPage>) => {
      // El servidor rechaza el PATCH entero si un bloque pasa el tope: avisar en
      // vez de mostrar "Guardado" y perder lo escrito.
      if (docsPatchTooLong(patch)) {
        setSaveError('tooLong');
        return;
      }
      if (patch.content) setSuggestions(listSuggestions(patch.content));
      // Sin red: directo al borrador local (sin esperar a que falle el pedido).
      if (typeof navigator !== 'undefined' && navigator.onLine === false && saveDraft(offlineOwner, page.id, patch, base.current, coeditDraft())) {
        draftHere.current = true;
        setOffline(true);
        setSaveError('offline');
        return;
      }
      const item: SaveItem = { patch, rebase: unapplied.current.map(({ sent, merged, sentTitle, title }) => ({ sent, merged, sentTitle, title })) };
      queued.current.push(item);
      const next = saveChain.current.then(() => runSave(item, false));
      saveChain.current = next;
      await next;
    },
    [runSave, page.id, offlineOwner],
  );

  /**
   * Manda el borrador local (lo escrito sin red) contra la versión sobre la
   * que se escribió: el servidor lo fusiona con lo que otros guardaron. Si ya
   * no tiene esa versión (409), se rebasa sobre la actual y se guarda normal.
   */
  const flushDraftNow = useCallback(async () => {
    const draft = loadDraft(offlineOwner, page.id);
    if (!draft || blockedRef.current || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    // Escrito sin red en otra pestaña o antes de recargar: el texto sale como operaciones
    // (fusión tecla por tecla); en esta misma pestaña ya lo manda el motor.
    if (draft.coedit && draft.coedit.session !== liveSession.current) {
      const ok = await sendDraftOps(draft);
      if (!ok) return;
    } else if (draft.coedit) {
      // Escrito en esta pestaña: lo manda el motor. Se espera a que el servidor lo
      // confirme antes de guardar y borrar el borrador (si se cerrara en el medio, quedaba sin nada).
      const engine = coeditEngineRef.current;
      engine?.resume();
      for (let i = 0; i < 50 && engine?.pending(); i++) await new Promise((r) => setTimeout(r, 200));
    }
    const body = JSON.stringify({ ...draft.patch, base_updated_at: draft.base.updated_at, ...(draft.coedit ? { text_ops: true } : {}) });
    // Cuenta como un guardado en curso: el pulso no trae lo ajeno en el medio (si lo
    // traía, el editor guardaba también lo escrito sin red y quedaba dos veces).
    inFlight.current++;
    const res = await fetch(`/api/docs/pages/${page.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
      .catch(() => null)
      .finally(() => {
        inFlight.current--;
      });
    if (!res) return;
    if (res.ok) {
      const updated = (await res.json().catch(() => null)) as DocsPage | null;
      clearDraft(offlineOwner, page.id);
      // Lo escrito en esta pestaña todavía viaja como operaciones: hasta que se confirme,
      // queda en el borrador (si se recarga en el medio, se manda al volver a abrir).
      keepUnconfirmedDraft();
      setOffline(false);
      setSaveError(null);
      if (updated?.updated_at) {
        // Escrito sin red en esta pestaña: lo que se mandó (el borrador) es lo que la pantalla
        // ya tiene. Se fusiona contra eso, como un guardado, y entra solo lo ajeno (contra la
        // base vieja, lo propio se sumaba dos veces). Un borrador de antes de abrir no está
        // en pantalla: ese sí se suma desde la base vieja.
        // (Solo sin edición simultánea: con ella el texto viaja por operaciones y la fusión es la de siempre.)
        const sent = draftHere.current && !draft.coedit ? draft.patch.content : undefined;
        draftHere.current = false;
        if (sent) {
          base.current = serverBase(updated);
          if (!sameContent(sent, updated.content) || (draft.patch.title !== undefined && draft.patch.title !== updated.title)) {
            pushMerge({ sent, merged: updated.content, sentTitle: draft.patch.title, title: updated.title });
          }
        } else adoptServer(updated);
      }
      return;
    }
    if (res.status === 409) {
      const data = (await res.json().catch(() => null)) as { current?: DocsPage | null } | null;
      if (data?.current) {
        const rebased = rebasePatch(draft.patch, neutral({ sent: draft.base.content, merged: data.current.content, sentTitle: draft.base.title, title: data.current.title }));
        clearDraft(offlineOwner, page.id);
        setOffline(false);
        adoptServer(data.current);
        // Va a la cola detrás de este envío (esperarlo acá trabaría la cola).
        void savePage(rebased);
      }
      return;
    }
    // Ya no puede editarla (sin acceso, solo lectura o bloqueada): no se reintenta más;
    // se avisa y se ofrece copiar lo escrito.
    // Sesión vencida: el borrador queda intacto y se manda al volver a entrar.
    if (res.status === 401) {
      setSaveError('failed');
      return;
    }
    // Sin permiso, borrada o bloqueada: el borrador queda guardado hasta que la
    // persona elige Descartar (puede copiarlo antes); no se reintenta en esta pestaña.
    if (res.status === 403 || res.status === 404 || res.status === 423) {
      setOffline(false);
      setSaveError(null);
      setBlockedDraft(draft);
      return;
    }
    // Error del servidor: el borrador queda y se reintenta al volver la red o al abrir.
    setSaveError('failed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, adoptServer, savePage, offlineOwner, neutral, pushMerge]);

  /**
   * El borrador sale por la misma cola que los guardados del editor: uno detrás
   * del otro, y lo que el editor guarde después se rebasa sobre lo fusionado.
   */
  const flushDraft = useCallback(() => {
    const next = saveChain.current.then(() => flushDraftNow());
    saveChain.current = next.catch(() => undefined);
    return next;
  }, [flushDraftNow]);

  // Al abrir con un borrador pendiente o al volver la red: se manda.
  useEffect(() => {
    if (loadDraft(offlineOwner, page.id)) {
      setOffline(navigator.onLine === false);
      setSaveError(navigator.onLine === false ? 'offline' : null);
      void flushDraft();
    }
    const goOnline = () => void flushDraft();
    const goOffline = () => setOffline(true);
    const back = () => setOffline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('online', back);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('online', back);
      window.removeEventListener('offline', goOffline);
    };
  }, [page.id, flushDraft, offlineOwner]);

  // Recargar o cerrar con teclas que todavía no confirmó el servidor: quedan en el borrador
  // y se mandan al volver a abrir (con la misma seq: nunca dos veces).
  useEffect(() => {
    const onHide = () => keepUnconfirmedDraft();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, offlineOwner]);

  // Una vista por apertura (Analítica de la página) y la marca de "Disponible sin conexión".
  useEffect(() => {
    void fetch(`/api/docs/pages/${page.id}/views`, { method: 'POST' }).catch(() => undefined);
    setOfflineOn(offlinePages(offlineOwner).includes(page.id));
  }, [page.id, offlineOwner]);

  /** "Disponible sin conexión": guarda la página y sus subpáginas en el service worker. */
  const toggleOffline = useCallback(async () => {
    const on = !offlineOn;
    setOfflinePage(offlineOwner, page.id, on);
    setOfflineOn(on);
    if (!on) return;
    const urls = [`/${locale}/app/docs`, `/${locale}/app/docs/${page.id}`];
    const res = await fetch('/api/docs/pages?limit=500').catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { rows?: Array<{ id: string; parent_id: string | null }> } | null) : null;
    for (const id of descendantIds(page.id, data?.rows ?? [])) urls.push(`/${locale}/app/docs/${id}`);
    warmOffline(offlineOwner, urls);
  }, [offlineOn, page.id, locale, offlineOwner]);

  // Último recurso (3 fusiones seguidas fallaron): traer lo del server o pisar a sabiendas.
  const reloadAfterConflict = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`);
    if (!res.ok) return;
    const fresh = (await res.json()) as DocsPage;
    coeditEngineRef.current?.reset();
    setBase(fresh);
    unapplied.current = [];
    conflictPatch.current = null;
    setSaveError(null);
    setCurrent(fresh);
    setEditorKey((k) => k + 1);
    router.refresh();
  }, [page.id, router, setBase]);

  const overwriteAfterConflict = useCallback(async () => {
    const patch = conflictPatch.current;
    if (!patch) return;
    const next = saveChain.current.then(() => runSave({ patch, rebase: [] }, true));
    saveChain.current = next;
    await next;
  }, [runSave]);

  // ---------- En vivo ----------
  const onPulse = useCallback(
    (pulse: LivePulse) => {
      setCommentsSig(pulse.comments);
      if (pulse.locked !== !!current.locked && inFlight.current === 0) {
        setCurrent((prev) => ({ ...prev, locked: pulse.locked }));
        // Sin cambios esperando guardarse no hay nada que se haya perdido.
        if (pulse.locked) setLockNote(queued.current.length ? t('lock.lockedMeanwhile') : t('lock.lockedLive'));
      }
      const remote = pulse.page;
      const syncedChanged = syncedSeen.current !== null && pulse.synced_at !== undefined && pulse.synced_at !== syncedSeen.current;
      if (syncedSeen.current === null && pulse.synced_at !== undefined) syncedSeen.current = pulse.synced_at;
      // Con un guardado en camino no: su respuesta ya trae lo fusionado.
      if (!remote || inFlight.current > 0 || queued.current.length) return;
      // Más vieja que lo que ya se incorporó (el pulso salió antes de un guardado),
      // salvo que haya cambiado un bloque sincronizado desde otra página.
      if (remote.updated_at <= base.current.updated_at && !syncedChanged) return;
      if (pulse.synced_at !== undefined) syncedSeen.current = pulse.synced_at;
      adoptServer(remote);
      setCurrent((prev) => ({ ...prev, locked: remote.locked, verified_at: remote.verified_at, verified_until: remote.verified_until }));
    },
    [adoptServer, current.locked, t],
  );
  const liveMode = mode === 'edit' ? 'edit' : mode === 'suggest' ? 'suggest' : canWrite ? 'view' : 'comment';
  const { peers, session, pulseNow, upsertPeer, removePeer } = useDocsLive({
    pageId: page.id,
    since: () => base.current.updated_at,
    syncedAt: () => syncedSeen.current,
    mode: liveMode,
    rootRef: wrapRef,
    onPulse,
    enabled: !revoked,
  });
  liveSession.current = session;

  // ---------- Edición simultánea ----------
  const coedit = useDocsCoedit({
    pageId: page.id,
    session,
    canSend: textOps,
    enabled: !revoked && coeditOn,
    editorApi,
    bypassLock: () => bypassRef.current,
    selfUserId: currentUserId,
    onCursor: (ev) =>
      upsertPeer({ session: ev.session, user_id: ev.user, name: ev.name, image: ev.image, block_id: ev.block, start: ev.start, end: ev.end, mode: ev.mode, updated_at: new Date().toISOString() }),
    onLeave: removePeer,
    onSaved: pulseNow,
    // Cambió su rol en la página: se vuelve a cargar con el permiso nuevo.
    onAccess: () => router.refresh(),
    onRevoked: () => setRevoked(true),
    onSendError: (code) => {
      if (code === 'locked') setCurrent((prev) => ({ ...prev, locked: true }));
      else if (code === 'forbidden' || code === 'not_found') router.refresh();
      // El servidor rechaza lo que se escribe (límite, error): se avisa en vez de mostrar "Guardado".
      else if (code.startsWith('http_')) setSaveError((prev) => prev ?? 'failed');
    },
    onSendOk: () => setSaveError((prev) => (prev === 'failed' ? null : prev)),
    // Un link a página o un bloque demasiado largo: el texto sale por el guardado (que avisa si no entra).
    onUnmanaged: () => {
      const snap = editorApi.current?.snapshot();
      if (snap) void savePage({ content: snap.blocks });
    },
  });
  // Apagada: nada viaja por operaciones (el guardado lleva y fusiona todo el texto).
  coeditRef.current = coeditOn ? coedit : null;
  coeditEngineRef.current = coeditOn ? coedit.engine.current : null;
  /** Al fusionar estructura: qué bloques viajan por operaciones y reubicar lo propio al partir o unir. */
  const coeditStructure = useMemo<DocsCoeditStructure>(
    () => ({
      manages: (id) => coeditEngineRef.current?.manages(id) ?? false,
      remap: (prev, theirs, merged, caret) => (textOpsRef.current ? coeditEngineRef.current?.remap(prev, theirs, merged, caret) ?? null : null),
    }),
    [],
  );
  // Los bloques que ya existen en el servidor viajan por operaciones desde el primer momento.
  // (También con una sesión nueva: volver con Atrás arma un motor nuevo.)
  useEffect(() => {
    if (coeditOn) coedit.register(base.current.content, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, session]);
  // El cursor propio sale enseguida por el mismo feed (el pulso queda de respaldo).
  const sendCursor = coedit.sendCursor;
  useEffect(() => {
    if (revoked || !coeditOn) return;
    const onSel = () => {
      const cur = readCursor(wrapRef.current);
      if (cur.block_id || peers.length) sendCursor({ block: cur.block_id, start: cur.start, end: cur.end, mode: liveMode });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [sendCursor, liveMode, peers.length, revoked, coeditOn]);

  const jumpToPeer = useCallback((p: { block_id: string | null }) => {
    if (!p.block_id) return;
    wrapRef.current
      ?.querySelector(`[data-block-anchor="${CSS.escape(p.block_id)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // ---------- Comentarios sobre texto ----------
  const onInlineComment = useCallback(
    (sel: { blockId: string; start: number; end: number; quote: string }) => {
      const api = editorApi.current;
      if (!api || !sel.quote.trim()) return;
      if (pendingAnchor) api.unwrapComment(pendingAnchor.id);
      const id = crypto.randomUUID();
      if (!api.wrapComment(sel.blockId, sel.start, sel.end, id)) return;
      setPendingAnchor({ id, quote: sel.quote.slice(0, 500), blockId: sel.blockId });
      setBlockFilter(null);
      setSide('comments');
    },
    [pendingAnchor],
  );

  // ⌘⇧M: comentar la selección (como Notion).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== 'm') return;
      const sel = editorApi.current?.selection();
      if (!sel) return;
      e.preventDefault();
      onInlineComment(sel);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onInlineComment]);

  // Click en un resaltado: abre su hilo. Click en una sugerencia: el panel.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const mark = target?.closest?.('span[data-comment]');
      const id = mark?.getAttribute('data-comment');
      if (id && MARK_ID_RE.test(id) && allComments.some((c) => c.anchor_id === id)) {
        setFocusAnchor(id);
        setBlockFilter(null);
        setSide('comments');
        return;
      }
      if (target?.closest?.('span[data-sug], [data-sug-block]')) setSide('comments');
    };
    wrap.addEventListener('click', onClick);
    return () => wrap.removeEventListener('click', onClick);
  }, [allComments]);

  const focusThreadText = useCallback((anchorId: string) => {
    setFocusAnchor(anchorId);
    const el = wrapRef.current?.querySelector(`span[data-comment="${CSS.escape(anchorId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  /** Resaltado de los hilos abiertos (los resueltos no se marcan, como en Notion). */
  const highlightCss = useMemo(() => {
    const open = new Set(allComments.filter((c) => !c.parent_id && !c.resolved && c.anchor_id).map((c) => c.anchor_id!));
    if (pendingAnchor) open.add(pendingAnchor.id);
    const ids = [...open].filter((id) => MARK_ID_RE.test(id));
    if (!ids.length) return '';
    const sel = ids.map((id) => `.docs-editor span[data-comment="${id}"]`).join(',');
    const focus = focusAnchor && MARK_ID_RE.test(focusAnchor) ? `.docs-editor span[data-comment="${focusAnchor}"]{background:var(--docs-comment-hl-strong)}` : '';
    return `${sel}{background:var(--docs-comment-hl);border-bottom:2px solid var(--docs-comment-line);cursor:pointer}${focus}`;
  }, [allComments, pendingAnchor, focusAnchor]);

  const focusSuggestion = useCallback((s: DocsSuggestion) => {
    const el = wrapRef.current?.querySelector(`[data-sug="${CSS.escape(s.id)}"], [data-sug-block="${CSS.escape(s.id)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // ---------- Compartir ----------
  const refreshShares = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { shares?: DocsPageShare[]; invites?: DocsGuestInvite[] };
    if (data.shares) setLocalShares(data.shares);
    if (data.invites) setLocalInvites(data.invites);
  }, [page.id]);

  const updateSharing = useCallback(
    async (patch: Partial<DocsPage>) => {
      setCurrent((prev) => ({ ...prev, ...patch }));
      await savePage(patch);
      if (patch.inherit_shares !== undefined) await refreshShares();
    },
    [savePage, refreshShares],
  );

  const handleShare = useCallback(
    async (req: ShareRequest): Promise<string | null> => {
      const res = await fetch(`/api/docs/pages/${page.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: req.kind, target_id: req.targetId ?? null, email: req.email, role: req.role }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return data.error ?? 'error';
      }
      const data = (await res.json()) as DocsPageShare | { invite: DocsGuestInvite };
      if ('invite' in data) {
        setLocalInvites((prev) => [data.invite, ...prev.filter((i) => i.id !== data.invite.id && i.email !== data.invite.email)]);
        return null;
      }
      setLocalShares((prev) => [data, ...prev.filter((s) => s.id !== data.id && !(s.kind === data.kind && s.target_id === data.target_id))]);
      await refreshShares();
      router.refresh();
      return null;
    },
    [page.id, router, refreshShares],
  );

  const handleRoleChange = useCallback(
    async (shareId: string, role: DocsShareRole) => {
      setLocalShares((prev) => prev.map((s) => (s.id === shareId ? { ...s, role } : s)));
      await fetch(`/api/docs/pages/${page.id}/share/${shareId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }).catch(() => {});
    },
    [page.id],
  );

  const handleUnshare = useCallback(
    async (shareId: string) => {
      const res = await fetch(`/api/docs/pages/${page.id}/share/${shareId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setLocalShares((prev) => prev.filter((s) => s.id !== shareId));
      await refreshShares();
      router.refresh();
    },
    [page.id, router, refreshShares],
  );

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      const res = await fetch(`/api/docs/pages/${page.id}/share/${inviteId}?invite=1`, { method: 'DELETE' });
      if (res.ok) setLocalInvites((prev) => prev.filter((i) => i.id !== inviteId));
    },
    [page.id],
  );

  const duplicatePage = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}/duplicate`, { method: 'POST' });
    if (!res.ok) return;
    const duplicated = (await res.json()) as DocsPage;
    router.push(`/app/docs/${duplicated.id}`);
  }, [page.id, router]);

  const trashPage = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) return;
    router.push('/app/docs');
    router.refresh();
  }, [page.id, router]);

  const restorePage = useCallback(async () => {
    await savePage({ archived: false });
  }, [savePage]);

  const toggleLock = useCallback(async () => {
    const next = !locked;
    setCurrent((prev) => ({ ...prev, locked: next }));
    setLockNote(null);
    setUnlockedForMe(false);
    if (next) setSuggesting(false);
    await savePage({ locked: next });
  }, [locked, savePage]);

  const onVersionRestored = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`);
    if (res.ok) {
      const fresh = (await res.json()) as DocsPage;
      base.current = serverBase(fresh);
      unapplied.current = [];
      setCurrent(fresh);
      setSuggestions(listSuggestions(fresh.content));
      setEditorKey((k) => k + 1);
    }
    router.refresh();
  }, [page.id, router]);

  const toggle = (panel: 'comments' | 'versions' | 'analytics') => setSide((cur) => (cur === panel ? null : panel));
  const verified = current.verified_at
    ? current.verified_until && Date.parse(current.verified_until) <= Date.now()
      ? 'expired'
      : 'verified'
    : null;
  const peopleList = useMemo(() => Object.entries(people).map(([id, name]) => ({ id, name })), [people]);

  const topActions = (
    <>
      <DocsPresenceAvatars peers={peers} onJump={jumpToPeer} />
      {verified && (
        <button
          type="button"
          className={`docs-verified-badge${verified === 'expired' ? ' is-expired' : ''}`}
          onClick={() => canVerify && setVerifyOpen(true)}
          disabled={!canVerify}
          data-testid="docs-verified-badge"
        >
          <DocsGlyph name={verified === 'expired' ? 'alert' : 'check'} size={13} />
          {verified === 'expired' ? t('verify.expiredBadge') : t('verify.badge')}
        </button>
      )}
      {locked && (
        <span className="docs-locked-badge" data-testid="docs-locked-badge">
          <DocsGlyph name="lock" size={13} />
          {t('lock.badge')}
        </span>
      )}
      {current.published && (
        <span className="docs-published">
          <span className="docs-published-dot" aria-hidden="true" />
          {t('editor.published')}
        </span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm docs-top-btn"
        onClick={() => toggle('comments')}
        aria-pressed={side === 'comments'}
      >
        {t('comments.title')}
        {openComments + suggestions.length > 0 && <span className="docs-top-count">{openComments + suggestions.length}</span>}
      </button>
      {favorite !== null && <DocsFavoriteButton pageId={page.id} initial={favorite} />}
      {canShare && (
        <button
          type="button"
          className="btn btn-secondary btn-sm docs-top-btn"
          onClick={() => setShareOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={shareOpen}
        >
          {t('share.title')}
        </button>
      )}
    </>
  );

  const menuExtra = (close: () => void) => (
    <>
      {!locked && (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={suggesting}
          className="docs-menu-item"
          data-testid="docs-suggest-toggle"
          onClick={() => {
            close();
            setSuggesting((v) => !v);
          }}
        >
          {suggesting ? t('suggest.stop') : t('suggest.start')}
        </button>
      )}
      {canWrite && (
        <button type="button" role="menuitemcheckbox" aria-checked={locked} className="docs-menu-item" data-testid="docs-lock-toggle" onClick={() => {
          close();
          void toggleLock();
        }}>
          {locked ? t('lock.unlock') : t('lock.lock')}
        </button>
      )}
      {canVerify && (
        <button type="button" role="menuitem" className="docs-menu-item" data-testid="docs-verify-open" onClick={() => {
          close();
          setVerifyOpen(true);
        }}>
          {current.verified_at ? t('verify.manage') : t('verify.open')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="docs-menu-item"
        onClick={() => {
          close();
          setSide('versions');
        }}
      >
        {t('versions.title')}
      </button>
      {canWrite && (
        <button
          type="button"
          role="menuitem"
          className="docs-menu-item"
          data-testid="docs-analytics-open"
          onClick={() => {
            close();
            setSide('analytics');
          }}
        >
          {t('analytics.title')}
        </button>
      )}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={offlineOn}
        className="docs-menu-item"
        data-testid="docs-offline-toggle"
        onClick={() => {
          close();
          void toggleOffline();
        }}
      >
        {t('offline.available')}
      </button>
      {allowExport && (
        <button
          type="button"
          role="menuitem"
          className="docs-menu-item"
          data-testid="docs-export-open"
          onClick={() => {
            close();
            setExportOpen(true);
          }}
        >
          {t('export.open')}
        </button>
      )}
      {isOwner && (
        <button
          type="button"
          role="menuitem"
          className="docs-menu-item"
          onClick={() => {
            close();
            setTemplateOpen(true);
          }}
        >
          {t('templates.saveAs')}
        </button>
      )}
      {allowExport && (
        <button
          type="button"
          role="menuitem"
          className="docs-menu-item"
          onClick={() => {
            close();
            setSide(null);
            setTimeout(() => window.print(), 50);
          }}
        >
          {t('export.print')}
        </button>
      )}
    </>
  );

  return (
    <div ref={wrapRef} className={`docs-editor-wrap${side ? ' has-side' : ''}`}>
      {highlightCss && <style>{highlightCss}</style>}
      {current.archived && (
        <div className="docs-banner" role="status">
          <span>{t('editor.inTrash')}</span>
          {isOwner && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={restorePage}>
              {t('trash.restore')}
            </button>
          )}
        </div>
      )}
      {lockActive && (
        <div className="docs-banner docs-banner-quiet" role="status" data-testid="docs-locked-banner">
          <DocsGlyph name="lock" size={14} />
          <span>{lockNote ?? t('lock.banner')}</span>
          {canWrite && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUnlockedForMe(true)} data-testid="docs-unlock-me">
                {t('lock.unlockForMe')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggleLock()}>
                {t('lock.unlock')}
              </button>
            </>
          )}
        </div>
      )}
      {locked && !lockActive && (
        <div className="docs-banner docs-banner-quiet" role="status" data-testid="docs-unlocked-me-banner">
          <DocsGlyph name="lock" size={14} />
          <span>{t('lock.unlockedForMe')}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUnlockedForMe(false)}>
            {t('lock.lockAgain')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggleLock()}>
            {t('lock.unlockAll')}
          </button>
        </div>
      )}
      {!locked && mode === 'suggest' && (
        <div className="docs-banner docs-banner-quiet docs-banner-suggest" role="status" data-testid="docs-suggest-banner">
          <span>{t('suggest.banner')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSuggesting(false)}>
            {t('suggest.stop')}
          </button>
        </div>
      )}
      {!locked && access === 'comment' && !suggesting && (
        <div className="docs-banner docs-banner-quiet" role="status">
          <span>{commentNote ?? t('suggest.commentOnly')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSuggesting(true)}>
            {t('suggest.start')}
          </button>
        </div>
      )}
      {offline && (
        <div className="docs-banner docs-banner-quiet" role="status" data-testid="docs-offline-banner">
          <span>{t('offline.banner')}</span>
        </div>
      )}
      {blockedDraft && (
        <div className="docs-banner docs-banner-bad" role="alert" data-testid="docs-offline-blocked">
          <span>{t('offline.blocked')}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(draftText(blockedDraft)).then(() => setDraftCopied(true)).catch(() => undefined);
            }}
          >
            {draftCopied ? t('offline.copied') : t('offline.copy')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              clearDraft(offlineOwner, page.id);
              setBlockedDraft(null);
            }}
          >
            {t('offline.discard')}
          </button>
        </div>
      )}
      {revoked && (
        <div className="docs-banner docs-banner-bad" role="alert" data-testid="docs-access-revoked">
          <span>{t('coedit.revoked')}</span>
          <Link href="/app/docs" className="btn btn-secondary btn-sm">
            {t('coedit.backToDocs')}
          </Link>
        </div>
      )}
      {saveError === 'conflict' && (
        <div className="docs-banner docs-banner-bad" role="alert">
          <span>{t('editor.conflict')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reloadAfterConflict}>
            {t('editor.conflictReload')}
          </button>
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={overwriteAfterConflict}>
            {t('editor.conflictOverwrite')}
          </button>
        </div>
      )}
      <DocsEditor
        key={editorKey}
        page={current}
        ancestors={ancestors}
        onSave={savePage}
        remoteMerge={remoteMerge}
        onRemoteApplied={onRemoteApplied}
        saving={saving}
        saveError={saveError}
        onDuplicate={isOwner ? duplicatePage : undefined}
        onDelete={isOwner ? trashPage : undefined}
        topActions={topActions}
        menuExtra={menuExtra}
        layoutToggles={isOwner && !lockActive}
        onAddComment={handlePageComment}
        commentCounts={commentCounts}
        onBlockComment={handleBlockComment}
        importUrl={canWrite && !lockActive ? `/api/docs/pages/${page.id}/import` : undefined}
        mode={mode}
        apiRef={editorApi}
        onLocalChange={coedit.localChanged}
        coeditStructure={coeditStructure}
        currentUserId={currentUserId}
        onInlineComment={onInlineComment}
        belowTitle={
          backlinks.length > 0 ? (
            <nav className="docs-backlinks" aria-label={t('mentions.linkedFrom')}>
              <span className="docs-backlinks-label">{t('mentions.linkedFrom')}</span>
              <ul>
                {backlinks.map((b) => (
                  <li key={b.id}>
                    <Link href={`/app/docs/${b.id}`} className="docs-backlink">
                      <DocsPageIcon icon={b.icon} pageId={b.id} size={14} fallback />
                      <span>{b.title || t('untitled')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null
        }
      />
      <DocsPeerCursors peers={peers} containerRef={wrapRef} />
      <DocsTouchBar enabled={mode === 'edit' || mode === 'suggest'} />
      <aside
        className="docs-side"
        hidden={!side}
        aria-label={side === 'versions' ? t('versions.title') : side === 'analytics' ? t('analytics.title') : t('comments.title')}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon docs-side-close"
          onClick={() => setSide(null)}
          aria-label={t('editor.closePanel')}
          title={t('editor.closePanel')}
        >
          <Icon name="close" size={16} />
        </button>
        {side === 'analytics' && <DocsAnalyticsPanel pageId={page.id} />}
        {side === 'versions' && (
          <VersionsPanel
            pageId={page.id}
            canEdit={canWrite && !locked}
            onRestored={onVersionRestored}
            getCurrent={() => editorApi.current?.snapshot().blocks ?? null}
          />
        )}
        <div hidden={side !== 'comments'}>
          <CommentsPanel
            pageId={page.id}
            pageOwnerId={page.user_id}
            currentUserId={currentUserId}
            initialComments={comments}
            focusSignal={commentFocus}
            blockFilter={blockFilter}
            onClearBlockFilter={() => setBlockFilter(null)}
            onCommentsChange={setAllComments}
            labels={commentsLabels}
            pendingAnchor={pendingAnchor}
            onAnchorCancel={() => {
              if (pendingAnchor) editorApi.current?.unwrapComment(pendingAnchor.id);
              setPendingAnchor(null);
            }}
            onAnchorPosted={() => setPendingAnchor(null)}
            onThreadFocus={focusThreadText}
            focusAnchor={focusAnchor}
            refreshSignal={commentsSig}
            onThreadDeleted={(anchor) => editorApi.current?.unwrapComment(anchor)}
            canModerate={canShare}
            suggestions={suggestions}
            canResolveSuggestions={canWrite && !locked}
            onResolveSuggestion={(id, accept) => editorApi.current?.resolveSuggestion(id, accept)}
            onSuggestionFocus={focusSuggestion}
            peopleNames={people}
          />
        </div>
      </aside>
      {exportOpen && allowExport && (
        <DocsExportDialog
          pageId={page.id}
          onClose={() => setExportOpen(false)}
          onPrint={() => {
            setSide(null);
            setTimeout(() => window.print(), 50);
          }}
        />
      )}
      {templateOpen && isOwner && (
        <SaveTemplateDialog pageId={page.id} defaultTitle={current.title} onClose={() => setTemplateOpen(false)} />
      )}
      {verifyOpen && canVerify && (
        <VerifyDialog
          page={current}
          people={peopleList}
          onClose={() => setVerifyOpen(false)}
          onChanged={(fresh) => {
            setCurrent((prev) => ({
              ...prev,
              verified_at: fresh.verified_at,
              verified_until: fresh.verified_until,
              verified_by: fresh.verified_by,
              page_owner_id: fresh.page_owner_id,
            }));
            router.refresh();
          }}
        />
      )}
      {shareOpen && canShare && (
        <ShareDialog
          page={current}
          shares={localShares}
          invites={localInvites}
          helpBase={isOwner ? helpBase : null}
          feedback={feedback}
          canManageWorkspace={isOwner}
          memberRoleDefault={memberRoleDefault}
          onUpdate={updateSharing}
          onShare={handleShare}
          onRoleChange={handleRoleChange}
          onUnshare={handleUnshare}
          onRevokeInvite={handleRevokeInvite}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
