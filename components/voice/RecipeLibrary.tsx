'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { VoicePrompt } from '@/lib/voice-types';
import VoiceModal from './VoiceModal';
import type { RecipeOption } from './RecipeInput';
import { voiceErrorKey } from './voice-ui';

interface Editing {
  id: string | null;
  name: string;
  prompt: string;
  shared: boolean;
}

/**
 * Biblioteca de recipes ("All recipes" en Granola): los tuyos, los que el
 * equipo compartió y los de fábrica. Se corren sobre la reunión, se crean y
 * se editan acá mismo; compartido = lo ve todo el workspace.
 */
export default function RecipeLibrary({ onClose, onRun, onChanged }: { onClose: () => void; onRun: (r: RecipeOption) => void; onChanged: () => void }) {
  const t = useTranslations('voice.library');
  const tErr = useTranslations('voice.errors');
  const tPrompts = useTranslations('voice.prompts');
  const builtin = Object.entries(tPrompts.raw('recipes') as Record<string, { name: string; prompt: string }>);
  const [list, setList] = useState<VoicePrompt[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<VoicePrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/voice/prompts?kind=recipe').catch(() => null);
    const data = (await res?.json().catch(() => null)) as { prompts?: VoicePrompt[] } | null;
    if (!res?.ok || !data?.prompts) {
      setError('network');
      setList([]);
      return;
    }
    setList(data.prompts);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name.trim() || !editing.prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(editing.id ? `/api/voice/prompts/${editing.id}` : '/api/voice/prompts', {
      method: editing.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'recipe', name: editing.name.trim(), prompt: editing.prompt.trim(), shared: editing.shared }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (VoicePrompt & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? (res ? 'generic' : 'network'));
      return;
    }
    setList((l) => (l ?? []).filter((x) => x.id !== data.id).concat(data).sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(null);
    onChanged();
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    const prev = list;
    setList((l) => (l ?? []).filter((x) => x.id !== id));
    const res = await fetch(`/api/voice/prompts/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setList(prev);
      setError('generic');
      return;
    }
    onChanged();
  }

  const needle = filter.trim().toLowerCase();
  const match = (name: string, prompt: string) => !needle || name.toLowerCase().includes(needle) || prompt.toLowerCase().includes(needle);
  const mine = (list ?? []).filter((p) => p.mine && match(p.name, p.prompt));
  const team = (list ?? []).filter((p) => !p.mine && match(p.name, p.prompt));
  const builtins = builtin.filter(([, v]) => match(v.name, v.prompt));

  const row = (r: { id: string; name: string; prompt: string; origin: RecipeOption['origin'] }, own?: VoicePrompt) => (
    <li key={r.id} className="vc-lib-row" data-testid="voice-library-row">
      <div className="vc-lib-main">
        <span className="vc-lib-name">
          /{r.name}
          {own?.shared && <span className="vc-muted vc-lib-tag">{t('sharedTag')}</span>}
        </span>
        <span className="vc-muted vc-lib-prompt">{r.prompt}</span>
      </div>
      <div className="vc-lib-actions">
        {own && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={t('editNamed', { name: r.name })} onClick={() => setEditing({ id: own.id, name: own.name, prompt: own.prompt, shared: own.shared })}>
              {t('edit')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={t('deleteNamed', { name: r.name })} onClick={() => setDeleting(own)}>
              {t('delete')}
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label={t('runNamed', { name: r.name })}
          onClick={() => {
            onRun({ id: r.id, name: r.name, origin: r.origin });
            onClose();
          }}
        >
          {t('run')}
        </button>
      </div>
    </li>
  );

  return (
    <VoiceModal wide title={t('title')} onClose={onClose} closeLabel={t('close')} testId="voice-recipe-library">
      <div className="vc-lib">
        <div className="vc-lib-top">
          <input type="search" className="input" value={filter} placeholder={t('search')} aria-label={t('search')} onChange={(e) => setFilter(e.target.value)} />
          {!editing && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ id: null, name: '', prompt: '', shared: false })}>
              {t('new')}
            </button>
          )}
        </div>
        {editing && (
          <form
            className="vc-lib-form"
            onSubmit={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEditing(null);
              }
            }}
          >
            <div className="ui-field">
              <label className="label" htmlFor="vc-lib-name">
                {t('name')}
              </label>
              <input id="vc-lib-name" className="input" value={editing.name} maxLength={80} autoFocus placeholder={t('namePlaceholder')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="vc-lib-prompt">
                {t('prompt')}
              </label>
              <textarea
                id="vc-lib-prompt"
                className="textarea"
                rows={4}
                maxLength={4000}
                value={editing.prompt}
                placeholder={t('promptPlaceholder')}
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
              />
            </div>
            <label className="ui-switch">
              <input type="checkbox" checked={editing.shared} onChange={(e) => setEditing({ ...editing, shared: e.target.checked })} />
              <span>{t('shared')}</span>
            </label>
            <div className="vc-send-row">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !editing.name.trim() || !editing.prompt.trim()} aria-busy={busy || undefined}>
                {t('save')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                {t('cancel')}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {tErr(voiceErrorKey(error))}
          </p>
        )}
        {list === null ? (
          <p className="vc-muted" role="status">
            {t('loading')}
          </p>
        ) : (
          <>
            <section aria-labelledby="vc-lib-mine">
              <h3 id="vc-lib-mine" className="vc-pop-title">
                {t('mine')}
              </h3>
              {mine.length === 0 ? (
                <p className="vc-muted vc-lib-empty">{needle ? t('noMatch') : t('mineEmpty')}</p>
              ) : (
                <ul className="vc-lib-list">{mine.map((p) => row({ id: p.id, name: p.name, prompt: p.prompt, origin: 'mine' }, p))}</ul>
              )}
            </section>
            {team.length > 0 && (
              <section aria-labelledby="vc-lib-team">
                <h3 id="vc-lib-team" className="vc-pop-title">
                  {t('team')}
                </h3>
                <ul className="vc-lib-list">{team.map((p) => row({ id: p.id, name: p.name, prompt: p.prompt, origin: 'team' }))}</ul>
              </section>
            )}
            {builtins.length > 0 && (
              <section aria-labelledby="vc-lib-builtin">
                <h3 id="vc-lib-builtin" className="vc-pop-title">
                  {t('builtin')}
                </h3>
                <ul className="vc-lib-list">{builtins.map(([k, v]) => row({ id: `builtin:${k}`, name: v.name, prompt: v.prompt, origin: 'builtin' }))}</ul>
              </section>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </VoiceModal>
  );
}
