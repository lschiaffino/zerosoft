'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

type Access = 'edit' | 'read' | 'hidden';

interface FieldRow {
  id: string;
  label: string;
  name: string;
  entityLabel: string;
}

interface Rule {
  field_id: string;
  subject: string;
  access: 'read' | 'hidden';
}

interface Props {
  fields: FieldRow[];
  teams: Array<{ id: string; name: string }>;
  initialRules: Rule[];
  canEdit: boolean;
}

/**
 * Permisos por campo: para cada campo propio, qué pueden hacer los members
 * y cada equipo de ventas (editar, solo ver u oculto). Cada cambio se guarda
 * solo; owner y admins siempre editan todo.
 */
export default function FieldPermissionsPanel({ fields, teams, initialRules, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subjects = [
    { subject: 'role:member', label: t('fieldPerms.members') },
    ...teams.map((x) => ({ subject: `team:${x.id}`, label: t('fieldPerms.team', { name: x.name }) })),
  ];

  function accessOf(fieldId: string, subject: string): Access {
    return rules.find((r) => r.field_id === fieldId && r.subject === subject)?.access ?? 'edit';
  }

  async function set(fieldId: string, subject: string, access: Access) {
    const next = rules.filter((r) => !(r.field_id === fieldId && r.subject === subject));
    if (access !== 'edit') next.push({ field_id: fieldId, subject, access });
    const prev = rules;
    setRules(next);
    setBusy(fieldId);
    setError(null);
    const res = await fetch(`/api/crm/field-permissions/${fieldId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: next.filter((r) => r.field_id === fieldId).map((r) => ({ subject: r.subject, access: r.access })) }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setRules(prev);
      setError(t('errors.generic'));
      return;
    }
    setSaved(fieldId);
    setTimeout(() => setSaved((v) => (v === fieldId ? null : v)), 1600);
    router.refresh();
  }

  if (!fields.length) return <p className="muted">{t('fieldPerms.noFields')}</p>;

  return (
    <div className="field-perms" data-testid="field-perms">
      <ul className="field-perms-list">
        {fields.map((f) => {
          const count = rules.filter((r) => r.field_id === f.id).length;
          const open = openId === f.id;
          return (
            <li key={f.id} className="field-perms-row">
              <div className="field-perms-head">
                <span className="field-perms-name">
                  {f.label} <span className="muted">· {f.entityLabel}</span>
                </span>
                <span className="muted field-perms-count">{count ? t('fieldPerms.restricted', { count }) : t('fieldPerms.access.edit')}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={open}
                  aria-controls={`fp-${f.id}`}
                  onClick={() => setOpenId(open ? null : f.id)}
                >
                  {open ? t('fieldPerms.close') : t('fieldPerms.edit')}
                </button>
              </div>
              {open && (
                <div className="field-perms-body" id={`fp-${f.id}`}>
                  {subjects.map((s) => (
                    <label key={s.subject} className="field-perms-subject">
                      <span>{s.label}</span>
                      <select
                        className="filter-select"
                        value={accessOf(f.id, s.subject)}
                        disabled={!canEdit || busy === f.id}
                        onChange={(e) => void set(f.id, s.subject, e.target.value as Access)}
                        aria-label={`${f.label}: ${s.label}`}
                      >
                        {(['edit', 'read', 'hidden'] as const).map((a) => (
                          <option key={a} value={a}>
                            {t(`fieldPerms.access.${a}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {saved === f.id && (
                    <span className="saved-note" role="status">
                      {t('fieldPerms.saved')}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!canEdit && <p className="ui-help">{t('common.adminOnly')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
