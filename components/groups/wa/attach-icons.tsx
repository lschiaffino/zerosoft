/**
 * Íconos del menú de adjuntar, como los de WhatsApp: rellenos, de un color
 * cada uno (el color lo pone el CSS con currentColor). Dibujos propios.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Fill({ size = 22, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

/** Hoja con la esquina doblada. */
export const AttachDocIcon = (p: P) => (
  <Fill {...p}>
    <path d="M6 2.5h7.6c.4 0 .8.2 1.1.4l4.4 4.4c.3.3.4.7.4 1.1V20c0 .8-.7 1.5-1.5 1.5H6c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5Z" />
    <path d="M13.5 2.8V7c0 .8.7 1.5 1.5 1.5h4.2" fill="#fff" fillOpacity=".45" />
    <path d="M8 12.5h8M8 15.5h8M8 18.5h5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </Fill>
);

/** Foto: un cuadro con montaña y sol. */
export const AttachMediaIcon = (p: P) => (
  <Fill {...p}>
    <rect x="2.5" y="4" width="19" height="16" rx="3" />
    <circle cx="8.5" cy="9.5" r="1.9" fill="#fff" />
    <path d="M4 18.2 9 13l3.2 3.1 3.1-3.6L20 18.2Z" fill="#fff" />
  </Fill>
);

/** Cámara de fotos. */
export const AttachCameraIcon = (p: P) => (
  <Fill {...p}>
    <path d="M8.6 4.5h6.8l1.5 2.2H20c.8 0 1.5.7 1.5 1.5v10.3c0 .8-.7 1.5-1.5 1.5H4c-.8 0-1.5-.7-1.5-1.5V8.2c0-.8.7-1.5 1.5-1.5h3.1Z" />
    <circle cx="12" cy="13.2" r="4.1" fill="#fff" />
    <circle cx="12" cy="13.2" r="2.4" />
  </Fill>
);

/** Auriculares. */
export const AttachAudioIcon = (p: P) => (
  <Fill {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 0-8.5 8.5v5.5c0 1.1.9 2 2 2H7c.8 0 1.5-.7 1.5-1.5v-4c0-.8-.7-1.5-1.5-1.5H5.6V12a6.4 6.4 0 0 1 12.8 0v.5H17c-.8 0-1.5.7-1.5 1.5v4c0 .8.7 1.5 1.5 1.5h1.5c1.1 0 2-.9 2-2V12A8.5 8.5 0 0 0 12 3.5Z" />
  </Fill>
);

/** Persona. */
export const AttachContactIcon = (p: P) => (
  <Fill {...p}>
    <circle cx="12" cy="8" r="4.3" />
    <path d="M3.8 20c.6-4 4-6.6 8.2-6.6s7.6 2.6 8.2 6.6c.1.6-.4 1-1 1H4.8c-.6 0-1.1-.4-1-1Z" />
  </Fill>
);

/** Encuesta: barras horizontales. */
export const AttachPollIcon = (p: P) => (
  <Fill {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3.5" />
    <path d="M7 8h7M7 12h10M7 16h4.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
  </Fill>
);

/** Sticker: un cuadrado con la esquina despegada. */
export const AttachStickerIcon = (p: P) => (
  <Fill {...p}>
    <path d="M6 3h12c1.7 0 3 1.3 3 3v7.2L13.2 21H6c-1.7 0-3-1.3-3-3V6c0-1.7 1.3-3 3-3Z" />
    <path d="M21 13.2h-4.8c-1.6 0-3 1.4-3 3V21" fill="#fff" fillOpacity=".5" />
    <circle cx="9" cy="9.5" r="1.2" fill="#fff" />
    <circle cx="15" cy="9.5" r="1.2" fill="#fff" />
    <path d="M8.6 13.4c.9 1 2 1.5 3.4 1.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </Fill>
);
