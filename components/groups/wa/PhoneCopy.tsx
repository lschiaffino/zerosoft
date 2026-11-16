'use client';

import { formatPhone } from '@/components/inbox/wa/util';
import { visiblePhone } from '@/lib/wa-contact-phone';

/**
 * El teléfono de un contacto en su ficha (Inbox y Lines), como WhatsApp:
 * con formato, debajo del nombre. Un toque o clic lo copia (+ y dígitos) y
 * avisa. Sin teléfono que mostrar (no se sabe, o va oculto para quien mira),
 * no dibuja nada.
 */
export default function PhoneCopy({ phone, copyLabel, onCopied, onFailed }: { phone: string | null | undefined; copyLabel: string; onCopied: () => void; onFailed?: () => void }) {
  const digits = visiblePhone(phone);
  if (!digits) return null;
  const shown = formatPhone(digits);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`+${digits}`);
      onCopied();
    } catch {
      onFailed?.();
    }
  };
  return (
    <button type="button" className="wa-phone-copy" onClick={() => void copy()} aria-label={`${copyLabel}: ${shown}`} title={copyLabel} data-testid="contact-phone">
      <span dir="ltr">{shown}</span>
    </button>
  );
}
