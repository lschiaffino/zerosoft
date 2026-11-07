/**
 * Íconos de la bandeja estilo WhatsApp Web (trazos propios, sin marcas).
 * Todos decorativos salvo que se pase `label`.
 */
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number; label?: string };

function Svg({ size = 20, label, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Tilde de entrega: uno (enviado), dos grises (entregado), dos azules (leído), reloj (enviando), alerta (falló). */
export function Ticks({ status, label }: { status: string; label: string }) {
  if (status === 'failed') {
    return (
      <span className="wa-ticks is-failed" title={label}>
        <Svg size={15} strokeWidth={2.2}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.5v.01" />
        </Svg>
        <span className="wa-sr">{label}</span>
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="wa-ticks" title={label}>
        <Svg size={14} strokeWidth={2}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </Svg>
        <span className="wa-sr">{label}</span>
      </span>
    );
  }
  const double = status === 'delivered' || status === 'read';
  return (
    <span className={`wa-ticks${status === 'read' ? ' is-read' : ''}`} title={label}>
      <svg width={double ? 18 : 14} height="12" viewBox={double ? '0 0 18 12' : '0 0 14 12'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {double ? (
          <>
            <path d="M1.5 6.5 4.8 9.8 11.5 2.2" />
            <path d="M7.4 9.4l.4.4 6.7-7.6" />
          </>
        ) : (
          <path d="M2 6.5 5.3 9.8 12 2.2" />
        )}
      </svg>
      <span className="wa-sr">{label}</span>
    </span>
  );
}

export const Chevron = (p: P) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="m7 10 5 5 5-5" />
  </Svg>
);
export const Smiley = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2" />
    <path d="M9 9.8v.01M15 9.8v.01" strokeWidth={2.6} />
  </Svg>
);
export const Plus = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const Mic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);
export const SendIcon = (p: P) => (
  <svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z" />
  </svg>
);
export const Search = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Svg>
);
export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 4 4H6l4-4zM12 14v7" />
  </Svg>
);
export const MuteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6.5 9H3.5v6h3l4.5 4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </Svg>
);
export const DocIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3h7.5l4.5 4.5V21h-12z" />
    <path d="M14 3v4.5h4.5" />
  </Svg>
);
export const PhotoIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 16-5-5-8.5 8.5" />
  </Svg>
);
export const PollIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 20V10M12 20V4M19 20v-7" />
  </Svg>
);
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const Play = (p: P) => (
  <svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);
export const Pause = (p: P) => (
  <svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
  </svg>
);
export const Trash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Svg>
);
export const Close = (p: P) => (
  <Svg strokeWidth={2.1} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const Download = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </Svg>
);
export const Lock = (p: P) => (
  <Svg strokeWidth={2.1} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="1.5" />
    <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </Svg>
);
export const Ban = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Svg>
);
export const Forwarded = (p: P) => (
  <Svg {...p}>
    <path d="M14 5l6 6-6 6M20 11H10a6 6 0 0 0-6 6v1" />
  </Svg>
);
export const MapPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);
export const Person = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20.5c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8" />
  </Svg>
);
export const GroupIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M15 15c2.6 0 4.6 1.2 5.5 3.5" />
  </Svg>
);
export const ArrowDown = (p: P) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const Sparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z" />
    <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </Svg>
);
export const Note = (p: P) => (
  <Svg {...p}>
    <path d="M5 4h14v11l-5 5H5z" />
    <path d="M14 20v-5h5" />
  </Svg>
);
export const Ticket = (p: P) => (
  <Svg {...p}>
    <path d="M4 7.5h16v3a1.5 1.5 0 0 0 0 3v3H4v-3a1.5 1.5 0 0 0 0-3z" />
    <path d="M14 7.5v9" strokeDasharray="1.5 2" />
  </Svg>
);
export const Panel = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M15 4.5v15" />
  </Svg>
);
