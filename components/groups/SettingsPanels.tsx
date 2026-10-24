'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { LabelDto, PropertyDef, QuickReply } from '@/lib/groups';
import type { GroupsSettings } from '@/lib/groups-rules';
import { LabelTag, api, useErrorText, useToast } from './ui';

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
          <input className="input gr-narrow" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="hours" maxLength={30} />
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

export function PropertiesPanel({ initial, canEdit }: { initial: PropertyDef[]; canEdit: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [list, setList] = useState(initial);
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');

  async function add() {
    const res = await api<PropertyDef>('/api/groups/properties', {
      body: { label, type, options: options.split(',').map((o) => o.trim()).filter(Boolean) },
    });
    if (!res.data) return showToast(errText(res.error), true);
    setList((l) => [...l, res.data!]);
    setLabel('');
    setOptions('');
  }
  async function remove(id: string) {
    const res = await api(`/api/groups/properties?id=${id}`, { method: 'DELETE' });
    if (res.data) setList((l) => l.filter((x) => x.id !== id));
    else showToast(errText(res.error), true);
  }

  return (
    <div className="ui-fields">
      <p className="ui-help">{t('props.intro')}</p>
      {canEdit && (
        <form
          className="gr-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) void add();
          }}
        >
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('props.placeholder')} maxLength={60} aria-label={t('props.label')} />
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label={t('props.type')}>
            {['text', 'number', 'select', 'date'].map((x) => (
              <option key={x} value={x}>
                {t(`props.types.${x}`)}
              </option>
            ))}
          </select>
          {type === 'select' && (
            <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={t('props.options')} aria-label={t('props.options')} />
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!label.trim()}>
            {t('props.add')}
          </button>
        </form>
      )}
      {list.length === 0 ? (
        <p className="ui-help">{t('props.empty')}</p>
      ) : (
        <ul className="gr-mini-list">
          {list.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.label}</strong> <span className="ui-help gr-mono">{`{{prop.${p.key}}}`}</span>
              </span>
              <span className="ui-help">
                {t(`props.types.${p.type}`)}
                {p.options.length ? `: ${p.options.join(', ')}` : ''}
              </span>
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => void remove(p.id)}>
                  {t('common.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {toast}
    </div>
  );
}

export function TicketRulesPanel({ initial, canEdit }: { initial: GroupsSettings; canEdit: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [s, setS] = useState(initial);
  const [keywords, setKeywords] = useState(initial.ticketKeywords.join(', '));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await api<GroupsSettings>('/api/groups/settings', {
      method: 'PATCH',
      body: { ...s, ticketKeywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) },
    });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setS(res.data);
    setKeywords(res.data.ticketKeywords.join(', '));
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
