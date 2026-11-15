'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Avatar from './Avatar';
import { groupEventMessage, personLabel, type WaGroupEvent } from '@/lib/wa-group-events';

/** "+54 9 11 5555-0000" como en la lista de Inbox; otros países, "+" y los dígitos. */
function phoneLabel(d: string): string {
  const ar = /^549(11|\d{3})(\d{3,4})(\d{4})$/.exec(d);
  if (ar) return `+54 9 ${ar[1]} ${ar[2]}-${ar[3]}`;
  return `+${d}`;
}

/** Texto de un aviso del grupo ("Ana te agregó", "Saliste"), en el idioma de la pantalla (Inbox y Lines). */
export function useGroupEventText(): (e: WaGroupEvent) => string {
  const t = useTranslations('groups.wa.events');
  return (e) => {
    const { key, values } = groupEventMessage(e, (p) => personLabel(p, t('someone'), phoneLabel));
    return t(key, values);
  };
}

/** Un aviso del grupo en el chat: una línea centrada, como la de los días. */
export function GroupEventLine({ e, id }: { e: WaGroupEvent; id: string }) {
  const text = useGroupEventText();
  return (
    <p className="gr-system wa-sys-event" id={`m-${id}`} data-testid="wa-group-event">
      <span>{text(e)}</span>
    </p>
  );
}

export interface NewGroupAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

/**
 * Un grupo sin mensajes todavía: quién lo creó, "Grupo · N miembros" y lo que
 * se puede hacer desde acá (solo acciones que funcionan en cada app).
 */
export function NewGroupCard({
  name,
  avatar,
  seed,
  created,
  members,
  actions,
}: {
  name: string;
  avatar?: string;
  seed: string;
  /** El aviso de creación, si se guardó (de ahí sale "Creaste este grupo" o quién lo creó). */
  created: WaGroupEvent | null;
  members: number;
  actions: NewGroupAction[];
}) {
  const t = useTranslations('groups.wa.newGroup');
  const text = useGroupEventText();
  const who = created ? text({ ...created, subject: undefined }) : '';
  return (
    <section className="wa-newgroup" aria-label={t('label')} data-testid="new-group-card">
      <Avatar name={name} kind="group" src={avatar} seed={seed} size={56} />
      {who && <p className="wa-newgroup-who">{who}</p>}
      <p className="wa-newgroup-meta">{members > 0 ? t('members', { n: members }) : t('groupOnly')}</p>
      {actions.length > 0 && (
        <div className="wa-newgroup-actions">
          {actions.map((a) => (
            <button key={a.key} type="button" className="wa-newgroup-action" onClick={a.onSelect}>
              <span className="wa-newgroup-icon" aria-hidden="true">
                {a.icon}
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <p className="wa-newgroup-hint">{t('hint')}</p>
    </section>
  );
}
