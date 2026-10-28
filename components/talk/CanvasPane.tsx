'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import DocsEditor from '@/components/docs/DocsEditor';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DocsBlock, DocsPage } from '@/lib/docs-types';
import type { TalkChannelDto } from '@/lib/talk';
import type { TalkCanvasDto } from '@/lib/talk-canvas';
import { errorText } from './Composer';
import { fmtFull } from './Message';
import { TalkApiError, useTalk } from './talk-context';

const SAVE_MS = 800;

/**
 * Canvas del canal: el editor de bloques de Docs (modo embebido, como Notes).
 * Guarda solo con compare-and-set por rev; si otra persona guardó en el medio
 * se recarga su versión. Los cambios de otros llegan por el feed.
 */
export default function CanvasPane({ channel }: { channel: TalkChannelDto }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { api, subscribe, toast, boot, locale } = ctx;
  const [canvas, setCanvas] = useState<TalkCanvasDto | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [version, setVersion] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rev = useRef(0);
  const pending = useRef<{ title?: string; content?: DocsBlock[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (remount = true) => {
      try {
        const res = await api<{ canvas: TalkCanvasDto | null }>(`/api/talk/canvas?channelId=${encodeURIComponent(channel.id)}`);
        setCanvas(res.canvas);
        rev.current = res.canvas?.rev ?? 0;
        if (remount) setVersion((v) => v + 1);
        setState('ready');
      } catch {
        setState('error');
      }
    },
    [api, channel.id],
  );

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  const flush = useCallback(async () => {
    if (inFlight.current || !pending.current) return;
    const patch = pending.current;
    pending.current = null;
    inFlight.current = true;
    setSaving('saving');
    try {
      const res = await api<{ canvas: TalkCanvasDto }>('/api/talk/canvas', { method: 'PUT', json: { channelId: channel.id, ...patch, baseRev: rev.current } });
      rev.current = res.canvas.rev;
      setCanvas((c) => (c ? { ...c, rev: res.canvas.rev, title: res.canvas.title, updatedAt: res.canvas.updatedAt, updatedBy: res.canvas.updatedBy } : res.canvas));
      setSaving('saved');
    } catch (err) {
      if (err instanceof TalkApiError && err.code === 'canvas_conflict') {
        toast(t('canvas.conflict'), 'error');
        pending.current = null;
        await load();
        setSaving('idle');
      } else {
        // Se reintenta con lo último que quedó pendiente.
        pending.current = { ...patch, ...(pending.current ?? {}) };
        setSaving('error');
        toast(errorText(t, err), 'error');
      }
    } finally {
      inFlight.current = false;
      if (pending.current && timer.current === null) timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, SAVE_MS);
    }
  }, [api, channel.id, load, t, toast]);

  const onSave = useCallback(
    (p: Partial<DocsPage>) => {
      pending.current = { ...(pending.current ?? {}), ...(p.title !== undefined ? { title: p.title } : {}), ...(p.content ? { content: p.content } : {}) };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, SAVE_MS);
    },
    [flush],
  );

  // Cambios de otras personas: si no tengo nada pendiente, recargo su versión.
  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type !== 'events') return;
        const mine = ev.events.filter((e) => e.kind === 'canvas' && e.channelId === channel.id && e.actorId !== boot.me);
        if (!mine.length) return;
        const latest = Math.max(...mine.map((e) => Number((e.payload as { rev?: number }).rev ?? 0)));
        if (latest && latest <= rev.current) return;
        if (!pending.current && !inFlight.current) void load();
      }),
    [subscribe, channel.id, boot.me, load],
  );

  // Al salir de la pestaña: lo pendiente se guarda ya.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void flush();
    },
    [flush],
  );

  const page = useMemo<DocsPage | null>(
    () =>
      canvas
        ? { id: canvas.id, user_id: '', parent_id: null, title: canvas.title, icon: null, cover_url: null, content: canvas.content, is_public: false, archived: false, created_at: canvas.createdAt, updated_at: canvas.updatedAt }
        : null,
    // El editor maneja su estado mientras se escribe: solo se rehace al recargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas?.id, version],
  );

  async function create() {
    try {
      const res = await api<{ canvas: TalkCanvasDto }>('/api/talk/canvas', {
        method: 'PUT',
        json: { channelId: channel.id, title: channel.kind === 'public' || channel.kind === 'private' ? channel.name : '', baseRev: 0 },
      });
      setCanvas(res.canvas);
      rev.current = res.canvas.rev;
      setVersion((v) => v + 1);
    } catch (err) {
      if (err instanceof TalkApiError && err.code === 'canvas_conflict') await load();
      else toast(errorText(t, err), 'error');
    }
  }

  async function remove() {
    setConfirmDelete(false);
    try {
      await api(`/api/talk/canvas?channelId=${encodeURIComponent(channel.id)}`, { method: 'DELETE' });
      setCanvas(null);
      rev.current = 0;
      toast(t('canvas.deleted'));
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  }

  const canWrite = channel.isMember && !channel.archived;

  if (state === 'loading')
    return (
      <div className="ui-loading-stack talk-loading" aria-busy="true" aria-label={t('common.loading')}>
        <div className="ui-skeleton ui-skeleton-row" />
        <div className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  if (state === 'error')
    return (
      <div className="talk-error" role="alert">
        <p>{t('canvas.loadError')}</p>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!canvas || !page)
    return (
      <div className="ui-empty talk-empty">
        <p className="ui-empty-title">{t('canvas.emptyTitle')}</p>
        <p className="ui-empty-body">{t('canvas.emptyBody')}</p>
        {canWrite && (
          <div className="ui-empty-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void create()} data-testid="talk-canvas-create">
              {t('canvas.create')}
            </button>
          </div>
        )}
      </div>
    );

  return (
    <div className="talk-canvas" data-testid="talk-canvas">
      <div className="talk-canvas-bar">
        <span className="talk-muted" aria-live="polite">
          {saving === 'saving'
            ? t('canvas.saving')
            : saving === 'error'
              ? t('canvas.saveFailed')
              : canvas.updatedBy
                ? t('canvas.editedBy', { name: ctx.personName(canvas.updatedBy), when: fmtFull(canvas.updatedAt, locale) })
                : ''}
        </span>
        {canvas.canDelete && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
            {t('canvas.delete')}
          </button>
        )}
      </div>
      <div className="talk-canvas-body">
        <DocsEditor
          key={`${canvas.id}:${version}`}
          page={page}
          ancestors={[]}
          onSave={onSave}
          embedded
          allowDatabase={false}
          mode={canWrite && canvas.canEdit ? 'edit' : 'readonly'}
          titlePlaceholder={t('canvas.untitled')}
        />
      </div>
      {confirmDelete && (
        <ConfirmDialog
          open
          title={t('canvas.deleteTitle')}
          body={t('canvas.deleteBody')}
          confirmLabel={t('canvas.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
