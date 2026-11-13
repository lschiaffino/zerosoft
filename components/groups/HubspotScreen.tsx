'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import type { ChatCompanyDto } from '@/lib/groups-hubspot-sync';
import { HUBSPOT_MAX_PINNED, formatHubspotValue, hubspotMulti, hubspotTime, type HubspotOwner, type HubspotPropDef, type HubspotSchemaDto } from '@/lib/groups-hubspot-shared';
import { parseDbUtc } from '@/lib/utils';
import { setHubspotSchema, useHubspotSchema } from './hubspot-client';
import { api, useErrorText, useRelativeTime } from './ui';
import { PinIcon } from './wa/icons';

type CompanyData = ChatCompanyDto & { canEdit?: boolean };

/** datetime-local ↔ ISO: el campo trabaja en la hora de la persona. */
function toLocalInput(value: string): string {
  const ms = hubspotTime(value);
  if (ms === null) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return '';
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

/** El valor de una fecha de HubSpot (ISO o milisegundos) como lo quiere <input type="date">. */
function toDateInput(value: string): string {
  const ms = hubspotTime(value);
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

/** El editor de una propiedad según su tipo. Enter guarda (salvo en el texto largo), Esc cancela. */
function Editor({
  def,
  value,
  owners,
  onSave,
  onCancel,
}: {
  def: HubspotPropDef;
  value: string;
  owners: HubspotOwner[];
  onSave: (raw: string | string[]) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('groups');
  const [draft, setDraft] = useState(() => (def.kind === 'date' ? toDateInput(value) : def.kind === 'datetime' ? toLocalInput(value) : value));
  const [picked, setPicked] = useState<string[]>(() => hubspotMulti(value));
  const label = t('hubspot.screen.valueOf', { label: def.label });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (def.kind === 'multi') onSave(picked);
    else if (def.kind === 'datetime') onSave(fromLocalInput(draft));
    else onSave(draft);
  };
  let field;
  if (def.kind === 'textarea') {
    field = <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} rows={4} maxLength={10000} autoFocus />;
  } else if (def.kind === 'number') {
    field = <input className="input" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} maxLength={40} autoFocus />;
  } else if (def.kind === 'date') {
    field = <input className="input" type="date" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus />;
  } else if (def.kind === 'datetime') {
    field = <input className="input" type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus />;
  } else if (def.kind === 'bool') {
    field = (
      <label className="gr-check-label gr-hsx-option">
        <input type="checkbox" className="ui-check" checked={draft === 'true'} onChange={(e) => setDraft(e.target.checked ? 'true' : 'false')} autoFocus />
        {def.label}
      </label>
    );
  } else if (def.kind === 'multi') {
    // Un valor guardado que ya no es una opción se sigue viendo, para poder sacarlo.
    const options = [...def.options, ...picked.filter((v) => !def.options.some((o) => o.value === v)).map((v) => ({ label: v, value: v }))];
    field = (
      <fieldset className="gr-hsx-options" aria-label={label}>
        {options.map((o) => (
          <label key={o.value} className="gr-check-label gr-hsx-option">
            <input
              type="checkbox"
              className="ui-check"
              checked={picked.includes(o.value)}
              onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, o.value] : cur.filter((v) => v !== o.value)))}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  } else if (def.kind === 'owner' && owners.length > 0) {
    field = (
      <select className="select" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus>
        <option value="">{t('hubspot.screen.noOwner')}</option>
        {!owners.some((o) => o.id === draft) && draft && <option value={draft}>{draft}</option>}
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  } else if (def.kind === 'select' && def.options.length > 0) {
    field = (
      <select className="select" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus>
        <option value="">{t('hubspot.screen.noValue')}</option>
        {!def.options.some((o) => o.value === draft) && draft && <option value={draft}>{draft}</option>}
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    field = <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} maxLength={10000} autoFocus />;
  }
  return (
    <form className="gr-hsx-editor" onSubmit={submit}>
      {field}
      <div className="gr-hsx-editor-actions">
        <button type="submit" className="btn btn-primary btn-sm">
          {t('common.save')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * La pantalla de HubSpot de un chat o grupo: todas las propiedades de la
 * empresa vinculada, agrupadas como en HubSpot, con las fijadas arriba,
 * búsqueda por nombre, un editor por tipo (el cambio va a HubSpot en el
 * momento), "Sincronizar ahora", el registro de cambios y el link a HubSpot.
 * Las vacías quedan detrás de "Mostrar vacías". Es un panel a pantalla
 * completa en el teléfono y una hoja lateral ancha en el escritorio.
 */
export default function HubspotScreen({
  chatId,
  open,
  onClose,
  isAdmin,
}: {
  chatId: string;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const rel = useRelativeTime();
  const ref = useRef<HTMLDialogElement>(null);
  const panelId = useId();
  const { schema, failed: schemaFailed, reload: reloadSchema } = useHubspotSchema(open);
  const [data, setData] = useState<CompanyData | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [tab, setTab] = useState<'props' | 'log'>('props');
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [pinning, setPinning] = useState(false);
  // Los avisos van dentro de la pantalla: un toast de la página quedaría tapado por ella.
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const showToast = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);
  const editingRef = useRef<string | null>(null);
  editingRef.current = editing;

  const load = useCallback(async () => {
    const res = await api<CompanyData>(`/api/groups/hubspot/company?chat=${encodeURIComponent(chatId)}`);
    if (res.data) {
      setData(res.data);
      setFailed(false);
    } else setFailed(true);
  }, [chatId]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setData(null);
      setFailed(false);
      setQ('');
      setTab('props');
      setEditing(null);
      setErrors({});
      setNotice(null);
      void load();
    }
    if (!open && d.open) d.close();
  }, [open, load]);

  const format = useMemo(() => ({ locale, owners: schema?.owners ?? [], yes: t('props.yes'), no: t('hubspot.screen.no') }), [locale, schema?.owners, t]);
  const defs = useMemo(() => new Map((schema?.props ?? []).map((p) => [p.name, p])), [schema]);
  const values = data?.values ?? {};
  const canEdit = Boolean(data?.canEdit) && !data?.company?.broken;

  async function save(def: HubspotPropDef, raw: string | string[]) {
    if (!data) return;
    const prev = data.values[def.name] ?? '';
    const next = Array.isArray(raw) ? raw.join(';') : raw;
    setEditing(null);
    setErrors((e) => ({ ...e, [def.name]: '' }));
    if (next === prev) return;
    // Optimista: el valor nuevo se ve ya; si HubSpot lo rechaza, vuelve el anterior con el motivo.
    const put = (v: string) => setData((d) => (d ? { ...d, values: { ...d.values, [def.name]: v } } : d));
    put(next);
    setSaving((s) => [...s, def.name]);
    let code = 'network_error';
    let detail = '';
    let saved: { value: string; updatedAt: string } | null = null;
    try {
      const res = await fetch('/api/groups/hubspot/company', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId, property: def.name, value: raw }),
      });
      const json = (await res.json().catch(() => ({}))) as { value?: string; updatedAt?: string; error?: string; detail?: string };
      if (res.ok && typeof json.value === 'string') saved = { value: json.value, updatedAt: json.updatedAt ?? '' };
      else {
        code = typeof json.error === 'string' ? json.error : 'server_error';
        detail = typeof json.detail === 'string' ? json.detail : '';
      }
    } catch {
      code = 'network_error';
    }
    setSaving((s) => s.filter((n) => n !== def.name));
    if (!saved) {
      put(prev);
      const message = code === 'hubspot_validation' && detail ? t('hubspot.screen.rejected', { detail }) : errText(code);
      setErrors((e) => ({ ...e, [def.name]: t('hubspot.screen.notSaved', { label: def.label, reason: message }) }));
      return;
    }
    put(saved.value);
    showToast(t('hubspot.screen.saved', { label: def.label }));
    void load();
  }

  async function syncNow() {
    setSyncing(true);
    const res = await api<CompanyData>('/api/groups/hubspot/company', { body: { chatId } });
    setSyncing(false);
    if (!res.data) return showToast(errText(res.error), true);
    setData(res.data);
    reloadSchema();
    showToast(t('hubspot.screen.synced'));
  }

  async function togglePin(def: HubspotPropDef) {
    if (!schema || pinning) return;
    const on = schema.pinned.includes(def.name);
    if (!on && schema.pinned.length >= HUBSPOT_MAX_PINNED) return showToast(t('hubspot.screen.pinMax', { n: HUBSPOT_MAX_PINNED }), true);
    setPinning(true);
    const res = await api<HubspotSchemaDto>('/api/groups/hubspot/properties', { body: { pinned: on ? schema.pinned.filter((n) => n !== def.name) : [...schema.pinned, def.name] } });
    setPinning(false);
    if (!res.data) return showToast(errText(res.error), true);
    setHubspotSchema(res.data);
  }

  const text = q.trim().toLowerCase();
  const matches = (def: HubspotPropDef) => !text || def.label.toLowerCase().includes(text) || def.name.toLowerCase().includes(text);
  const pinned = (schema?.pinned ?? []).map((n) => defs.get(n)).filter((d): d is HubspotPropDef => Boolean(d) && matches(d as HubspotPropDef));
  const pinnedNames = new Set(schema?.pinned ?? []);
  const rest = (schema?.props ?? []).filter((d) => !pinnedNames.has(d.name) && matches(d));
  // Con una búsqueda escrita se ven también las vacías: se busca una propiedad para completarla.
  const withEmpty = showEmpty || text !== '';
  const emptyCount = rest.filter((d) => !values[d.name]).length;
  const sections = (schema?.groups ?? [])
    .map((g) => ({ ...g, props: rest.filter((d) => d.group === g.name && (withEmpty || values[d.name] || editing === d.name)) }))
    .filter((g) => g.props.length > 0);

  const row = (def: HubspotPropDef) => {
    const value = values[def.name] ?? '';
    const shown = formatHubspotValue(def, value, format);
    const busy = saving.includes(def.name);
    const isPinned = pinnedNames.has(def.name);
    return (
      <li key={def.name} className={`gr-hsx-row${isAdmin ? ' has-pin' : ''}`} data-prop={def.name}>
        <div className="gr-hsx-label">
          <span>{def.label}</span>
          {def.readOnly && <span className="gr-hsx-tag">{def.calculated ? t('hubspot.screen.calculated') : t('hubspot.screen.readOnly')}</span>}
        </div>
        <div className="gr-hsx-value">
          {editing === def.name ? (
            <Editor def={def} value={value} owners={schema?.owners ?? []} onSave={(raw) => void save(def, raw)} onCancel={() => setEditing(null)} />
          ) : canEdit && !def.readOnly ? (
            <button type="button" className="gr-hsx-edit" onClick={() => setEditing(def.name)} aria-label={t('hubspot.screen.edit', { label: def.label })} aria-busy={busy || undefined}>
              <span className={shown ? 'gr-hsx-text' : 'gr-hsx-text gr-hsx-none'}>{shown ? <LocalText>{shown}</LocalText> : t('hubspot.screen.empty')}</span>
            </button>
          ) : (
            <span className={shown ? 'gr-hsx-text gr-hsx-static' : 'gr-hsx-text gr-hsx-static gr-hsx-none'}>{shown ? <LocalText>{shown}</LocalText> : t('hubspot.screen.empty')}</span>
          )}
          {errors[def.name] && (
            <p className="ui-error" role="alert">
              {errors[def.name]}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            type="button"
            className="gr-hsx-pin"
            aria-pressed={isPinned}
            disabled={pinning}
            aria-label={isPinned ? t('hubspot.screen.unpin', { label: def.label }) : t('hubspot.screen.pin', { label: def.label })}
            title={isPinned ? t('hubspot.screen.unpin', { label: def.label }) : t('hubspot.screen.pin', { label: def.label })}
            onClick={() => void togglePin(def)}
          >
            <PinIcon size={16} />
          </button>
        )}
      </li>
    );
  };

  const company = data?.company ?? null;
  const logValue = (name: string, v: string) => formatHubspotValue(defs.get(name), v, format) || t('hubspot.screen.empty');

  return (
    <dialog
      ref={ref}
      className="ui-drawer gr-hsx"
      // El nombre va directo y no por aria-labelledby: el <dialog> sale del servidor y el título solo se pinta
      // abierto, en el cliente. Si el id de useId del servidor y el del cliente no coinciden (en la bandeja pasa),
      // React deja el del servidor en el <dialog> y el diálogo se queda sin nombre.
      aria-label={t('hubspot.screen.title')}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        // Esc con un editor abierto lo cierra a él, no a la pantalla.
        if (editingRef.current) setEditing(null);
        else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-drawer-head gr-hsx-head">
            <div className="gr-hsx-heading">
              <h2 className="ui-drawer-title">
                {t('hubspot.screen.title')}
              </h2>
              {company && <p className="gr-hsx-company">{company.name}</p>}
            </div>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
          {company && (
            <div className="gr-hsx-bar">
              <div className="gr-hsx-synced" role="status">
                <p className="ui-help">{data?.syncedAt ? t('hubspot.screen.syncedAt', { time: rel(data.syncedAt) }) : t('hubspot.screen.neverSynced')}</p>
                {notice && <p className={notice.error ? 'ui-error' : 'gr-hsx-done'}>{notice.text}</p>}
              </div>
              <div className="gr-hsx-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void syncNow()} disabled={syncing} aria-busy={syncing || undefined}>
                  {t('hubspot.screen.syncNow')}
                </button>
                <a className="btn btn-ghost btn-sm" href={company.url} target="_blank" rel="noopener noreferrer">
                  {t('hubspot.screen.openIn')}
                </a>
              </div>
              <div className="ui-tabs gr-hsx-tabs" role="tablist" aria-label={t('hubspot.screen.views')}>
                <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'props'} aria-controls={panelId} onClick={() => setTab('props')}>
                  {t('hubspot.screen.tabProps')}
                </button>
                <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'log'} aria-controls={panelId} onClick={() => setTab('log')}>
                  {t('hubspot.screen.tabLog')}
                </button>
              </div>
              {tab === 'props' && (
                <div className="gr-hsx-tools">
                  <input
                    className="input"
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && q) {
                        e.preventDefault();
                        e.stopPropagation();
                        setQ('');
                      }
                    }}
                    placeholder={t('hubspot.screen.search')}
                    aria-label={t('hubspot.screen.search')}
                    maxLength={80}
                  />
                  <label className="gr-check-label gr-hsx-option">
                    <input type="checkbox" className="ui-check" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
                    {t('hubspot.screen.showEmpty', { n: emptyCount })}
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="ui-drawer-body gr-hsx-body" id={panelId} role="tabpanel" aria-label={tab === 'props' ? t('hubspot.screen.tabProps') : t('hubspot.screen.tabLog')}>
            {failed || schemaFailed ? (
              <p className="ui-help" role="alert">
                {t('hubspot.loadError')}{' '}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void load();
                    reloadSchema();
                  }}
                >
                  {t('common.retry')}
                </button>
              </p>
            ) : !data || !schema ? (
              <p className="ui-help" role="status">
                {t('common.loading')}
              </p>
            ) : !company ? (
              <p className="ui-help">{t('hubspot.screen.noCompany')}</p>
            ) : tab === 'log' ? (
              data.log.length === 0 ? (
                <p className="ui-help">{t('hubspot.screen.logEmpty')}</p>
              ) : (
                <ol className="gr-hsx-log" aria-label={t('hubspot.screen.tabLog')}>
                  {data.log.map((l) => (
                    <li key={l.id}>
                      <span className="gr-hsx-log-head">
                        <strong>{defs.get(l.property)?.label ?? l.property}</strong>
                        <span className="gr-hsx-tag">{l.direction === 'in' ? t('hubspot.screen.dirIn') : t('hubspot.screen.dirOut')}</span>
                      </span>
                      <span className="gr-hsx-log-change">
                        <LocalText>{t('hubspot.screen.change', { from: logValue(l.property, l.oldValue), to: logValue(l.property, l.newValue) })}</LocalText>
                      </span>
                      <span className="ui-help">
                        <LocalText>
                          {l.direction === 'out' && l.actor
                            ? t('hubspot.screen.logBy', { name: l.actor, time: parseDbUtc(l.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })
                            : parseDbUtc(l.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                        </LocalText>
                      </span>
                    </li>
                  ))}
                </ol>
              )
            ) : (
              <>
                {company.broken && (
                  <p className="ui-error gr-hsx-notice" role="alert">
                    {company.broken.reason === 'merged' ? t('hubspot.brokenMerged', { name: company.broken.mergedName || company.broken.mergedInto }) : t('hubspot.brokenDeleted')}
                  </p>
                )}
                {data.refreshError && (
                  <p className="ui-help gr-hsx-notice" role="status">
                    {t('hubspot.screen.stale', { reason: errText(data.refreshError) })}
                  </p>
                )}
                {!company.broken && !data.canWrite && <p className="ui-help gr-hsx-notice">{t('hubspot.screen.noWrite')}</p>}
                {pinned.length > 0 && (
                  <section className="gr-hsx-section" aria-label={t('hubspot.screen.pinned')}>
                    <h3 className="gr-detail-title">{t('hubspot.screen.pinned')}</h3>
                    <ul className="gr-hsx-rows">{pinned.map(row)}</ul>
                  </section>
                )}
                {sections.map((g) => (
                  <section key={g.name} className="gr-hsx-section" aria-label={g.label}>
                    <h3 className="gr-detail-title">{g.label}</h3>
                    <ul className="gr-hsx-rows">{g.props.map(row)}</ul>
                  </section>
                ))}
                {pinned.length === 0 && sections.length === 0 && (
                  <p className="ui-help" role="status">
                    {text ? t('hubspot.screen.noMatch') : t('hubspot.screen.allEmpty')}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
