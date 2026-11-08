'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { SHORTCUTS, type FolderDto, type InboxAccountDto, type SnippetDto } from '@/lib/inbox/types';
import { api, longWhen, notifyInboxChanged } from './api';
import { FolderDialog, Modal } from './InboxDialogs';
import type { InboxStateDto } from './InboxApp';

interface ConnectState {
  status: 'pending' | 'qr' | 'connected' | 'disconnected' | 'error';
  qr?: string;
  phone?: string;
}

/**
 * Vincular WhatsApp con QR: al abrirse pide la sesión, muestra el QR y lo
 * renueva cada 2 s hasta que el teléfono lo escanea. Lo usan la tarjeta de
 * Ajustes y el estado vacío de la bandeja.
 */
export function WhatsappQrDialog({ open, onClose, onLinked }: { open: boolean; onClose: () => void; onLinked: () => void }) {
  const t = useTranslations('inbox.settings.whatsapp');
  const te = useTranslations('inbox.errors');
  const [state, setState] = useState<ConnectState | null>(null);
  const [err, setErr] = useState('');

  const start = useCallback(async () => {
    setErr('');
    setState(null);
    const r = await api<{ state: ConnectState }>('/api/inbox/whatsapp', { method: 'POST' });
    if (!r.ok) {
      setErr(te.has(r.data.error ?? '') ? te(r.data.error as string) : te('generic'));
      return;
    }
    setState(r.data.state);
  }, [te]);

  // Una sesión por apertura (el doble efecto de StrictMode no pide dos QR).
  const started = useRef(false);
  useEffect(() => {
    if (!open) {
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    void start();
  }, [open, start]);

  // Mientras espera el escaneo, pide el estado (y el QR nuevo) cada 2 s.
  useEffect(() => {
    if (!open || !state || state.status === 'connected' || state.status === 'error') return;
    const id = window.setInterval(async () => {
      const r = await api<{ state: ConnectState }>('/api/inbox/whatsapp');
      if (r.ok) setState(r.data.state);
    }, 2000);
    return () => window.clearInterval(id);
  }, [open, state]);

  useEffect(() => {
    if (state?.status === 'connected') onLinked();
  }, [state?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} title={t('qrTitle')} onClose={onClose}>
      <div className="ui-modal-body" aria-live="polite">
        {err ? (
          <p className="ui-error" role="alert">
            {err}
          </p>
        ) : !state ? (
          <p className="ib-help">{t('starting')}</p>
        ) : state.status === 'connected' ? (
          <p className="ib-ok" role="status">
            {t('linked', { phone: state.phone ? `+${state.phone}` : '' })}
          </p>
        ) : state.qr ? (
          <div className="ib-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qr} alt={t('qrAlt')} width={220} height={220} />
            <ol className="ib-steps">
              <li>{t('qr1')}</li>
              <li>{t('qr2')}</li>
              <li>{t('qr3')}</li>
            </ol>
            <p className="ib-help">{t('qrRefresh')}</p>
          </div>
        ) : (
          <div>
            <p className="ib-help">{t('waiting')}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void start()}>
              {t('retry')}
            </button>
          </div>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
          {state?.status === 'connected' ? t('done') : t('close')}
        </button>
      </div>
    </Modal>
  );
}

function WhatsappCard({ account, available, onChange }: { account: InboxAccountDto | undefined; available: boolean; onChange: () => void }) {
  const t = useTranslations('inbox.settings.whatsapp');
  const te = useTranslations('inbox.errors');
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<'' | 'unlink' | 'remove'>('');

  const unlink = async () => {
    setConfirm('');
    const r = await api('/api/inbox/whatsapp', { method: 'DELETE' });
    if (!r.ok) setErr(te('generic'));
    onChange();
  };
  const remove = async () => {
    setConfirm('');
    if (!account) return;
    const r = await api(`/api/inbox/accounts?id=${encodeURIComponent(account.id)}`, { method: 'DELETE' });
    if (!r.ok) setErr(te('generic'));
    onChange();
    notifyInboxChanged();
  };

  const connected = account?.status === 'connected';
  return (
    <div className="ib-card" data-testid="inbox-wa-card">
      <div className="ib-card-head">
        <div>
          <h3 className="ib-h3">WhatsApp</h3>
          <p className="ib-help">
            {connected ? t('connectedAs', { phone: account?.address ? `+${account.address}` : '' }) : account ? t('notConnected') : t('intro')}
            {connected && account?.backfilling ? ` · ${t('backfilling')}` : ''}
          </p>
        </div>
        <span className={`badge ${connected ? 'badge-ok' : 'badge-warn'}`}>{connected ? t('statusOn') : t('statusOff')}</span>
      </div>
      {!available ? (
        <p className="ib-help">{t('unavailable')}</p>
      ) : (
        <div className="ib-row">
          {!connected && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setLinking(true)}>
              {t('connect')}
            </button>
          )}
          {connected && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm('unlink')}>
              {t('unlink')}
            </button>
          )}
          {account && (
            <button type="button" className="btn btn-ghost btn-sm ib-danger" onClick={() => setConfirm('remove')}>
              {t('remove')}
            </button>
          )}
        </div>
      )}
      {err && (
        <p className="ui-error" role="alert">
          {err}
        </p>
      )}
      <p className="ib-help">{t('privacy')}</p>
      <WhatsappQrDialog open={linking} onClose={() => setLinking(false)} onLinked={onChange} />
      <Modal open={!!confirm} title={confirm === 'remove' ? t('removeTitle') : t('unlinkTitle')} onClose={() => setConfirm('')}>
        <div className="ui-modal-body">
          <p>{confirm === 'remove' ? t('removeBody') : t('unlinkBody')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setConfirm('')}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void (confirm === 'remove' ? remove() : unlink())}>
            {confirm === 'remove' ? t('removeYes') : t('unlinkYes')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function GmailCard({ accounts, available, onChange }: { accounts: InboxAccountDto[]; available: boolean; onChange: () => void }) {
  const t = useTranslations('inbox.settings.gmail');
  const te = useTranslations('inbox.errors');
  const locale = useLocale();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const sync = async (id: string) => {
    setBusy(id);
    setErr('');
    const r = await api('/api/inbox/gmail', { method: 'POST', json: { accountId: id } });
    setBusy('');
    if (!r.ok) setErr(te.has(r.data.error ?? '') ? te(r.data.error as string) : te('generic'));
    onChange();
    notifyInboxChanged();
  };
  const remove = async () => {
    const id = removeId;
    setRemoveId(null);
    if (!id) return;
    const r = await api(`/api/inbox/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) setErr(te('generic'));
    onChange();
    notifyInboxChanged();
  };
  return (
    <div className="ib-card" data-testid="inbox-gmail-card">
      <div className="ib-card-head">
        <div>
          <h3 className="ib-h3">Gmail</h3>
          <p className="ib-help">{t('intro')}</p>
        </div>
      </div>
      {accounts.length > 0 && (
        <ul className="ib-accounts">
          {accounts.map((a) => (
            <li key={a.id} className="ib-account">
              <span className="ib-account-main">
                <strong>{a.address}</strong>
                <span className="ib-help">
                  {a.status === 'connected' ? (a.lastSyncAt ? t('synced', { when: longWhen(a.lastSyncAt, locale) }) : t('syncPending')) : te.has(a.error) ? te(a.error) : t('reconnect')}
                </span>
              </span>
              <span className="ib-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void sync(a.id)} disabled={busy === a.id || a.status !== 'connected'}>
                  {busy === a.id ? t('syncing') : t('sync')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm ib-danger" onClick={() => setRemoveId(a.id)}>
                  {t('remove')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {available ? (
        <div className="ib-row">
          {/* Redirección de OAuth (ruta de API): navegación completa, no del router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn btn-primary btn-sm" href="/api/inbox/gmail">
            {accounts.length ? t('connectAnother') : t('connect')}
          </a>
        </div>
      ) : (
        <p className="ib-help">{t('unavailable')}</p>
      )}
      {err && (
        <p className="ui-error" role="alert">
          {err}
        </p>
      )}
      <Modal open={!!removeId} title={t('removeTitle')} onClose={() => setRemoveId(null)}>
        <div className="ui-modal-body">
          <p>{t('removeBody')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setRemoveId(null)}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()}>
            {t('removeYes')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function SnippetsSection({ snippets, onChange }: { snippets: SnippetDto[]; onChange: () => void }) {
  const t = useTranslations('inbox.settings.snippets');
  const te = useTranslations('inbox.errors');
  const [edit, setEdit] = useState<SnippetDto | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [delId, setDelId] = useState<string | null>(null);
  useEffect(() => {
    if (!edit) return;
    setTitle(edit === 'new' ? '' : edit.title);
    setShortcut(edit === 'new' ? '' : edit.shortcut);
    setBody(edit === 'new' ? '' : edit.body);
    setErr('');
  }, [edit]);
  const save = async () => {
    const json = { title: title.trim(), shortcut, body };
    const r = edit === 'new' || !edit ? await api('/api/inbox/snippets', { method: 'POST', json }) : await api(`/api/inbox/snippets/${edit.id}`, { method: 'PATCH', json });
    if (!r.ok) {
      setErr(te.has(r.data.error ?? '') ? te(r.data.error as string) : te('generic'));
      return;
    }
    setEdit(null);
    onChange();
  };
  const del = async () => {
    const id = delId;
    setDelId(null);
    if (!id) return;
    await api(`/api/inbox/snippets/${id}`, { method: 'DELETE' });
    onChange();
  };
  return (
    <section className="ib-section" id="snippets" aria-labelledby="ib-snippets-h">
      <div className="ib-section-head">
        <h2 className="ib-h2" id="ib-snippets-h">
          {t('title')}
        </h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit('new')}>
          {t('new')}
        </button>
      </div>
      <p className="ib-help">{t('help')}</p>
      {snippets.length === 0 ? (
        <p className="ib-empty-line">{t('empty')}</p>
      ) : (
        <ul className="ib-snippet-list">
          {snippets.map((s) => (
            <li key={s.id} className="ib-snippet-row">
              <span className="ib-snippet-main">
                <strong>{s.title}</strong>
                {s.shortcut && <span className="kbd">;{s.shortcut}</span>}
                <span className="ib-snippet-body">{s.body}</span>
              </span>
              <span className="ib-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(s)}>
                  {t('edit')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm ib-danger" onClick={() => setDelId(s.id)} aria-label={t('deleteNamed', { name: s.title })}>
                  {t('delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} title={edit === 'new' ? t('newTitle') : t('editTitle')} onClose={() => setEdit(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="ui-modal-body ib-form">
            <div className="ui-field">
              <label className="label" htmlFor="ib-sn-title">
                {t('name')}
              </label>
              <input id="ib-sn-title" className="input" required autoFocus maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ib-sn-key">
                {t('shortcut')}
              </label>
              <input id="ib-sn-key" className="input" maxLength={24} value={shortcut} placeholder="gracias" onChange={(e) => setShortcut(e.target.value)} />
              <p className="ui-help">{t('shortcutHelp')}</p>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ib-sn-body">
                {t('body')}
              </label>
              <textarea id="ib-sn-body" className="textarea" required rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="ui-help">{t('variables')}</p>
            </div>
            {err && (
              <p className="ui-error" role="alert">
                {err}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim() || !body.trim()}>
              {t('save')}
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={!!delId} title={t('deleteTitle')} onClose={() => setDelId(null)}>
        <div className="ui-modal-body">
          <p>{t('deleteBody')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setDelId(null)}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void del()}>
            {t('delete')}
          </button>
        </div>
      </Modal>
    </section>
  );
}

function FoldersSection({ folders, onChange }: { folders: FolderDto[]; onChange: () => void }) {
  const t = useTranslations('inbox.folders');
  const [edit, setEdit] = useState<FolderDto | 'new' | null>(null);
  return (
    <section className="ib-section" id="folders" aria-labelledby="ib-folders-h">
      <div className="ib-section-head">
        <h2 className="ib-h2" id="ib-folders-h">
          {t('title')}
        </h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit('new')}>
          {t('new')}
        </button>
      </div>
      <p className="ib-help">{t('settingsHelp')}</p>
      {folders.length === 0 ? (
        <p className="ib-empty-line">{t('branchEmpty')}</p>
      ) : (
        <ul className="ib-snippet-list">
          {folders.map((f) => (
            <li key={f.id} className="ib-snippet-row">
              <span className="ib-snippet-main">
                <span className="ib-swatch" style={{ background: f.color || 'var(--c-inbox)' }} aria-hidden />
                <Link href={`/app/inbox/f/${f.id}`}>{f.name}</Link>
                {f.rule && <span className="ib-dim">{t('hasRule')}</span>}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(f)}>
                {t('edit')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <FolderDialog
        open={!!edit}
        folder={edit === 'new' ? null : edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          onChange();
          notifyInboxChanged();
        }}
      />
    </section>
  );
}

interface ExportFile {
  format: string;
  version: number;
  folders?: unknown[];
  chatFolders?: unknown[];
  chats?: unknown[];
  scheduled?: unknown[];
  drafts?: unknown[];
  snoozes?: unknown[];
  notes?: unknown[];
  messages?: unknown[];
}

const CHUNK = 500;

function ImportSection({ onDone }: { onDone: () => void }) {
  const t = useTranslations('inbox.settings.import');
  const te = useTranslations('inbox.errors');
  const [file, setFile] = useState<ExportFile | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    setErr('');
    setResult(null);
    setFile(null);
    if (!f) return;
    setName(f.name);
    try {
      const data = JSON.parse(await f.text()) as ExportFile;
      if (data?.format !== 'inbox-zero-export' || data.version !== 1) throw new Error('format');
      setFile(data);
    } catch {
      setErr(te('invalid_file'));
    }
  };

  const run = async () => {
    if (!file) return;
    setErr('');
    const messages = Array.isArray(file.messages) ? file.messages : [];
    const total = 1 + Math.ceil(messages.length / CHUNK);
    setProgress({ done: 0, total });
    const sum: Record<string, number> = {};
    const add = (r: Record<string, number>) => {
      for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
    };
    const meta = await api<{ result: Record<string, number> }>('/api/inbox/import', {
      method: 'POST',
      json: { part: 'meta', format: file.format, version: file.version, folders: file.folders ?? [], chatFolders: file.chatFolders ?? [], chats: file.chats ?? [], scheduled: file.scheduled ?? [], drafts: file.drafts ?? [], snoozes: file.snoozes ?? [], notes: file.notes ?? [] },
    });
    if (!meta.ok) {
      setErr(te.has(meta.data.error ?? '') ? te(meta.data.error as string) : te('generic'));
      setProgress(null);
      return;
    }
    add(meta.data.result);
    for (let i = 0; i < messages.length; i += CHUNK) {
      setProgress({ done: 1 + i / CHUNK, total });
      const r = await api<{ result: Record<string, number> }>('/api/inbox/import', { method: 'POST', json: { part: 'messages', messages: messages.slice(i, i + CHUNK) } });
      if (!r.ok) {
        setErr(t('partial', { done: Math.floor(i / CHUNK), total: total - 1 }));
        setProgress(null);
        setResult(sum);
        onDone();
        return;
      }
      add(r.data.result);
    }
    setProgress(null);
    setResult(sum);
    setFile(null);
    if (input.current) input.current.value = '';
    onDone();
    notifyInboxChanged();
  };

  const count = (k: keyof ExportFile) => (Array.isArray(file?.[k]) ? (file?.[k] as unknown[]).length : 0);
  return (
    <section className="ib-section" id="import" aria-labelledby="ib-import-h">
      <h2 className="ib-h2" id="ib-import-h">
        {t('title')}
      </h2>
      <p className="ib-help">{t('help')}</p>
      <ol className="ib-steps">
        <li>{t('step1')}</li>
        <li>
          {t('step2')}
          <pre className="ib-code">node scripts/inbox-zero-export.mjs ~/inbox-zero --out inbox-zero-export.json</pre>
        </li>
        <li>{t('step3')}</li>
      </ol>
      <div className="ui-field">
        <label className="label" htmlFor="ib-import-file">
          {t('file')}
        </label>
        <input id="ib-import-file" ref={input} type="file" accept="application/json,.json" className="input" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {file && (
        <div className="ib-import-summary" role="status">
          <p>
            <strong>{name}</strong>
          </p>
          <p className="ib-help">
            {t('summary', { folders: count('folders'), chats: count('chats'), scheduled: count('scheduled'), drafts: count('drafts'), snoozes: count('snoozes'), notes: count('notes'), messages: count('messages') })}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void run()} disabled={!!progress}>
            {t('run')}
          </button>
        </div>
      )}
      {progress && (
        <p className="ib-help" role="status" aria-live="polite">
          {t('progress', { done: progress.done, total: progress.total })}
        </p>
      )}
      {result && (
        <p className="ib-ok" role="status">
          {t('result', { folders: result.folders ?? 0, chats: result.chats ?? 0, scheduled: result.scheduled ?? 0, drafts: result.drafts ?? 0, snoozes: result.snoozes ?? 0, notes: result.notes ?? 0, messages: result.messages ?? 0 })}
        </p>
      )}
      {err && (
        <p className="ui-error" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}

/** Ajustes de Inbox: cuentas, carpetas, snippets, importar y atajos. */
export default function InboxSettings({ initial, gmailResult }: { initial: InboxStateDto; gmailResult: string | null }) {
  const t = useTranslations('inbox.settings');
  const th = useTranslations('inbox.help');
  const router = useRouter();
  const [state, setState] = useState(initial);
  const reload = useCallback(async () => {
    const r = await api<InboxStateDto>('/api/inbox/state');
    if (r.ok) setState(r.data);
  }, []);
  const wa = state.accounts.find((a) => a.kind === 'whatsapp');
  const gmail = state.accounts.filter((a) => a.kind === 'gmail');
  return (
    <div className="app-page ui-page ib-settings">
      <div className="ui-page-header">
        <div className="ui-page-header-text">
          <h1 className="ui-page-title">{t('title')}</h1>
          <p className="ui-page-subtitle">{t('subtitle')}</p>
        </div>
      </div>
      {gmailResult && (
        <p className={gmailResult === 'connected' ? 'ib-ok' : 'ui-error'} role="status">
          {t(`gmailResult.${['connected', 'denied', 'scope', 'unavailable'].includes(gmailResult) ? gmailResult : 'error'}`)}
          <button type="button" className="ib-link-btn" onClick={() => router.replace('/app/inbox/settings')}>
            {t('dismiss')}
          </button>
        </p>
      )}
      <section className="ib-section" id="accounts" aria-labelledby="ib-accounts-h">
        <h2 className="ib-h2" id="ib-accounts-h">
          {t('accounts')}
        </h2>
        <div className="ib-cards">
          <WhatsappCard account={wa} available={state.available.whatsapp} onChange={() => void reload()} />
          <GmailCard accounts={gmail} available={state.available.gmail} onChange={() => void reload()} />
        </div>
      </section>
      <FoldersSection folders={state.folders} onChange={() => void reload()} />
      <SnippetsSection snippets={state.snippets} onChange={() => void reload()} />
      <ImportSection onDone={() => void reload()} />
      <section className="ib-section" id="shortcuts" aria-labelledby="ib-keys-h">
        <h2 className="ib-h2" id="ib-keys-h">
          {th('title')}
        </h2>
        <dl className="ib-keys">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="ib-key-row">
              <dt>
                <span className="kbd">{s.keys}</span>
              </dt>
              <dd>{th(`keys.${s.id}`)}</dd>
            </div>
          ))}
        </dl>
        <p className="ib-help">
          <Link href="/app/voice/settings">{th('dictation')}</Link>
        </p>
      </section>
    </div>
  );
}
