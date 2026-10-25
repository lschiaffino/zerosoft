'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import type { LabelDto, NumberDto } from '@/lib/groups';
import type { TemplateDto } from '@/lib/groups-org';
import { LabelTag, Modal, NumberOptions, api, defaultNumberId, useErrorText, useToast } from './ui';

const EPHEMERAL = [0, 86_400, 604_800, 7_776_000] as const;

interface CreateResult {
  name: string;
  ok: boolean;
  chatId?: string;
  error?: string;
  notAdded?: string[];
}

/**
 * Plantillas de grupo: lista, crear, editar, borrar y usar (un grupo con
 * sus variables o muchos desde un CSV). Teclado: C crea una plantilla.
 */
export default function TemplatesBoard({
  initial,
  numbers,
  labels,
  openNew,
  useId,
}: {
  initial: TemplateDto[];
  numbers: NumberDto[];
  labels: LabelDto[];
  openNew: boolean;
  useId: string | null;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const [toast, showToast] = useToast();
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<TemplateDto | 'new' | null>(openNew ? 'new' : null);
  const [using, setUsing] = useState<TemplateDto | null>(() => initial.find((x) => x.id === useId) ?? null);
  const [removing, setRemoving] = useState<TemplateDto | null>(null);
  const groupNumbers = useMemo(() => numbers.filter((n) => n.caps.groups), [numbers]);
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  useKeyShortcut('c', () => setEditing('new'));

  async function remove() {
    if (!removing) return;
    const r = await api(`/api/groups/templates/${removing.id}`, { method: 'DELETE' });
    const id = removing.id;
    setRemoving(null);
    if (!r.data) return showToast(errText(r.error), true);
    setList((l) => l.filter((x) => x.id !== id));
  }

  return (
    <>
      <div className="gr-toolbar">
        <p className="ui-help">{t('templates.intro', { example: '{{company}}', auto: '{{date}} {{month}} {{year}}' })}</p>
        <span className="gr-toolbar-spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          {t('templates.new')} <kbd className="kbd">C</kbd>
        </button>
      </div>
      {groupNumbers.length === 0 && <p className="gr-banner">{t('list.needsBridge')}</p>}
      {list.length === 0 ? (
        <EmptyState
          quiet
          title={t('templates.emptyTitle')}
          body={t('templates.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              {t('templates.new')}
            </button>
          }
          product="groups"
        />
      ) : (
        <div className="table-wrap">
          <table className="table gr-table">
            <thead>
              <tr>
                <th>{t('templates.colName')}</th>
                <th className="gr-hide-sm">{t('templates.colGroupName')}</th>
                <th className="num">{t('templates.colMembers')}</th>
                <th className="gr-hide-sm">{t('details.labels')}</th>
                <th>
                  <span className="sr-only">{t('tasks.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((tpl) => (
                <tr key={tpl.id}>
                  <td>
                    <button type="button" className="gr-link-button" onClick={() => setEditing(tpl)}>
                      {tpl.name}
                    </button>
                  </td>
                  <td className="gr-hide-sm gr-mono">{tpl.groupName || <span className="ui-help">{t('templates.sameName')}</span>}</td>
                  <td className="num">{tpl.members.length}</td>
                  <td className="gr-hide-sm">
                    <span className="gr-label-row">
                      {tpl.labelIds.map((id) => {
                        const l = labelById.get(id);
                        return l ? <LabelTag key={id} name={l.name} color={l.color} /> : null;
                      })}
                    </span>
                  </td>
                  <td className="num">
                    <span className="gr-inline-form">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUsing(tpl)} disabled={groupNumbers.length === 0}>
                        {t('templates.use')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(tpl)}>
                        {t('common.delete')}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TemplateForm
        template={editing}
        labels={labels}
        onClose={() => {
          setEditing(null);
          if (openNew) router.replace('/app/groups/templates');
        }}
        onSaved={(tpl, isNew) => {
          setEditing(null);
          setList((l) => [...l.filter((x) => x.id !== tpl.id), tpl].sort((a, b) => a.name.localeCompare(b.name)));
          showToast(isNew ? t('templates.created') : t('common.saved'));
        }}
      />
      <UseTemplateModal template={using} numbers={groupNumbers} onClose={() => setUsing(null)} />
      <ConfirmDialog
        open={!!removing}
        title={t('templates.deleteTitle', { name: removing?.name ?? '' })}
        body={t('templates.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </>
  );
}

function TemplateForm({
  template,
  labels,
  onClose,
  onSaved,
}: {
  template: TemplateDto | 'new' | null;
  labels: LabelDto[];
  onClose: () => void;
  onSaved: (t: TemplateDto, isNew: boolean) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState('');
  const [admins, setAdmins] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [welcome, setWelcome] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ephemeral, setEphemeral] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const existing = template && template !== 'new' ? template : null;

  useEffect(() => {
    if (!template) return;
    setName(existing?.name ?? '');
    setGroupName(existing?.groupName ?? '');
    setDescription(existing?.description ?? '');
    setMembers((existing?.members ?? []).map((p) => `+${p}`).join('\n'));
    setAdmins((existing?.admins ?? []).map((p) => `+${p}`).join('\n'));
    setLabelIds(existing?.labelIds ?? []);
    setWelcome(existing?.welcome ?? '');
    setAnnounce(Boolean(existing?.settings.announce));
    setLocked(Boolean(existing?.settings.locked));
    setEphemeral(existing?.settings.ephemeral ?? 0);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    const body = {
      name,
      groupName,
      description,
      members: members.split(/[\n,;]+/).filter(Boolean),
      admins: admins.split(/[\n,;]+/).filter(Boolean),
      labelIds,
      welcome,
      settings: { announce, locked, ephemeral },
    };
    const r = existing
      ? await api<TemplateDto>(`/api/groups/templates/${existing.id}`, { method: 'PATCH', body })
      : await api<TemplateDto>('/api/groups/templates', { body });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    onSaved(r.data, !existing);
  }

  return (
    <Modal
      open={!!template}
      wide
      title={existing ? t('templates.editTitle') : t('templates.newTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('templates.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required placeholder={t('templates.namePlaceholder')} />
        </label>
        <label className="ui-field">
          <span className="label">{t('templates.groupName')}</span>
          <input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={100} placeholder="{{company}} · Support" />
          <span className="ui-help">{t('templates.groupNameHelp', { example: '{{company}}' })}</span>
        </label>
        <label className="ui-field">
          <span className="label">{t('list.description')}</span>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>
        <div className="ui-fields-2">
          <label className="ui-field">
            <span className="label">{t('templates.members')}</span>
            <textarea className="textarea" rows={4} value={members} onChange={(e) => setMembers(e.target.value)} placeholder="+5491155550000" />
            <span className="ui-help">{t('templates.membersHelp')}</span>
          </label>
          <label className="ui-field">
            <span className="label">{t('templates.admins')}</span>
            <textarea className="textarea" rows={4} value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder="+5491155550000" />
            <span className="ui-help">{t('templates.adminsHelp')}</span>
          </label>
        </div>
        {labels.length > 0 && (
          <fieldset className="ui-field">
            <legend className="label">{t('details.labels')}</legend>
            <div className="gr-label-picker">
              {labels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`gr-label-toggle${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setLabelIds(on ? labelIds.filter((x) => x !== l.id) : [...labelIds, l.id])}
                  >
                    <LabelTag name={l.name} color={l.color} />
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <fieldset className="ui-field">
          <legend className="label">{t('groupSettings.title')}</legend>
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
            {t('groupSettings.announce')}
          </label>
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
            {t('groupSettings.locked')}
          </label>
          <label className="ui-field">
            <span className="label">{t('groupSettings.ephemeral')}</span>
            <select className="select" value={ephemeral} onChange={(e) => setEphemeral(Number(e.target.value))}>
              {EPHEMERAL.map((s) => (
                <option key={s} value={s}>
                  {t(`groupSettings.ephemeralOptions.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <label className="ui-field">
          <span className="label">{t('templates.welcome')}</span>
          <textarea className="textarea" rows={3} value={welcome} onChange={(e) => setWelcome(e.target.value)} maxLength={4000} placeholder={t('templates.welcomePlaceholder', { example: '{{company}}' })} />
          <span className="ui-help">{t('templates.welcomeHelp')}</span>
        </label>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function UseTemplateModal({ template, numbers, onClose }: { template: TemplateDto | null; numbers: NumberDto[]; onClose: () => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [mode, setMode] = useState<'one' | 'csv'>('one');
  const [numberId, setNumberId] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ rows: Array<{ name: string; phones: number }>; errors: Array<{ line: number; error: string }> } | null>(null);
  const [results, setResults] = useState<CreateResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const missing = template && mode === 'one' ? template.variables.filter((v) => !(vars[v] ?? '').trim()) : [];

  useEffect(() => {
    if (!template) return;
    setShowMissing(false);
    setMode('one');
    setNumberId(defaultNumberId(numbers));
    setVars({});
    setPhones('');
    setCsv('');
    setPreview(null);
    setResults(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const body = () =>
    mode === 'one' ? { numberId, vars, phones: phones.split(/[\n,;]+/).filter(Boolean) } : { numberId, csv };

  /** Todas las variables son obligatorias: sin ellas el nombre queda roto ("· Soporte"). */
  function varsOk(): boolean {
    if (missing.length === 0) return true;
    setShowMissing(true);
    document.getElementById(`gr-tpl-var-${missing[0]}`)?.focus();
    return false;
  }

  async function check() {
    if (!template) return;
    if (!varsOk()) return;
    setError('');
    const r = await api<{ rows: Array<{ name: string; phones: number }>; errors: Array<{ line: number; error: string }> }>(`/api/groups/templates/${template.id}/use`, {
      body: { ...body(), preview: true },
    });
    if (r.data) setPreview(r.data);
    else setError(errText(r.error));
  }

  async function run() {
    if (!template) return;
    if (!varsOk()) return;
    setBusy(true);
    setError('');
    const r = await api<{ results: CreateResult[] }>(`/api/groups/templates/${template.id}/use`, { body: body() });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    setResults(r.data.results);
  }

  const ok = results?.filter((x) => x.ok).length ?? 0;
  const csvHead = template ? [...template.variables, 'participants'].join(',') : '';
  return (
    <Modal
      open={!!template}
      wide
      title={template ? t('templates.useTitle', { name: template.name }) : ''}
      onClose={onClose}
      onSubmit={() => void (results ? onClose() : preview ? run() : check())}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {results ? t('common.close') : t('common.cancel')}
          </button>
          {!results && (
            <button type="submit" className="btn btn-primary" disabled={!numberId || (mode === 'csv' && !csv.trim())} aria-busy={busy || undefined}>
              {preview ? t('csv.create', { n: preview.rows.length }) : t('templates.check')}
            </button>
          )}
        </>
      }
    >
      <div className="ui-fields">
        {results ? (
          <>
            <p role="status">{t('csv.done', { ok, total: results.length })}</p>
            <ul className="gr-mini-list">
              {results.map((r, i) => (
                <li key={`${r.name}-${i}`}>
                  {r.ok && r.chatId ? <Link href={`/app/groups/list/${r.chatId}`}>{r.name}</Link> : <span>{r.name || '-'}</span>}
                  {r.ok ? (
                    r.notAdded && r.notAdded.length > 0 ? (
                      <span className="badge badge-warn">{t('csv.notAdded', { n: r.notAdded.length })}</span>
                    ) : (
                      <span className="badge badge-ok">{t('csv.ok')}</span>
                    )
                  ) : (
                    <span className="badge badge-bad">{errText(r.error)}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="gr-filters" role="tablist" aria-label={t('templates.mode')}>
              {(['one', 'csv'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`gr-filter${mode === m ? ' is-on' : ''}`}
                  onClick={() => {
                    setMode(m);
                    setPreview(null);
                  }}
                >
                  {t(`templates.modes.${m}`)}
                </button>
              ))}
            </div>
            {numbers.length > 0 && (
              <label className="ui-field">
                <span className="label">{t('list.fromNumber')}</span>
                <select className="select" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
                  <NumberOptions numbers={numbers} />
                </select>
              </label>
            )}
            {template && (
              <p className="ui-help gr-template-meta">
                <span>{t('templates.fixedMembers', { n: template.members.length })}</span>
                <span className="gr-mono">{template.groupName || template.name}</span>
              </p>
            )}
            {mode === 'one' ? (
              <>
                {template && template.variables.length > 0 && (
                  <div className="gr-vars-grid">
                    {template.variables.map((v) => {
                      const bad = showMissing && missing.includes(v);
                      return (
                        <label key={v} className="ui-field">
                          <span className="label gr-mono">{`{{${v}}}`}</span>
                          <input
                            id={`gr-tpl-var-${v}`}
                            className="input"
                            value={vars[v] ?? ''}
                            onChange={(e) => {
                              setVars({ ...vars, [v]: e.target.value });
                              setPreview(null);
                            }}
                            maxLength={200}
                            aria-required="true"
                            aria-invalid={bad || undefined}
                            aria-describedby={bad ? `gr-tpl-var-${v}-err` : undefined}
                          />
                          {bad && (
                            <span id={`gr-tpl-var-${v}-err`} className="ui-error">
                              {t('templates.varRequired')}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                <label className="ui-field">
                  <span className="label">{t('templates.extraPhones')}</span>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={phones}
                    onChange={(e) => {
                      setPhones(e.target.value);
                      setPreview(null);
                    }}
                    placeholder="+5491155550000"
                  />
                </label>
              </>
            ) : (
              <label className="ui-field">
                <span className="label">{t('csv.paste')}</span>
                <textarea
                  className="textarea gr-mono"
                  rows={6}
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setPreview(null);
                  }}
                  placeholder={`${csvHead}\n`}
                />
                <span className="ui-help">{t('templates.csvHelp', { columns: csvHead })}</span>
              </label>
            )}
            {preview && (
              <div role="status">
                <p>{t('csv.preview', { n: preview.rows.length })}</p>
                <ul className="gr-mini-list">
                  {preview.rows.slice(0, 10).map((r, i) => (
                    <li key={`${r.name}-${i}`}>
                      <span>{r.name || '-'}</span>
                      <span className="ui-help">{t('csv.participants', { n: r.phones })}</span>
                    </li>
                  ))}
                </ul>
                {preview.errors.length > 0 && (
                  <ul className="gr-mini-list">
                    {preview.errors.map((e) => (
                      <li key={`${e.line}-${e.error}`} className="ui-error">
                        {t('csv.lineError', { line: e.line, error: errText(e.error) })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
