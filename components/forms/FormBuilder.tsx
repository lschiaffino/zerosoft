'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { FormDto } from '@/lib/forms/core';
import type { FormDefinition, FormSettings, FormStatus, Sharing } from '@/lib/forms/types';
import FormRunner from './FormRunner';
import { FormTabs, StatusBadge, useErrorText } from './ui';
import BuildPanel from './BuildPanel';
import LogicPanel from './LogicPanel';
import DesignPanel from './DesignPanel';
import SettingsPanel from './SettingsPanel';
import TranslatePanel from './TranslatePanel';
import SharePanel from './SharePanel';

const PANELS = ['build', 'logic', 'design', 'settings', 'translate'] as const;
type Panel = (typeof PANELS)[number] | 'share';

export interface BuilderState {
  name: string;
  slug: string;
  definition: FormDefinition;
  settings: FormSettings;
  sharing: Sharing;
  members: string[];
}

/**
 * Builder: preguntas y pantallas, lógica, diseño, ajustes, traducciones y
 * compartir. Un solo Guardar (⌘S) manda todo; publicar guarda primero. Salir
 * con cambios sin guardar pregunta antes.
 */
export default function FormBuilder({ initial, tab, me, admin, crmApp, brandColors = [] }: { initial: FormDto; tab: string; me: string; admin: boolean; crmApp: boolean; brandColors?: string[] }) {
  const t = useTranslations('forms');
  const errText = useErrorText();
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const fromForm = (f: FormDto): BuilderState => ({ name: f.name, slug: f.slug, definition: f.definition, settings: f.settings, sharing: f.sharing, members: f.members });
  const [state, setState] = useState<BuilderState>(() => fromForm(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(fromForm(initial)));
  const [panel, setPanel] = useState<Panel>(tab === 'share' ? 'share' : (PANELS as readonly string[]).includes(tab) ? (tab as Panel) : 'build');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const dirty = JSON.stringify(state) !== saved;

  const update = useCallback(<K extends keyof BuilderState>(key: K, value: BuilderState[K]) => setState((s) => ({ ...s, [key]: value })), []);
  const setDef = useCallback((fn: (d: FormDefinition) => FormDefinition) => setState((s) => ({ ...s, definition: fn(s.definition) })), []);
  const setSettings = useCallback((patch: Partial<FormSettings>) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })), []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(
    async (extra: { status?: FormStatus } = {}) => {
      setBusy(true);
      setMsg(null);
      const canShare = admin || form.createdBy === me;
      const res = await fetch(`/api/forms/${form.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: state.name,
          slug: state.slug,
          definition: state.definition,
          settings: state.settings,
          ...(canShare ? { sharing: state.sharing, members: state.members } : {}),
          ...extra,
        }),
      }).catch(() => null);
      const data = res ? ((await res.json().catch(() => null)) as { form?: FormDto; error?: string } | null) : null;
      setBusy(false);
      if (!data?.form) {
        setMsg({ kind: 'bad', text: errText(data?.error) });
        return false;
      }
      setForm(data.form);
      const next = fromForm(data.form);
      setState(next);
      setSaved(JSON.stringify(next));
      setMsg({ kind: 'ok', text: extra.status === 'published' ? t('builder.published') : extra.status === 'closed' ? t('builder.closedMsg') : t('builder.saved') });
      router.refresh();
      return true;
    },
    [admin, form.createdBy, form.id, me, state, errText, t, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const previewSettings = useMemo(() => state.settings, [state.settings]);

  return (
    <div className="app-page ui-page fm-page fm-builder">
      <header className="fm-head">
        <div className="fm-head-main">
          <label className="sr-only" htmlFor="fm-name">
            {t('builder.name')}
          </label>
          <input
            id="fm-name"
            className="fm-name"
            value={state.name}
            onChange={(e) => update('name', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            maxLength={200}
          />
          <StatusBadge status={form.status} open={form.open} />
          {dirty && <span className="fm-dirty">{t('builder.unsaved')}</span>}
        </div>
        <div className="fm-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
            {preview ? t('builder.closePreview') : t('builder.preview')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void save()} disabled={busy || !dirty}>
            {t('builder.save')}
          </button>
          {form.status !== 'published' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save({ status: 'published' })} disabled={busy}>
              {t('builder.publish')}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void save({ status: 'closed' })} disabled={busy}>
              {t('builder.close')}
            </button>
          )}
        </div>
      </header>
      <FormTabs id={form.id} active={panel === 'share' ? 'share' : 'build'} />
      {msg && (
        <p className={`fm-msg fm-msg-${msg.kind}`} role={msg.kind === 'bad' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}
      {preview ? (
        <div className="fm-preview" aria-label={t('builder.preview')}>
          <FormRunner
            slug={form.slug}
            definition={state.definition}
            settings={previewSettings}
            closedReason=""
            hidden={{}}
            lang={state.definition.lang}
            languages={[]}
            embed={false}
            preview
          />
        </div>
      ) : panel === 'share' ? (
        <SharePanel form={form} slug={state.slug} onSlug={(v) => update('slug', v)} />
      ) : (
        <>
          <div className="ui-tabs fm-subtabs" role="tablist" aria-label={t('builder.sections')}>
            {PANELS.map((p) => (
              <button key={p} type="button" role="tab" id={`fm-tab-${p}`} aria-selected={panel === p} aria-controls={`fm-panel-${p}`} className="ui-tab" onClick={() => setPanel(p)}>
                {t(`builder.tab.${p}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`fm-panel-${panel}`} aria-labelledby={`fm-tab-${panel}`} className="fm-panel">
            {panel === 'build' && <BuildPanel def={state.definition} setDef={setDef} />}
            {panel === 'logic' && <LogicPanel def={state.definition} setDef={setDef} />}
            {panel === 'design' && <DesignPanel settings={state.settings} setSettings={setSettings} brandColors={brandColors} />}
            {panel === 'settings' && (
              <SettingsPanel
                form={form}
                state={state}
                setSettings={setSettings}
                update={update}
                canShare={admin || form.createdBy === me}
                crmApp={crmApp}
                onRotated={(f) => setForm(f)}
              />
            )}
            {panel === 'translate' && <TranslatePanel def={state.definition} setDef={setDef} />}
          </div>
        </>
      )}
    </div>
  );
}
