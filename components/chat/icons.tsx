/**
 * Íconos de Chat: trazo de 2px, misma caja de 24 que components/app/icons.
 * Reemplazan los glifos Unicode (📎 ⊕ ‹ › ↑ ↓ ×) que hacían de íconos.
 */
type ChatIconName = 'attach' | 'up' | 'down' | 'close' | 'back' | 'copy' | 'trash' | 'plus' | 'bot' | 'system';

const PATHS: Record<ChatIconName, string> = {
  attach: 'M20 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 6l-6 6 6 6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  // Bot: cabeza cuadrada con antena. Sistema: placa con una marca de aviso.
  bot: 'M5 9h14v10H5zM12 4v5M9 13v2M15 13v2',
  system: 'M5 5h14v14H5zM12 8v5M12 15.5v.5',
};

export default function ChatIcon({ name, size = 16 }: { name: ChatIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Iniciales para la placa (cuadrada) del visitante o del agente. */
export function initials(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name || email || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || '?';
  const parts = base.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}
