'use client';

import { useTranslations } from 'next-intl';
import type { TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import type { IssueLabel } from '@/lib/track-schema';
import LabelPicker, { useWorkspaceLabels } from './LabelPicker';

export interface IssuePreset {
  statusId: string;
  priority: string;
  assigneeId: string;
  /** Labels del workspace o nombres nuevos (se crean al guardar). */
  labels: Array<{ id: string } | { name: string }>;
}

const NEW = 'new:';

/** Labels guardados (JSON) con nombre y color. */
export function savedLabelList(raw: string | null | undefined): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((l: IssueLabel) => l && typeof l.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Labels guardados → entrada del formulario. */
export function presetLabels(raw: string | null | undefined): IssuePreset['labels'] {
  return savedLabelList(raw).map((l) => ({ id: l.id }));
}

/**
 * Status, prioridad, asignado y labels que se precargan en un issue
 * (plantillas e issues que se repiten). `allowUnsetPriority` agrega "Sin
 * precargar" a la prioridad (las plantillas pueden no fijarla).
 */
export default function IssuePresetFields({
  idPrefix,
  value,
  onChange,
  statuses,
  members,
  savedLabels,
  allowUnsetPriority = false,
}: {
  idPrefix: string;
  value: IssuePreset;
  onChange: (next: IssuePreset) => void;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  /** Labels con nombre y color que ya tenía (para mostrarlos). */
  savedLabels: IssueLabel[];
  allowUnsetPriority?: boolean;
}) {
  const t = useTranslations('track');
  const [workspaceLabels] = useWorkspaceLabels();
  const known = new Map<string, IssueLabel>(savedLabels.map((l) => [l.id, l]));
  workspaceLabels.forEach((l) => known.set(l.id, { id: l.id, name: l.name, color: l.color }));
  const shown: IssueLabel[] = value.labels.map((l) =>
    'id' in l
      ? (known.get(l.id) ?? { id: l.id, name: l.id, color: '#666666' })
      : { id: `${NEW}${l.name}`, name: l.name, color: '#666666' },
  );
  const set = (patch: Partial<IssuePreset>) => onChange({ ...value, ...patch });

  return (
    <>
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${idPrefix}-status`}>
            {t('templates.status')}
          </label>
          <select
            id={`${idPrefix}-status`}
            className="select"
            value={value.statusId}
            onChange={(e) => set({ statusId: e.target.value })}
          >
            <option value="">{t('templates.unset')}</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${idPrefix}-priority`}>
            {t('templates.priority')}
          </label>
          <select
            id={`${idPrefix}-priority`}
            className="select"
            value={value.priority}
            onChange={(e) => set({ priority: e.target.value })}
          >
            {allowUnsetPriority && <option value="">{t('templates.unset')}</option>}
            {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`priorities.${p}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${idPrefix}-assignee`}>
            {t('templates.assignee')}
          </label>
          <select
            id={`${idPrefix}-assignee`}
            className="select"
            value={value.assigneeId}
            onChange={(e) => set({ assigneeId: e.target.value })}
          >
            <option value="">{t('templates.unset')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <span className="label">{t('templates.labels')}</span>
          <LabelPicker
            value={shown}
            onChange={(next) =>
              set({
                labels: next.map((l) => ('id' in l && l.id.startsWith(NEW) ? { name: l.id.slice(NEW.length) } : l)),
              })
            }
          />
        </div>
      </div>
    </>
  );
}
