'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Lo que devuelve el 409 `contact_email_taken`: null = existe pero esta persona no lo ve. */
export type EmailTakenExisting = { id: string; name: string } | null;

/** Lee el 409 de crear o editar un contacto. undefined = la respuesta no es ese error. */
export function emailTakenFrom(data: unknown): EmailTakenExisting | undefined {
  const d = data as { error?: string; existing?: { id?: string; name?: string } | null } | null;
  if (d?.error !== 'contact_email_taken') return undefined;
  return d.existing?.id ? { id: d.existing.id, name: d.existing.name ?? '' } : null;
}

/**
 * Aviso de "ya hay un contacto con este email". Nombra al existente y lo
 * enlaza solo si el servidor lo mandó (quien mira lo puede ver); si no, dice
 * que existe y a quién pedirle.
 */
export default function EmailTakenNotice({
  existing,
  onOpen,
  className = 'ui-error',
}: {
  existing: EmailTakenExisting;
  /** Al seguir el enlace (para cerrar el modal que lo muestra). */
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <p className={`${className} email-taken`} role="alert">
      <EmailTakenText existing={existing} onOpen={onOpen} />
    </p>
  );
}

/** El texto y el enlace solos, para un contenedor que ya es el aviso (el pie de un modal). */
export function EmailTakenText({ existing, onOpen }: { existing: EmailTakenExisting; onOpen?: () => void }) {
  const t = useTranslations('crm');
  return (
    <span className="email-taken-text" data-testid="contact-email-taken">
      {existing ? (
        <>
          {t('contacts.emailTaken.exists', { name: existing.name || '—' })}{' '}
          <Link href={`/app/crm/contacts/${existing.id}`} onClick={onOpen} data-testid="contact-email-taken-link">
            {t('contacts.emailTaken.open')}
          </Link>
        </>
      ) : (
        t('contacts.emailTaken.hidden')
      )}
    </span>
  );
}
