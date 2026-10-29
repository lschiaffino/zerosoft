'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { DESIGN_PRESETS, MAX_SIDE, MIN_SIDE, type DesignDoc } from '@/lib/design-model';
import { EXPORT_SCALES, exportPlan, type ExportFormat } from '@/lib/design-export';
import type { DesignShareInfo } from '@/lib/design';
import { Modal } from './ui';
import { exportDesign, pageDataUrl } from './exporter';

// ---------- Compartir ----------

interface Person {
  userId: string;
  name: string;
  email: string;
}

export function ShareDialog({ open, onClose, designId, onChanged }: { open: boolean; onClose: () => void; designId: string; onChanged: (s: DesignShareInfo) => void }) {
  const t = useTranslations('design.share');
  const locale = useLocale();
  const [share, setShare] = useState<DesignShareInfo | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState<'view' | 'edit'>('view');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShare(null);
    fetch(`/api/design/designs/${designId}/share`)
      .then((r) => (r.ok ? (r.json() as Promise<{ share: DesignShareInfo; people: Person[] }>) : Promise.reject(new Error('load'))))
      .then((d) => {
        setShare(d.share);
        setPeople(d.people);
      })
      .catch(() => setError(t('loadError')));
  }, [open, designId, t]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/design/designs/${designId}/share`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('save');
      const d = (await r.json()) as { share: DesignShareInfo };
      setShare(d.share);
      onChanged(d.share);
    } catch {
      setError(t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const url = share?.token ? `${window.location.origin}/${locale}/d/${share.token}` : '';
  const others = people.filter((p) => !share?.members.some((m) => m.userId === p.userId));

  return (
    <Modal open={open} title={t('title')} onClose={onClose} testId="design-share" foot={<button type="button" className="btn btn-secondary" onClick={onClose}>{t('done')}</button>}>
      {!share && !error && (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {share && (
        <div className="dz-share">
          {!share.canShare && <p className="muted">{t('onlyEditors')}</p>}
          <label className="ui-field">
            <span className="label">{t('workspace')}</span>
            <select
              className="select"
              value={share.workspaceAccess}
              disabled={!share.canShare || busy}
              onChange={(e) => void save({ workspaceAccess: e.target.value })}
              data-testid="design-share-workspace"
            >
              {(['none', 'view', 'edit'] as const).map((a) => (
                <option key={a} value={a}>
                  {t(`access.${a}`)}
                </option>
              ))}
            </select>
          </label>

          <div className="ui-field">
            <span className="label">{t('people')}</span>
            {share.members.length ? (
              <ul className="dz-share-people">
                {share.members.map((m) => (
                  <li key={m.userId}>
                    <span className="dz-share-name">{m.name || m.email}</span>
                    <select
                      className="select"
                      aria-label={t('roleFor', { name: m.name || m.email })}
                      value={m.role}
                      disabled={!share.canShare || busy}
                      onChange={(e) => void save({ members: share.members.map((x) => (x.userId === m.userId ? { userId: x.userId, role: e.target.value } : { userId: x.userId, role: x.role })) })}
                    >
                      <option value="view">{t('role.view')}</option>
                      <option value="edit">{t('role.edit')}</option>
                    </select>
                    {share.canShare && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void save({ members: share.members.filter((x) => x.userId !== m.userId).map((x) => ({ userId: x.userId, role: x.role })) })}
                      >
                        {t('remove')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t('noPeople')}</p>
            )}
            {share.canShare && others.length > 0 && (
              <div className="dz-share-add">
                <select className="select" aria-label={t('addPerson')} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="design-share-person">
                  <option value="">{t('addPerson')}</option>
                  {others.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                      {p.name !== p.email ? ` (${p.email})` : ''}
                    </option>
                  ))}
                </select>
                <select className="select" aria-label={t('roleLabel')} value={pickRole} onChange={(e) => setPickRole(e.target.value as 'view' | 'edit')}>
                  <option value="view">{t('role.view')}</option>
                  <option value="edit">{t('role.edit')}</option>
                </select>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!pick || busy}
                  onClick={() => {
                    void save({ members: [...share.members.map((x) => ({ userId: x.userId, role: x.role })), { userId: pick, role: pickRole }] });
                    setPick('');
                  }}
                >
                  {t('add')}
                </button>
              </div>
            )}
          </div>

          {share.canShare && (
            <div className="ui-field">
              <span className="label">{t('link')}</span>
              <label className="ui-check">
                <input type="checkbox" checked={!!share.token} disabled={busy} onChange={(e) => void save({ link: e.target.checked ? 'on' : 'off' })} data-testid="design-share-link" />
                <span>{t('linkToggle')}</span>
              </label>
              {share.token && (
                <>
                  <div className="dz-share-url">
                    <input className="input" readOnly value={url} aria-label={t('link')} onFocus={(e) => e.target.select()} data-testid="design-share-url" />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(url).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                    >
                      {copied ? t('copied') : t('copy')}
                    </button>
                  </div>
                  <p className="muted dz-share-note">{t('linkNote')}</p>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save({ link: 'reset' })}>
                    {t('reset')}
                  </button>
                </>
              )}
            </div>
          )}
          <p className="muted dz-share-note">{t('docsHint')}</p>
        </div>
      )}
    </Modal>
  );
}

// ---------- Descargar ----------

export function ExportDialog({ open, onClose, doc, name, pageIndex }: { open: boolean; onClose: () => void; doc: DesignDoc; name: string; pageIndex: number }) {
  const t = useTranslations('design.export');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [which, setWhich] = useState<'current' | 'all'>('current');
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boards, setBoards] = useState<Array<{ id: string; name: string }> | null>(null);
  const [boardsAvailable, setBoardsAvailable] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setError(null);
    setSent(null);
    fetch('/api/design/board')
      .then((r) => (r.ok ? (r.json() as Promise<{ boards: Array<{ id: string; name: string }>; available: boolean }>) : null))
      .then((d) => {
        setBoards(d?.boards ?? []);
        setBoardsAvailable(Boolean(d?.available));
      })
      .catch(() => setBoards([]));
  }, [open]);

  const plan = exportPlan(doc, { format, which, current: pageIndex, scale, transparent });

  const run = async () => {
    setBusy(true);
    setError(null);
    setStatus(t('exporting'));
    try {
      const files = await exportDesign(doc, name, { format, pages: plan.pages, scale: plan.scale, transparent: plan.transparent });
      setStatus(t('done', { files: files.join(', ') }));
    } catch {
      setStatus(null);
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  };

  const sendToBoard = async () => {
    if (!boardId) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const img = await pageDataUrl(doc, pageIndex);
      const r = await fetch('/api/design/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ boardId, ...img }) });
      if (!r.ok) throw new Error('send');
      const d = (await r.json()) as { href: string };
      setSent(d.href);
    } catch {
      setError(t('boardError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('title')}
      onClose={onClose}
      testId="design-export"
      foot={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('close')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy} data-testid="design-export-download">
            {t('download')}
          </button>
        </>
      }
    >
      <div className="dz-export">
        <fieldset className="dz-fieldset">
          <legend className="label">{t('format')}</legend>
          <div className="dz-seg">
            {(['png', 'jpg', 'pdf'] as const).map((f) => (
              <label key={f} className={`dz-seg-opt${format === f ? ' is-on' : ''}`}>
                <input type="radio" name="dz-format" value={f} checked={format === f} onChange={() => setFormat(f)} />
                {t(`formats.${f}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {format === 'png' && (
          <label className="ui-check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} data-testid="design-export-transparent" />
            <span>{t('transparent')}</span>
          </label>
        )}
        <label className="ui-field">
          <span className="label">{t('pages')}</span>
          <select className="select" value={which} onChange={(e) => setWhich(e.target.value as 'current' | 'all')}>
            <option value="current">{t('current', { n: pageIndex + 1 })}</option>
            <option value="all">{t('all', { n: doc.pages.length })}</option>
          </select>
        </label>
        <label className="ui-field">
          <span className="label">{t('size')}</span>
          <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {EXPORT_SCALES.map((s) => (
              <option key={s} value={s}>
                {s}× ({Math.round(doc.width * s)} × {Math.round(doc.height * s)} px)
              </option>
            ))}
          </select>
        </label>
        {format === 'pdf' && <p className="muted dz-share-note">{t('pdfNote')}</p>}
        {format !== 'pdf' && which === 'all' && doc.pages.length > 1 && <p className="muted dz-share-note">{t('multiNote')}</p>}
        {status && (
          <p className="muted" role="status" data-testid="design-export-status">
            {status}
          </p>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {boardsAvailable && (
          <div className="ui-field dz-export-board">
            <span className="label">{t('board')}</span>
            {boards && boards.length ? (
              <div className="dz-share-add">
                <select className="select" aria-label={t('boardPick')} value={boardId} onChange={(e) => setBoardId(e.target.value)}>
                  <option value="">{t('boardPick')}</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!boardId || busy} onClick={() => void sendToBoard()}>
                  {t('boardSend')}
                </button>
              </div>
            ) : (
              <p className="muted">{t('boardNone')}</p>
            )}
            {sent && (
              <p role="status">
                {t('boardSent')}{' '}
                <Link href={sent}>{t('boardOpen')}</Link>
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Magic write ----------

export type MagicAction = 'write' | 'rewrite' | 'shorter' | 'longer' | 'formal' | 'casual';

export function MagicDialog({ open, onClose, sourceText, onResult }: { open: boolean; onClose: () => void; sourceText: string | null; onResult: (text: string) => void }) {
  const t = useTranslations('design.ai');
  const locale = useLocale();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
    }
  }, [open]);
  const run = async (action: MagicAction) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/design/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, text: sourceText ?? '', prompt, locale }),
      });
      const d = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!r.ok || !d.text) throw new Error(d.error ?? 'ai');
      setResult(d.text);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'ai_disabled' ? t('disabled') : code === 'quota_exceeded' || code === 'rate_limited' ? t('quota') : t('error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={t('title')}
      onClose={onClose}
      testId="design-magic-dialog"
      foot={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('cancel')}
          </button>
          {result && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onResult(result);
                onClose();
              }}
            >
              {sourceText ? t('replace') : t('insert')}
            </button>
          )}
        </>
      }
    >
      <div className="dz-magic">
        {sourceText === null ? (
          <>
            <label className="ui-field">
              <span className="label">{t('prompt')}</span>
              <textarea className="textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholder')} maxLength={1000} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !prompt.trim()} onClick={() => void run('write')}>
              {busy ? t('working') : t('write')}
            </button>
          </>
        ) : (
          <div className="dz-magic-actions">
            {(['rewrite', 'shorter', 'longer', 'formal', 'casual'] as const).map((a) => (
              <button key={a} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run(a)}>
                {t(a)}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <p className="muted" role="status">
            {t('working')}
          </p>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <blockquote className="dz-magic-result" data-testid="design-magic-result">
            {result}
          </blockquote>
        )}
        <p className="muted dz-share-note">{t('note')}</p>
      </div>
    </Modal>
  );
}

// ---------- Cambiar tamaño ----------

export function ResizeDialog({ open, onClose, doc, onApply }: { open: boolean; onClose: () => void; doc: DesignDoc; onApply: (w: number, h: number, copy: boolean) => void }) {
  const t = useTranslations('design.resize');
  const tp = useTranslations('design.presets');
  const [w, setW] = useState(String(doc.width));
  const [h, setH] = useState(String(doc.height));
  useEffect(() => {
    if (open) {
      setW(String(doc.width));
      setH(String(doc.height));
    }
  }, [open, doc.width, doc.height]);
  const wn = Number(w);
  const hn = Number(h);
  const valid = wn >= MIN_SIDE && wn <= MAX_SIDE && hn >= MIN_SIDE && hn <= MAX_SIDE;
  return (
    <Modal
      open={open}
      title={t('title')}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!valid} onClick={() => onApply(wn, hn, true)}>
            {t('copy')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onApply(wn, hn, false)}>
            {t('apply')}
          </button>
        </>
      }
    >
      <div className="dz-resize">
        <div className="dz-presets-mini">
          {DESIGN_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`btn btn-ghost btn-sm${wn === p.w && hn === p.h ? ' is-on' : ''}`}
              onClick={() => {
                setW(String(p.w));
                setH(String(p.h));
              }}
            >
              {tp(`${p.key}.name`)}
            </button>
          ))}
        </div>
        <div className="dz-wh">
          <label className="ui-field">
            <span className="label">{t('width')}</span>
            <input className="input" type="number" min={MIN_SIDE} max={MAX_SIDE} value={w} onChange={(e) => setW(e.target.value)} />
          </label>
          <label className="ui-field">
            <span className="label">{t('height')}</span>
            <input className="input" type="number" min={MIN_SIDE} max={MAX_SIDE} value={h} onChange={(e) => setH(e.target.value)} />
          </label>
        </div>
        {!valid && <p className="ui-error">{t('invalid', { min: MIN_SIDE, max: MAX_SIDE })}</p>}
        <p className="muted dz-share-note">{t('note')}</p>
      </div>
    </Modal>
  );
}

// ---------- Atajos ----------

const SHORTCUTS: Array<[string, string]> = [
  ['⌘/Ctrl Z', 'undo'],
  ['⌘/Ctrl ⇧ Z', 'redo'],
  ['⌘/Ctrl C · X · V', 'clipboard'],
  ['⌘/Ctrl D', 'duplicate'],
  ['⌘/Ctrl A', 'selectAll'],
  ['⌘/Ctrl G · ⇧G', 'group'],
  ['⌘/Ctrl ] · [', 'order'],
  ['⌘/Ctrl ⇧ L', 'lock'],
  ['← ↑ → ↓ (⇧)', 'nudge'],
  ['Delete', 'delete'],
  ['Enter', 'edit'],
  ['Esc', 'escape'],
  ['Tab', 'next'],
  ['T · R · C · L', 'add'],
  ['⌘/Ctrl + · − · 0', 'zoom'],
  ['Space + drag', 'pan'],
  ['Alt (drag)', 'nosnap'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('design.shortcuts');
  return (
    <Modal open={open} title={t('title')} onClose={onClose} foot={<button type="button" className="btn btn-secondary" onClick={onClose}>{t('close')}</button>}>
      <dl className="dz-shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={v}>
            <dt>
              <kbd className="kbd">{k}</kbd>
            </dt>
            <dd>{t(v)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
