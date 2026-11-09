'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { FlagDto, FlagGroup, FlagVariant, PropertyFilter } from '@/lib/analytics/types';
import { ApiError, api, notifyChanged } from './client';
import { FilterList, cleanFilters, useProjectMeta } from './Filters';

/**
 * Un feature flag: clave, descripción, prendido, rollout, variantes
 * (multivariante) y condiciones sobre propiedades de la persona. Abajo, el
 * código para usarlo y una prueba con un distinct_id.
 */
export default function FlagEditor({ projectId, flag, publicKey, cohorts = [], canManage = true }: { projectId: string; flag: FlagDto; publicKey: string; cohorts?: Array<{ id: string; name: string }>; canManage?: boolean }) {
  const t = useTranslations('analytics.flags');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const [key, setKey] = useState(flag.key);
  const [name, setName] = useState(flag.name);
  const [active, setActive] = useState(flag.active);
  const [multi, setMulti] = useState(flag.variants.length > 0);
  const [variants, setVariants] = useState<FlagVariant[]>(
    flag.variants.length
      ? flag.variants
      : [
          { key: 'control', rollout: 50 },
          { key: 'test', rollout: 50 },
        ],
  );
  // Lo guardado antes de los grupos es un solo grupo.
  const [groups, setGroups] = useState<FlagGroup[]>(flag.groups.length ? flag.groups : [{ conditions: flag.conditions as FlagGroup['conditions'], cohortId: null, rollout: flag.rollout, variant: null }]);
  const [payloads, setPayloads] = useState<Record<string, string>>(flag.payloads ?? {});
  const payloadKeys = multi ? variants.map((v) => v.key) : ['true'];
  const badPayload = payloadKeys.find((k) => {
    const raw = payloads[k];
    if (!raw?.trim()) return false;
    try {
      JSON.parse(raw);
      return false;
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testId, setTestId] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const sum = variants.reduce((a, v) => a + v.rollout, 0);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const cleanGroups = groups.map((g) => ({
    ...g,
    cohortId: g.cohortId || null,
    variant: multi ? g.variant || null : null,
    conditions: cleanFilters(g.conditions as PropertyFilter[]).map((c) => ({ ...c, type: 'person' as const })),
  }));
  const setGroup = (i: number, patch: Partial<FlagGroup>) => setGroups(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/flags/${flag.id}`, {
        method: 'PATCH',
        body: {
          key,
          name,
          active,
          rollout: cleanGroups[0]?.rollout ?? 100,
          variants: multi ? variants : [],
          conditions: cleanGroups[0]?.conditions ?? [],
          groups: cleanGroups,
          payloads: Object.fromEntries(payloadKeys.filter((k) => payloads[k]?.trim()).map((k) => [k, payloads[k]])),
        },
      });
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'error';
      setMsg({ ok: false, text: t.has(`errors.${code}`) ? t(`errors.${code}`) : tc('error') });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!testId.trim()) return;
    try {
      const r = await api<{ value: boolean | string }>('/api/analytics/flags/evaluate', { body: { flagId: flag.id, distinctId: testId.trim() } });
      setTestResult(String(r.value));
    } catch {
      setTestResult(tc('error'));
    }
  };

  const snippet = multi
    ? `zs.onFeatureFlags(() => {\n  if (zs.getFeatureFlag('${key}') === '${variants[1]?.key ?? 'test'}') {\n    // …\n  }\n});`
    : `zs.onFeatureFlags(() => {\n  if (zs.isFeatureEnabled('${key}')) {\n    // …\n  }\n});`;
  const curl = `curl -X POST ${origin}/api/ingest/decide \\\n  -d '{"api_key":"${publicKey}","distinct_id":"user-123"}'`;

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/pulse/flags', label: t('title') }}
        title={flag.key}
        description={flag.name || undefined}
        actions={
          canManage ? (
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
              {tc('delete')}
            </button>
          ) : undefined
        }
      />
      {!canManage && (
        <p className="an-note" role="status" data-testid="an-flag-readonly">
          {t('adminOnly')}
        </p>
      )}
      <form
        className="an-form an-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!canManage} className="an-plain-fieldset">
        <div className="ui-fields ui-fields-2">
          <label className="ui-field">
            <span className="label">{t('key')}</span>
            <input className="input an-mono" value={key} onChange={(e) => setKey(e.target.value)} pattern="[A-Za-z0-9_\-]+" maxLength={100} required />
            <span className="ui-help">{t('keyHelp')}</span>
          </label>
          <label className="ui-field">
            <span className="label">{t('descriptionLabel')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </label>
        </div>
        <label className="ui-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('active')}
        </label>
        <p className="an-note">{t('groupsHelp')}</p>
        {groups.map((g, i) => (
          <fieldset key={i} className="an-series" data-testid="an-flag-group">
            <legend className="an-series-legend">{t('groupN', { n: i + 1 })}</legend>
            <p className="an-note">{t('conditionsHelp')}</p>
            <FilterList filters={g.conditions as PropertyFilter[]} onChange={(f) => setGroup(i, { conditions: f as FlagGroup['conditions'] })} meta={meta} types={['person']} />
            <label className="ui-field">
              <span className="label">{t('cohort')}</span>
              <select className="select" value={g.cohortId ?? ''} disabled={!cohorts.length} onChange={(e) => setGroup(i, { cohortId: e.target.value || null })}>
                <option value="">{cohorts.length ? t('anyone') : t('noCohorts')}</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('rollout', { pct: g.rollout })}</span>
              <input type="range" min={0} max={100} value={g.rollout} onChange={(e) => setGroup(i, { rollout: Number(e.target.value) })} aria-valuetext={`${g.rollout}%`} />
            </label>
            {multi && (
              <label className="ui-field">
                <span className="label">{t('forceVariant')}</span>
                <select className="select" value={g.variant ?? ''} onChange={(e) => setGroup(i, { variant: e.target.value || null })}>
                  <option value="">{t('splitVariants')}</option>
                  {variants.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.key}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {groups.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm an-self-start" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>
                {t('removeGroup')}
              </button>
            )}
          </fieldset>
        ))}
        <button type="button" className="btn btn-sm an-self-start" disabled={groups.length >= 10} title={groups.length >= 10 ? t('groupsMax') : undefined} onClick={() => setGroups([...groups, { conditions: [], cohortId: null, rollout: 100, variant: null }])}>
          + {t('addGroup')}
        </button>
        <label className="ui-check">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> {t('multivariate')}
        </label>
        {multi && (
          <fieldset className="an-series">
            <legend className="an-series-legend">{t('variants')}</legend>
            {variants.map((v, i) => (
              <div key={i} className="an-row">
                <input
                  className="input an-mono"
                  aria-label={t('variantKey')}
                  value={v.key}
                  onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  pattern="[A-Za-z0-9_\-]+"
                  maxLength={64}
                  required
                />
                <input
                  className="input an-num-input"
                  type="number"
                  aria-label={t('variantRollout')}
                  min={0}
                  max={100}
                  value={v.rollout}
                  onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, rollout: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : x)))}
                />
                <span aria-hidden="true">%</span>
                {variants.length > 2 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>
                    {tc('remove')}
                  </button>
                )}
              </div>
            ))}
            {variants.length < 10 && (
              <button type="button" className="btn btn-sm" onClick={() => setVariants([...variants, { key: `variant-${variants.length + 1}`, rollout: 0 }])}>
                + {t('addVariant')}
              </button>
            )}
            <p className={sum === 100 ? 'an-note' : 'ui-error'}>{t('variantSum', { sum })}</p>
          </fieldset>
        )}
        <details className="an-more">
          <summary>{t('payloads')}</summary>
          <p className="an-note">{t('payloadsHelp')}</p>
          {payloadKeys.map((k) => (
            <label key={k} className="ui-field">
              <span className="label an-mono">{k}</span>
              <textarea
                className="textarea an-mono"
                rows={2}
                spellCheck={false}
                placeholder='{"color": "green"}'
                value={payloads[k] ?? ''}
                onChange={(e) => setPayloads({ ...payloads, [k]: e.target.value })}
                maxLength={10000}
              />
            </label>
          ))}
          {badPayload && <p className="ui-error">{t('payloadInvalid', { key: badPayload })}</p>}
        </details>
        <div className="an-row">
          <button type="submit" className="btn btn-primary" disabled={!canManage || busy || (multi && sum !== 100) || Boolean(badPayload)}>
            {tc('save')}
          </button>
          {msg && (
            <span className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </span>
          )}
        </div>
        </fieldset>
      </form>
      <section className="an-panel" aria-labelledby="an-flag-use">
        <h2 id="an-flag-use" className="an-h3">
          {t('useTitle')}
        </h2>
        <pre className="an-code">
          <code>{snippet}</code>
        </pre>
        <pre className="an-code">
          <code>{curl}</code>
        </pre>
        <form
          className="an-row an-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void test();
          }}
        >
          <input className="input" aria-label={t('testId')} placeholder={t('testId')} value={testId} onChange={(e) => setTestId(e.target.value)} />
          <button type="submit" className="btn btn-sm">
            {t('test')}
          </button>
          {testResult !== null && (
            <span className="an-mono" role="status" data-testid="an-flag-test">
              {t('testResult', { value: testResult })}
            </span>
          )}
        </form>
      </section>
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name: flag.key })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/flags/${flag.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/pulse/flags');
          } catch (err) {
            setBusy(false);
            setDeleting(false);
            const code = err instanceof ApiError ? err.code : 'error';
            setMsg({ ok: false, text: t.has(`errors.${code}`) ? t(`errors.${code}`) : tc('error') });
          }
        }}
      />
    </div>
  );
}
