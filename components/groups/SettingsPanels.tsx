'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { LabelDto, PropertyDef, QuickReply } from '@/lib/groups';
import type { GroupsSettings } from '@/lib/groups-rules';
import { LabelTag, Modal, api, useErrorText, useToast } from './ui';

const COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

export function LabelsPanel({ initial }: { initial: Array<LabelDto & { count: number }> }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [labels, setLabels] = useState(initial);
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [removing, setRemoving] = useState<LabelDto | null>(null);

  async function add() {
    const res = await api<LabelDto>('/api/groups/labels', { body: { name, color } });
    if (!res.data) return showToast(errText(res.error), true);
    setLabels((l) => [...l, { ...res.data!, count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setName('');
  }
  async function recolor(l: LabelDto, c: string) {
    const res = await api<LabelDto>(`/api/groups/labels/${l.id}`, { method: 'PATCH', body: { name: l.name, color: c } });
    if (res.data) setLabels((list) => list.map((x) => (x.id === l.id ? { ...x, color: c } : x)));
    else showToast(errText(res.error), true);
  }
  async function remove() {
    if (!removing) return;
    const res = await api(`/api/groups/labels/${removing.id}`, { method: 'DELETE' });
    if (res.data) setLabels((list) => list.filter((x) => x.id !== removing.id));
    setRemoving(null);
  }

  return (
    <div className="ui-fields">
      <p className="ui-help">{t('labels.intro')}</p>
      <form
        className="gr-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void add();
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('labels.placeholder')} maxLength={40} aria-label={t('labels.name')} />
        <select className="select" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('labels.color')}>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {t(`colors.${c}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
          {t('labels.add')}
        </button>
      </form>
      {labels.length === 0 ? (
        <p className="ui-help">{t('labels.empty')}</p>
      ) : (
        <ul className="gr-mini-list">
          {labels.map((l) => (
            <li key={l.id}>
              <LabelTag name={l.name} color={l.color} />
              <span className="ui-help">{t('labels.count', { n: l.count })}</span>
              <select className="select gr-narrow" value={l.color} onChange={(e) => void recolor(l, e.target.value)} aria-label={t('labels.color')}>
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {t(`colors.${c}`)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(l)}>
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        title={t('labels.deleteTitle', { name: removing?.name ?? '' })}
        body={t('labels.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </div>
  );
}

export function QuickRepliesPanel({ initial }: { initial: QuickReply[] }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [list, setList] = useState(initial);
  const [shortcut, setShortcut] = useState('');
  const [body, setBody] = useState('');
  const [editId, setEditId] = useState<string | null>(null);

  async function save() {
    const res = await api<QuickReply>('/api/groups/quick-replies', { body: { id: editId ?? undefined, shortcut, body } });
    if (!res.data) return showToast(errText(res.error), true);
    setList((l) => [...l.filter((x) => x.id !== res.data!.id), res.data!].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
    setShortcut('');
    setBody('');
    setEditId(null);
  }
  async function remove(id: string) {
    const res = await api(`/api/groups/quick-replies?id=${id}`, { method: 'DELETE' });
    if (res.data) setList((l) => l.filter((x) => x.id !== id));
  }

  return (
    <div className="ui-fields">
      <p className="ui-help">{t('quick.intro')}</p>
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          if (shortcut.trim() && body.trim()) void save();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('quick.shortcut')}</span>
          <input className="input gr-narrow" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder={t('quick.shortcutPlaceholder')} maxLength={30} />
        </label>
        <label className="ui-field">
          <span className="label">{t('quick.body')}</span>
          <textarea className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
        </label>
        <div className="gr-inline-form">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!shortcut.trim() || !body.trim()}>
            {editId ? t('common.save') : t('quick.add')}
          </button>
          {editId && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditId(null);
                setShortcut('');
                setBody('');
              }}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>
      {list.length === 0 ? (
        <p className="ui-help">{t('quick.empty')}</p>
      ) : (
        <ul className="gr-mini-list">
          {list.map((q) => (
            <li key={q.id}>
              <span>
                <strong className="gr-mono">/{q.shortcut}</strong> {q.body.slice(0, 120)}
              </span>
              <span className="gr-inline-form">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditId(q.id);
                    setShortcut(q.shortcut);
                    setBody(q.body);
                  }}
                >
                  {t('numbers.edit')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => void remove(q.id)}>
                  {t('common.delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {toast}
    </div>
  );
}

const PROP_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url', 'file', 'cascade'] as const;

/** Texto con sangría → vista del árbol del desplegable dependiente. */
function treeFromText(text: string): string {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .join('\n');
}

/**
 * Propiedades propias de chats y grupos (scope "chat") o campos propios de
 * los tickets (scope "ticket"): crear con su tipo, renombrar, cambiar
 * opciones, marcar obligatoria al cerrar (tickets) y borrar.
 */
export function PropertiesPanel({ initial, canEdit, scope = 'chat' }: { initial: PropertyDef[]; canEdit: boolean; scope?: 'chat' | 'ticket' }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [list, setList] = useState(initial);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<(typeof PROP_TYPES)[number]>('text');
  const [options, setOptions] = useState('');
  const [tree, setTree] = useState('');
  const [required, setRequired] = useState(false);
  const [editing, setEditing] = useState<PropertyDef | null>(null);
  const [removing, setRemoving] = useState<PropertyDef | null>(null);
  const [treeError, setTreeError] = useState('');
  const isTicket = scope === 'ticket';

  async function add() {
    // Desplegable dependiente sin opciones: el aviso va en el campo, con el copy de ese campo (una por línea).
    if (type === 'cascade' && !treeFromText(tree).length) {
      setTreeError(t('errors.missing_tree'));
      document.getElementById('gr-prop-tree')?.focus();
      return;
    }
    setTreeError('');
    const res = await api<PropertyDef>('/api/groups/properties', {
      body: {
        label,
        type,
        scope,
        required: isTicket && required,
        options: options.split(',').map((o) => o.trim()).filter(Boolean),
        tree: type === 'cascade' ? treeFromText(tree) : undefined,
      },
    });
    if (!res.data) {
      if (type === 'cascade' && res.error === 'missing_options') return setTreeError(t('errors.missing_tree'));
      return showToast(errText(res.error), true);
    }
    setList((l) => [...l, res.data!]);
    setLabel('');
    setOptions('');
    setTree('');
    setRequired(false);
  }
  async function remove() {
    if (!removing) return;
    const id = removing.id;
    const res = await api(`/api/groups/properties?id=${id}`, { method: 'DELETE' });
    setRemoving(null);
    if (res.data) setList((l) => l.filter((x) => x.id !== id));
    else showToast(errText(res.error), true);
  }

  return (
    <div className="ui-fields">
      <p className="ui-help">{isTicket ? t('ticketFields.intro') : t('props.intro')}</p>
      {canEdit && (
        <form
          className="gr-prop-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) void add();
          }}
        >
          <div className="gr-inline-form">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={isTicket ? t('ticketFields.placeholder') : t('props.placeholder')} maxLength={60} aria-label={t('props.label')} />
            <select className="select" value={type} onChange={(e) => setType(e.target.value as (typeof PROP_TYPES)[number])} aria-label={t('props.type')}>
              {PROP_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`props.types.${x}`)}
                </option>
              ))}
            </select>
            {(type === 'select' || type === 'multiselect') && (
              <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={t('props.options')} aria-label={t('props.options')} />
            )}
            {isTicket && (
              <label className="gr-check-label">
                <input type="checkbox" className="ui-check" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                {t('ticketFields.required')}
              </label>
            )}
            {type !== 'cascade' && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={!label.trim()}>
                {t('props.add')}
              </button>
            )}
          </div>
          {type === 'cascade' && (
            <>
              <label className="ui-field">
                <span className="label">{t('props.tree')}</span>
                <textarea
                  id="gr-prop-tree"
                  className="textarea gr-tree-input"
                  rows={6}
                  value={tree}
                  onChange={(e) => {
                    setTree(e.target.value);
                    if (treeError) setTreeError('');
                  }}
                  placeholder={t('props.treePlaceholder')}
                  aria-invalid={treeError ? true : undefined}
                  aria-describedby={treeError ? 'gr-prop-tree-err' : undefined}
                />
                <span className="ui-help">{t('props.treeHelp')}</span>
                {treeError && (
                  <span id="gr-prop-tree-err" className="ui-error" role="alert">
                    {treeError}
                  </span>
                )}
              </label>
              <div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!label.trim()}>
                  {t('props.add')}
                </button>
              </div>
            </>
          )}
        </form>
      )}
      {list.length === 0 ? (
        <p className="ui-help">{isTicket ? t('ticketFields.empty') : t('props.empty')}</p>
      ) : (
        <ul className="gr-mini-list">
          {list.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.label}</strong>
                {p.required && <span className="badge badge-outline">{t('ticketFields.requiredTag')}</span>}{' '}
                {!isTicket && <span className="ui-help gr-mono">{`{{prop.${p.key}}}`}</span>}
              </span>
              <span className="ui-help">
                {t(`props.types.${p.type}`)}
                {p.options.length ? `: ${p.options.join(', ')}` : ''}
                {p.tree?.length ? `: ${p.tree.map((n) => n.label).join(', ')}` : ''}
              </span>
              {canEdit && (
                <span className="gr-inline-form">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>
                    {t('numbers.edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(p)}>
                    {t('common.delete')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <EditPropertyModal
        def={editing}
        onClose={() => setEditing(null)}
        onSaved={(d) => {
          setList((l) => l.map((x) => (x.id === d.id ? d : x)));
          setEditing(null);
          showToast(t('common.saved'));
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={t('props.deleteTitle', { name: removing?.label ?? '' })}
        body={t('props.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </div>
  );
}

/** Árbol → texto con sangría (dos espacios por nivel). */
function treeToText(nodes: NonNullable<PropertyDef['tree']>, depth = 0): string {
  return nodes.map((n) => [`${'  '.repeat(depth)}${n.label}`, ...(n.children?.length ? [treeToText(n.children, depth + 1)] : [])].join('\n')).join('\n');
}

function EditPropertyModal({ def, onClose, onSaved }: { def: PropertyDef | null; onClose: () => void; onSaved: (d: PropertyDef) => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [label, setLabel] = useState('');
  const [options, setOptions] = useState('');
  const [tree, setTree] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!def) return;
    setLabel(def.label);
    setOptions(def.options.join(', '));
    setTree(def.tree ? treeToText(def.tree) : '');
    setRequired(def.required);
    setError('');
  }, [def]);

  async function submit() {
    if (!def) return;
    setBusy(true);
    const res = await api<PropertyDef>('/api/groups/properties', {
      method: 'PATCH',
      body: {
        id: def.id,
        label,
        ...(def.type === 'select' || def.type === 'multiselect' ? { options: options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
        ...(def.type === 'cascade' ? { tree } : {}),
        ...(def.scope === 'ticket' ? { required } : {}),
      },
    });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    onSaved(res.data);
  }

  return (
    <Modal
      open={!!def}
      title={t('props.editTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!label.trim()} aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('props.label')}</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} autoFocus required />
          {def && def.scope === 'chat' && <span className="ui-help gr-mono">{`{{prop.${def.key}}}`}</span>}
        </label>
        {def && (def.type === 'select' || def.type === 'multiselect') && (
          <label className="ui-field">
            <span className="label">{t('props.options')}</span>
            <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} />
          </label>
        )}
        {def?.type === 'cascade' && (
          <label className="ui-field">
            <span className="label">{t('props.tree')}</span>
            <textarea className="textarea gr-tree-input" rows={8} value={tree} onChange={(e) => setTree(e.target.value)} />
            <span className="ui-help">{t('props.treeHelp')}</span>
          </label>
        )}
        {def?.scope === 'ticket' && (
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            {t('ticketFields.required')}
          </label>
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

export function TicketRulesPanel({ initial, canEdit, aiAvailable = true }: { initial: GroupsSettings; canEdit: boolean; aiAvailable?: boolean }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [s, setS] = useState(initial);
  const [keywords, setKeywords] = useState(initial.ticketKeywords.join(', '));
  const [extra, setExtra] = useState(initial.slaEmailExtra.join(', '));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await api<GroupsSettings>('/api/groups/settings', {
      method: 'PATCH',
      body: {
        ...s,
        locale,
        ticketKeywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        slaEmailExtra: extra.split(/[\s,;]+/).filter(Boolean),
      },
    });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setS(res.data);
    setKeywords(res.data.ticketKeywords.join(', '));
    setExtra(res.data.slaEmailExtra.join(', '));
    showToast(t('common.saved'));
  }

  const num = (v: number, set: (n: number) => void, label: string) => (
    <label className="ui-field">
      <span className="label">{label}</span>
      <input className="input gr-narrow" type="number" min={1} value={v} onChange={(e) => set(Number(e.target.value) || 1)} disabled={!canEdit} />
    </label>
  );

  return (
    <form
      className="ui-fields"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="ui-help">{t('rules.intro')}</p>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('rules.emoji')}</span>
          <input className="input gr-narrow" value={s.ticketEmoji} onChange={(e) => setS({ ...s, ticketEmoji: e.target.value })} maxLength={16} disabled={!canEdit} />
          <span className="ui-help">{t('rules.emojiHelp')}</span>
        </label>
        <label className="ui-field">
          <span className="label">{t('rules.keywords')}</span>
          <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={t('rules.keywordsPlaceholder')} disabled={!canEdit} />
          <span className="ui-help">{t('rules.keywordsHelp')}</span>
        </label>
      </div>
      <div className="ui-fields-2">
        {num(s.unansweredMin, (n) => setS({ ...s, unansweredMin: n }), t('rules.unanswered'))}
        {num(s.firstResponseMin, (n) => setS({ ...s, firstResponseMin: n }), t('rules.firstResponse'))}
      </div>
      <fieldset className="ui-field">
        <legend className="label">{t('rules.resolution')}</legend>
        <div className="ui-fields-2">
          {(['urgent', 'high', 'medium', 'low'] as const).map((p) =>
            num(s.resolutionMin[p], (n) => setS({ ...s, resolutionMin: { ...s.resolutionMin, [p]: n } }), t(`priority.${p}`)),
          )}
        </div>
      </fieldset>
      <fieldset className="ui-field">
        <legend className="label">{t('rules.flagMode')}</legend>
        {(['time', 'questions'] as const).map((m) => (
          <label key={m} className="gr-check-label">
            <input type="radio" name="flagMode" value={m} checked={s.flagMode === m} onChange={() => setS({ ...s, flagMode: m })} disabled={!canEdit} />
            {t(`rules.flagModes.${m}`)}
          </label>
        ))}
        {s.flagMode === 'questions' && !aiAvailable && <p className="gr-banner is-warn">{t('rules.flagNoAi')}</p>}
      </fieldset>
      {s.flagMode === 'questions' && (
        <label className="ui-field">
          <span className="label">{t('rules.flagRules')}</span>
          <textarea className="textarea" rows={3} value={s.flagRules} onChange={(e) => setS({ ...s, flagRules: e.target.value })} maxLength={1000} disabled={!canEdit} placeholder={t('rules.flagRulesPlaceholder')} />
          <span className="ui-help">{t('rules.flagRulesHelp')}</span>
        </label>
      )}
      <label className="gr-check-label">
        <input type="checkbox" className="ui-check" checked={s.unflagOnTicket} onChange={(e) => setS({ ...s, unflagOnTicket: e.target.checked })} disabled={!canEdit} />
        {t('rules.unflagOnTicket')}
      </label>
      <fieldset className="ui-field">
        <legend className="label">{t('rules.slaEmail')}</legend>
        <label className="gr-check-label">
          <input type="checkbox" className="ui-check" checked={s.slaEmail} onChange={(e) => setS({ ...s, slaEmail: e.target.checked })} disabled={!canEdit} />
          {t('rules.slaEmailOn')}
        </label>
        {s.slaEmail && (
          <>
            <label className="gr-check-label">
              <input type="checkbox" className="ui-check" checked={s.slaEmailAssignee} onChange={(e) => setS({ ...s, slaEmailAssignee: e.target.checked })} disabled={!canEdit} />
              {t('rules.slaEmailAssignee')}
            </label>
            <label className="gr-check-label">
              <input type="checkbox" className="ui-check" checked={s.slaEmailAdmins} onChange={(e) => setS({ ...s, slaEmailAdmins: e.target.checked })} disabled={!canEdit} />
              {t('rules.slaEmailAdmins')}
            </label>
            <label className="ui-field">
              <span className="label">{t('rules.slaEmailExtra')}</span>
              <input className="input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="soporte@acme.com" disabled={!canEdit} />
              <span className="ui-help">{t('rules.slaEmailHelp')}</span>
            </label>
          </>
        )}
      </fieldset>
      <label className="ui-field">
        <span className="label">{t('rules.defaultPriority')}</span>
        <select className="select gr-narrow" value={s.defaultPriority} onChange={(e) => setS({ ...s, defaultPriority: e.target.value as GroupsSettings['defaultPriority'] })} disabled={!canEdit}>
          {['low', 'medium', 'high', 'urgent'].map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
      </label>
      {canEdit && (
        <div>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </div>
      )}
      {toast}
    </form>
  );
}
