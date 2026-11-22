'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocalText from '@/components/ui/LocalText';
import type { ConflictItem, ConflictKeep, ConflictList, ConflictValue } from '@/lib/crm-hubspot-sync/conflicts-types';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot: los conflictos (bloque
 * S4). Registros con campos que cambiaron de los dos lados desde el último
 * sync; el admin compara lo de cada lado (leído de HubSpot en el momento,
 * nunca guardado) y elige, campo por campo, qué queda. También deja el mismo
 * lado en todos de una vez (con confirmación) y descarta los que se resuelven
 * en el registro (fusiones y actividades). Solo admins (el panel que la
 * contiene ya lo exige).
 */

const API = '/api/crm/hubspot-sync/conflicts';
const PATH: Record<string, string> = { contact: 'contacts', company: 'companies', deal: 'deals' };

function formatDate(raw: string | null, locale: string): string {
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? raw : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

const keyOf = (i: Pick<ConflictItem, 'object' | 'recordId'>) => `${i.object}:${i.recordId}`;

type Kept = Array<{ field: string; code: string }>;

async function postJson(body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { status: 0, data: null };
  return { status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

export default function HubspotSyncConflicts({ locale }: { locale: string }) {
  const t = useTranslations('crm.hubspotSync.conflicts');
  const tf = useTranslations('crm.hubspotSync.fields');
  const [list, setList] = useState<ConflictList | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState<ConflictKeep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const bulkButtons = useRef<Partial<Record<ConflictKeep, HTMLButtonElement | null>>>({});

  const load = useCallback(async (offset = 0) => {
    const res = await fetch(`${API}?offset=${offset}`).catch(() => null);
    if (!res || !res.ok) {
      if (offset === 0) setFailed(true);
      return;
    }
    setFailed(false);
    const next = ((await res.json()) as { conflicts: ConflictList }).conflicts;
    setList((prev) => (offset && prev ? { ...next, items: [...prev.items, ...next.items.filter((i) => !prev.items.some((p) => keyOf(p) === keyOf(i)))] } : next));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // La confirmación de "todos" se cierra con Esc y con un clic afuera; el foco vuelve al botón que la abrió.
  useEffect(() => {
    if (!bulk) return;
    const opener = bulkButtons.current[bulk];
    const close = () => {
      setBulk(null);
      opener?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (confirmRef.current?.contains(target) || Object.values(bulkButtons.current).some((b) => b?.contains(target))) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    confirmRef.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [bulk]);

  const errorText = (code: unknown) => (typeof code === 'string' && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  async function resolveAll(keep: ConflictKeep) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let resolved = 0;
    let kept = 0;
    // Por tandas: sigue mientras la tanda resuelva algo o deje registros al final y queden por ver.
    for (let round = 0; round < 40; round++) {
      const { status, data } = await postJson({ action: 'resolve_all', keep });
      if (status !== 200 || !data) {
        setError(errorText(data?.error));
        break;
      }
      const r = Number(data.resolved ?? 0);
      const k = Array.isArray(data.kept) ? data.kept.length : 0;
      resolved += r;
      kept += k;
      if (!Number(data.remaining ?? 0) || (r === 0 && k === 0) || (r === 0 && round > 0)) break;
    }
    setBusy(false);
    setBulk(null);
    setOpen(null);
    setNotice(kept ? t('bulkDoneKept', { n: resolved, k: kept }) : t('bulkDone', { n: resolved }));
    await load();
  }

  if (failed && !list) {
    return (
      <div role="group" className="hsync-card" data-testid="hubspot-sync-conflicts" data-state="error" aria-label={t('title')}>
        <h3 className="hsync-title">{t('title')}</h3>
        <p className="form-error" role="alert">
          {t('loadError')}
        </p>
        <div className="form-actions hsync-actions">
          <button type="button" className="btn btn-small" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }
  if (!list) {
    return (
      <p className="muted" role="status" data-testid="hubspot-sync-conflicts-loading">
        {t('loading')}
      </p>
    );
  }

  const nf = new Intl.NumberFormat(locale);
  const fieldLabel = (f: string) => (f.startsWith('custom.') ? f.slice(7) : tf.has(f) ? tf(f) : f);
  const resolvable = list.items.some((i) => i.resolvable);

  return (
    <div role="group" className="hsync-card" data-testid="hubspot-sync-conflicts" data-count={list.total} aria-label={t('title')}>
      <h3 className="hsync-title">
        {t('title')} {list.total > 0 && <span className="mono hsync-count">{nf.format(list.total)}</span>}
      </h3>
      <p className="ui-help">{t('desc')}</p>

      {list.total === 0 ? (
        <p className="ui-help" role="status" data-testid="hubspot-sync-conflicts-empty">
          {t('empty')}
        </p>
      ) : (
        <>
          {resolvable && (
            <div className="form-actions hsync-actions">
              {(['here', 'hubspot'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  ref={(el) => {
                    bulkButtons.current[k] = el;
                  }}
                  className="btn btn-small"
                  onClick={() => setBulk((b) => (b === k ? null : k))}
                  disabled={busy}
                  aria-expanded={bulk === k}
                  data-testid={`hubspot-sync-conflicts-all-${k}`}
                >
                  {t(`all.${k}`)}
                </button>
              ))}
            </div>
          )}
          {bulk && (
            <div className="hsync-confirm" ref={confirmRef} role="dialog" aria-modal="false" aria-labelledby="hsync-conf-confirm-title" data-testid="hubspot-sync-conflicts-confirm">
              <p className="hsync-state-title" id="hsync-conf-confirm-title">
                {t(`confirm.${bulk}.title`)}
              </p>
              <p className="ui-help">{t(`confirm.${bulk}.body`)}</p>
              <div className="form-actions hsync-actions">
                <button type="button" className="btn btn-small" onClick={() => setBulk(null)} data-autofocus data-testid="hubspot-sync-conflicts-confirm-cancel">
                  {t('cancel')}
                </button>
                <button type="button" className="btn btn-solid btn-small" onClick={() => void resolveAll(bulk)} disabled={busy} aria-busy={busy} data-testid="hubspot-sync-conflicts-confirm-yes">
                  {busy ? t('resolving') : t(`confirm.${bulk}.yes`)}
                </button>
              </div>
            </div>
          )}

          <ul className="hsync-conf-list" data-testid="hubspot-sync-conflicts-list">
            {list.items.map((item) => (
              <ConflictRow
                key={keyOf(item)}
                item={item}
                locale={locale}
                fieldLabel={fieldLabel}
                expanded={open === keyOf(item)}
                onToggle={() => setOpen((o) => (o === keyOf(item) ? null : keyOf(item)))}
                onDone={async (message) => {
                  setOpen(null);
                  setNotice(message);
                  await load();
                }}
              />
            ))}
          </ul>
          {list.more && (
            <div className="form-actions hsync-actions">
              <button type="button" className="btn btn-small" onClick={() => void load(list.items.length)} data-testid="hubspot-sync-conflicts-more">
                {t('more')}
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="form-error" role="alert" data-testid="hubspot-sync-conflicts-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="ui-help" role="status" data-testid="hubspot-sync-conflicts-notice">
          {notice}
        </p>
      )}

      <details className="hsync-bucket" data-testid="hubspot-sync-conflicts-rules">
        <summary>{t('rules.title')}</summary>
        <ul className="hsync-list">
          {(['hubspot', 'here', 'again', 'values', 'merge'] as const).map((k) => (
            <li key={k}>{t(`rules.${k}`)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ConflictRow({
  item,
  locale,
  fieldLabel,
  expanded,
  onToggle,
  onDone,
}: {
  item: ConflictItem;
  locale: string;
  fieldLabel: (f: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const t = useTranslations('crm.hubspotSync.conflicts');
  const [values, setValues] = useState<ConflictValue[] | null>(null);
  const [choice, setChoice] = useState<Record<string, ConflictKeep>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorText = (code: unknown) => (typeof code === 'string' && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  const k = keyOf(item);

  useEffect(() => {
    if (!expanded || !item.resolvable) return;
    let stop = false;
    setValues(null);
    setError(null);
    setChoice({});
    void postJson({ action: 'detail', object: item.object, recordId: item.recordId }).then(({ status, data }) => {
      if (stop) return;
      if (status === 200 && data && Array.isArray(data.values)) setValues(data.values as ConflictValue[]);
      else setError(errorText(data?.error));
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, item.object, item.recordId, item.resolvable]);

  async function apply() {
    if (busy || !Object.keys(choice).length) return;
    setBusy(true);
    setError(null);
    const { status, data } = await postJson({ action: 'resolve', object: item.object, recordId: item.recordId, keep: choice });
    setBusy(false);
    if (status !== 200 || !data) {
      setError(errorText(data?.error));
      return;
    }
    const kept = (Array.isArray(data.kept) ? data.kept : []) as Kept;
    await onDone(kept.length ? t('keptSome', { fields: kept.map((x) => `${fieldLabel(x.field)} (${t.has(`codes.${x.code}`) ? t(`codes.${x.code}`) : x.code})`).join(', ') }) : t('resolved'));
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { status, data } = await postJson({ action: 'dismiss', object: item.object, recordId: item.recordId });
    setBusy(false);
    if (status !== 200) {
      setError(errorText(data?.error));
      return;
    }
    await onDone(t('dismissed'));
  }

  const setAll = (keep: ConflictKeep) => setChoice(Object.fromEntries((values ?? []).map((v) => [v.field, keep])));
  const title = item.name || t(`unnamed.${item.object}`);

  return (
    <li className="hsync-conf" data-testid="hubspot-sync-conflict" data-key={k} data-kind={item.kind}>
      <div className="hsync-conf-head">
        <span className="hsync-conf-main">
          <span className="hsync-sub">{t(`objects.${item.object}`)}</span>
          {PATH[item.object] ? (
            <Link href={`/app/crm/${PATH[item.object]}/${item.recordId}`} className="hsync-conf-name">
              {title}
            </Link>
          ) : (
            <span className="hsync-conf-name">{title}</span>
          )}
          <span className="hsync-sub">
            {item.kind === 'merge' ? t('mergeNote') : item.fields.map(fieldLabel).join(', ')}
            {' · '}
            <LocalText>{formatDate(item.updatedAt, locale)}</LocalText>
          </span>
        </span>
        {item.resolvable ? (
          <button type="button" className="btn btn-small" onClick={onToggle} aria-expanded={expanded} aria-controls={`hsync-conf-${k}`} data-testid="hubspot-sync-conflict-compare">
            {expanded ? t('close') : t('compare')}
          </button>
        ) : (
          <button type="button" className="btn btn-small" onClick={() => void dismiss()} disabled={busy} data-testid="hubspot-sync-conflict-dismiss">
            {t('dismiss')}
          </button>
        )}
      </div>
      {!item.resolvable && item.kind !== 'merge' && <p className="hsync-sub">{t('activityNote')}</p>}

      {expanded && item.resolvable && (
        <div className="hsync-conf-body" id={`hsync-conf-${k}`} data-testid="hubspot-sync-conflict-detail">
          {!values && !error && (
            <p className="muted" role="status">
              {t('reading')}
            </p>
          )}
          {values && (
            <>
              <div className="form-actions hsync-actions">
                <button type="button" className="btn btn-small" onClick={() => setAll('here')} data-testid="hubspot-sync-conflict-pick-here">
                  {t('pickAll.here')}
                </button>
                <button type="button" className="btn btn-small" onClick={() => setAll('hubspot')} data-testid="hubspot-sync-conflict-pick-hubspot">
                  {t('pickAll.hubspot')}
                </button>
              </div>
              <div className="hsync-conf-fields">
                {values.map((v) => (
                  <fieldset key={v.field} className="hsync-conf-field" data-testid="hubspot-sync-conflict-field" data-field={v.field}>
                    <legend className="hsync-conf-legend">
                      {fieldLabel(v.field)}
                      {v.equal && <span className="hsync-sub">{t('equal')}</span>}
                    </legend>
                    {(['here', 'hubspot'] as const).map((side) => {
                      const shown = side === 'here' ? v.here : v.hubspot;
                      const disabled = side === 'hubspot' && v.hubspot === null;
                      return (
                        <label key={side} className="hsync-conf-option" data-disabled={disabled}>
                          <input
                            type="radio"
                            name={`hsync-${k}-${v.field}`}
                            value={side}
                            checked={choice[v.field] === side}
                            disabled={disabled}
                            onChange={() => setChoice((c) => ({ ...c, [v.field]: side }))}
                            data-testid={`hubspot-sync-conflict-${side}`}
                          />
                          <span className="hsync-conf-side">{t(`side.${side}`)}</span>
                          <span className="hsync-conf-value">{shown === null ? t('noEquivalent') : shown === '' ? t('emptyValue') : shown}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
              <p className="ui-help">{t('applyNote')}</p>
              <div className="form-actions hsync-actions">
                <button type="button" className="btn btn-small" onClick={onToggle}>
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-solid btn-small"
                  onClick={() => void apply()}
                  disabled={busy || !Object.keys(choice).length}
                  aria-busy={busy}
                  data-testid="hubspot-sync-conflict-apply"
                >
                  {busy ? t('resolving') : t('apply', { n: Object.keys(choice).length })}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {!expanded && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
