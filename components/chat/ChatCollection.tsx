'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import ChatIcon from './icons';

export interface CollectionField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  help?: string;
}

export interface CollectionItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CollectionProps<T extends CollectionItem> {
  /** Clave de mensajes dentro de `chat`: add, empty, emptySub, newTitle, editTitle, create, deleteTitle, deleteBody, adminOnly. */
  ns: string;
  api: string;
  /** La respuesta GET trae { [listKey]: T[] }. */
  listKey: string;
  canManage: boolean;
  fields: CollectionField[];
  columns: Array<{ label: string; render: (item: T) => ReactNode }>;
  /** Valores del formulario para un item existente. */
  toForm?: (item: T) => Record<string, string>;
  defaults?: Record<string, string>;
  /** Acciones extra por fila (recibe recargar). */
  rowActions?: (item: T, reload: () => Promise<void>) => ReactNode;
  /** Se abre en lugar del formulario de edición al tocar el nombre. */
  nameHref?: (item: T) => ReactNode;
  /** Bloquea la edición de un item (p. ej. campaña ya enviada). */
  locked?: (item: T) => boolean;
  /** Avisa el item recién guardado (para abrirlo). */
  onSaved?: (item: T) => void;
}

/**
 * Lista de cosas que crea una persona en Chat (empresas, reportes, campañas):
 * tabla, crear, editar, renombrar y borrar con modal, estados de carga, vacío y
 * error, tecla C y ?open=<id> desde Cmd+K.
 */
export default function ChatCollection<T extends CollectionItem>(p: CollectionProps<T>) {
  const t = useTranslations('chat');
  const params = useSearchParams();
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<T | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(p.api);
      if (!res.ok) throw new Error('load_failed');
      setItems(((await res.json()) as Record<string, T[]>)[p.listKey]);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, [p.api, p.listKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setFormError(null);
    setForm({ ...(p.defaults ?? {}) });
    setEditing('new');
  }

  function startEdit(item: T) {
    setFormError(null);
    setForm(p.toForm ? p.toForm(item) : Object.fromEntries(p.fields.map((f) => [f.id, String(item[f.id] ?? '')])));
    setEditing(item.id);
  }

  useEffect(() => {
    const id = params.get('open');
    const item = id ? items.find((x) => x.id === id) : null;
    if (item && p.canManage && !p.locked?.(item)) startEdit(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, items.length]);

  useKeyShortcut('c', () => startCreate(), p.canManage && editing === null);

  const invalid = p.fields.some((f) => f.required && !(form[f.id] ?? '').trim());

  async function save() {
    if (invalid || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? p.api : `${p.api}/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(data.error === 'forbidden' ? t(`${p.ns}.adminOnly`) : t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
        return;
      }
      const saved = (await res.json().catch(() => null)) as T | null;
      setEditing(null);
      await load();
      if (saved) p.onSaved?.(saved);
    } catch {
      setFormError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: T) {
    setBusy(true);
    try {
      const res = await fetch(`${p.api}/${item.id}`, { method: 'DELETE' });
      if (res.ok) setItems((prev) => prev.filter((x) => x.id !== item.id));
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  const createButton = p.canManage ? (
    <button type="button" className="btn btn-primary" onClick={startCreate} aria-keyshortcuts="c">
      {t(`${p.ns}.add`)}
    </button>
  ) : undefined;

  return (
    <section className="chat-pane" aria-label={t(`${p.ns}.listLabel`)}>
      {items.length > 0 && p.canManage && (
        <div className="chat-pane-head">
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate} aria-keyshortcuts="c">
            {t(`${p.ns}.add`)}
            <kbd className="kbd">C</kbd>
          </button>
        </div>
      )}

      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      ) : !loaded ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t(`${p.ns}.empty`)} body={p.canManage ? t(`${p.ns}.emptySub`) : t(`${p.ns}.adminOnly`)} action={createButton} product="chat" />
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table">
            <thead>
              <tr>
                {p.columns.map((c) => (
                  <th key={c.label} scope="col">
                    {c.label}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  {p.columns.map((c) => (
                    <td key={c.label} data-label={c.label}>
                      {c.render(item)}
                    </td>
                  ))}
                  <td className="chat-row-actions">
                    {p.rowActions?.(item, load)}
                    {p.canManage && !p.locked?.(item) && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(item)} aria-label={`${t('common.edit')}: ${item.name}`}>
                        {t('common.edit')}
                      </button>
                    )}
                    {p.canManage && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setConfirmDelete(item)}
                        aria-label={`${t('common.delete')}: ${item.name}`}
                        title={t('common.delete')}
                      >
                        <ChatIcon name="trash" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t(`${p.ns}.newTitle`) : t(`${p.ns}.editTitle`)}
        onSubmit={() => void save()}
        submitLabel={editing === 'new' ? t(`${p.ns}.create`) : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={invalid}
        busy={busy}
        error={formError}
      >
        <div className="ui-fields">
          {p.fields.map((f, i) => {
            const id = `coll-${p.ns}-${f.id}`;
            const common = {
              id,
              value: form[f.id] ?? '',
              placeholder: f.placeholder,
              onChange: (e: { target: { value: string } }) => setForm((v) => ({ ...v, [f.id]: e.target.value })),
            };
            return (
              <div className="ui-field" key={f.id}>
                <label className="label" htmlFor={id}>
                  {f.label}
                </label>
                {f.type === 'textarea' ? (
                  <textarea className="textarea" rows={6} maxLength={f.maxLength} {...common} />
                ) : f.type === 'select' ? (
                  <select className="select" {...common}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" type={f.type} maxLength={f.maxLength} data-autofocus={i === 0 ? true : undefined} {...common} />
                )}
                {f.help && <p className="ui-help">{f.help}</p>}
              </div>
            );
          })}
        </div>
      </QuickModal>

      <QuickModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t(`${p.ns}.deleteTitle`)}
        onSubmit={() => confirmDelete && void remove(confirmDelete)}
        submitLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        centered
      >
        <p>{t(`${p.ns}.deleteBody`, { name: confirmDelete?.name ?? '' })}</p>
      </QuickModal>
    </section>
  );
}
