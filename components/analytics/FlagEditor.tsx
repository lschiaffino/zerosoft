'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { FlagDto, FlagVariant, PropertyFilter } from '@/lib/analytics/types';
import { ApiError, api, notifyChanged } from './client';
import { FilterList, cleanFilters, useProjectMeta } from './Filters';

/**
 * Un feature flag: clave, descripción, prendido, rollout, variantes
 * (multivariante) y condiciones sobre propiedades de la persona. Abajo, el
 * código para usarlo y una prueba con un distinct_id.
 */
export default function FlagEditor({ projectId, flag, publicKey }: { projectId: string; flag: FlagDto; publicKey: string }) {
  const t = useTranslations('analytics.flags');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const [key, setKey] = useState(flag.key);
  const [name, setName] = useState(flag.name);
  const [active, setActive] = useState(flag.active);
  const [rollout, setRollout] = useState(flag.rollout);
  const [multi, setMulti] = useState(flag.variants.length > 0);
  const [variants, setVariants] = useState<FlagVariant[]>(
    flag.variants.length
      ? flag.variants
      : [
          { key: 'control', rollout: 50 },
          { key: 'test', rollout: 50 },
        ],
  );
  const [conditions, setConditions] = useState<PropertyFilter[]>(flag.conditions);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testId, setTestId] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const sum = variants.reduce((a, v) => a + v.rollout, 0);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/flags/${flag.id}`, {
        method: 'PATCH',
        body: { key, name, active, rollout, variants: multi ? variants : [], conditions: cleanFilters(conditions).map((c) => ({ ...c, type: 'person' })) },
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
        back={{ href: '/app/analytics/flags', label: t('title') }}
        title={flag.key}
        description={flag.name || undefined}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
            {tc('delete')}
          </button>
        }
      />
      <form
        className="an-form an-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
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
        <fieldset className="an-series">
          <legend className="an-series-legend">{t('conditions')}</legend>
          <p className="an-note">{t('conditionsHelp')}</p>
          <FilterList filters={conditions} onChange={setConditions} meta={meta} types={['person']} />
        </fieldset>
        <label className="ui-field">
          <span className="label">{t('rollout', { pct: rollout })}</span>
          <input type="range" min={0} max={100} value={rollout} onChange={(e) => setRollout(Number(e.target.value))} aria-valuetext={`${rollout}%`} />
        </label>
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
        <div className="an-row">
          <button type="submit" className="btn btn-primary" disabled={busy || (multi && sum !== 100)}>
            {tc('save')}
          </button>
          {msg && (
            <span className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </span>
          )}
        </div>
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
            router.replace('/app/analytics/flags');
          } catch {
            setBusy(false);
            setDeleting(false);
            setMsg({ ok: false, text: tc('error') });
          }
        }}
      />
    </div>
  );
}
