'use client';

import type { ChatLineRef } from '@/lib/same-chat';
import LineDot from './LineDot';

/**
 * "Responder desde": el chat está en varias líneas (Lines) o cuentas (Inbox) y
 * se elige por cuál sale la respuesta. Un select nativo: se abre y se cierra
 * como cualquier select del sistema (teclado, Esc, tocar afuera). Con una sola
 * línea no se muestra. Las líneas que no pueden mandar (desconectadas, o que
 * salieron del grupo) se ven deshabilitadas.
 */
export default function ReplyFromSelect({
  lines,
  value,
  onChange,
  label,
  unavailable,
}: {
  lines: ChatLineRef[];
  /** El chat (de la línea) por el que sale. */
  value: string;
  onChange: (chatId: string) => void;
  /** "Responder desde" en el idioma de la app. */
  label: string;
  /** Texto para una línea que no puede mandar. */
  unavailable: string;
}) {
  if (lines.length < 2) return null;
  // El select nativo no dibuja colores en las opciones: el punto de la línea elegida va al lado.
  const picked = lines.find((l) => l.chatId === value);
  return (
    <label className="gr-replyfrom" data-testid="reply-from">
      <span className="gr-replyfrom-label">{label}</span>
      <LineDot color={picked?.color} />
      <select className="select gr-replyfrom-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {lines.map((l) => (
          <option key={l.chatId} value={l.chatId} disabled={!l.canSend}>
            {l.canSend ? l.name : `${l.name} (${unavailable})`}
          </option>
        ))}
      </select>
    </label>
  );
}
