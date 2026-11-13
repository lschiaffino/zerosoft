/**
 * "Visualización" de los chats de WhatsApp (Inbox y Lines), por persona:
 * tamaño del texto, densidad de la lista, vista previa de links, tamaño de
 * fotos y videos, avatares en grupos, ancho de las burbujas y fondo del chat.
 * Puro (lo usan el servidor, que lo guarda en users.chat_display, y el
 * cliente, que lo aplica al instante con displayCss).
 *
 * Los valores por defecto son los de antes de que existiera el ajuste: nadie
 * ve un cambio hasta que toca algo.
 */

export const DISPLAY_OPTIONS = {
  textSize: ['small', 'default', 'large'],
  density: ['comfortable', 'compact'],
  linkPreviews: ['large', 'compact', 'off'],
  mediaSize: ['small', 'default', 'large'],
  bubbleWidth: ['default', 'wide'],
  wallpaper: ['pattern', 'plain'],
} as const;

type Options = typeof DISPLAY_OPTIONS;
export type DisplayChoice = keyof Options;

export type ChatDisplay = { [K in DisplayChoice]: Options[K][number] } & {
  /** Foto de quien escribe al lado de sus mensajes en los grupos. */
  groupAvatars: boolean;
};

export const DEFAULT_DISPLAY: ChatDisplay = {
  textSize: 'default',
  density: 'comfortable',
  linkPreviews: 'large',
  mediaSize: 'default',
  bubbleWidth: 'default',
  wallpaper: 'pattern',
  groupAvatars: true,
};

/** Lo guardado o lo que manda el cliente → un ajuste válido (lo desconocido vuelve al valor por defecto). */
export function cleanDisplay(raw: unknown): ChatDisplay {
  let o: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) o = parsed as Record<string, unknown>;
    } catch {
      o = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) o = raw as Record<string, unknown>;
  const out = { ...DEFAULT_DISPLAY } as Record<string, unknown>;
  for (const key of Object.keys(DISPLAY_OPTIONS) as DisplayChoice[]) {
    const v = o[key];
    if (typeof v === 'string' && (DISPLAY_OPTIONS[key] as readonly string[]).includes(v)) out[key] = v;
  }
  if (typeof o.groupAvatars === 'boolean') out.groupAvatars = o.groupAvatars;
  return out as ChatDisplay;
}

/** Aplica un cambio parcial (solo claves conocidas y valores válidos). */
export function patchDisplay(current: ChatDisplay, patch: unknown): ChatDisplay {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current;
  return cleanDisplay({ ...current, ...(patch as Record<string, unknown>) });
}

export function isDefaultDisplay(d: ChatDisplay): boolean {
  return (Object.keys(DEFAULT_DISPLAY) as Array<keyof ChatDisplay>).every((k) => d[k] === DEFAULT_DISPLAY[k]);
}

/** Escala de texto: los mismos tokens de styles/groups-wa.css por un factor. */
const TEXT_SCALE: Record<ChatDisplay['textSize'], number> = { small: 0.92, default: 1, large: 1.16 };
const FS_BASE: Record<string, number> = {
  '--wa-fs-name': 0.9375,
  '--wa-fs-ui': 0.875,
  '--wa-fs-body': 0.84375,
  '--wa-fs-preview': 0.8125,
  '--wa-fs-small': 0.75,
  '--wa-fs-meta': 0.6875,
  '--wa-fs-tiny': 0.65625,
};
const MEDIA_W: Record<ChatDisplay['mediaSize'], number> = { small: 220, default: 300, large: 400 };

/**
 * CSS del ajuste (va en un <style> del proveedor, así vale también para lo
 * que se abre en un portal). Solo sale de valores fijos de esta tabla: nada
 * de lo que escribe la persona llega acá. '' con todo por defecto.
 */
export function displayCss(d: ChatDisplay): string {
  const vars: string[] = [];
  const rules: string[] = [];
  const f = TEXT_SCALE[d.textSize];
  if (f !== 1) {
    for (const [k, rem] of Object.entries(FS_BASE)) vars.push(`${k}:${+(rem * f).toFixed(4)}rem`);
    vars.push(`--wa-lh-body:${Math.round(18 * f)}px`);
  }
  if (d.mediaSize !== 'default') vars.push(`--wa-media-w:${MEDIA_W[d.mediaSize]}px`);
  if (d.density === 'compact') {
    vars.push('--wa-row-h:52px', '--wa-avatar:38px', '--wa-row-gap:10px');
    rules.push(
      '.gr-inbox .gr-row>.wa-avatar,.gr-inbox .ib-row-btn>.wa-avatar{width:38px!important;height:38px!important;font-size:14px!important}',
      '.gr-inbox .gr-row-main,.gr-inbox .wa-row-main{padding-top:5px;padding-bottom:5px}',
    );
  }
  if (!d.groupAvatars) {
    rules.push('.gr-inbox .gr-msg.has-avatar{padding-left:0}', '.gr-inbox .wa-sender-avatar{display:none}');
  }
  if (d.bubbleWidth === 'wide') rules.push('@media (min-width:1024px){.gr-inbox .gr-msg{max-width:82%}}');
  if (d.wallpaper === 'plain') rules.push('.gr-inbox .wa-messages{background-image:none}');
  return [vars.length ? `:root{${vars.join(';')}}` : '', ...rules].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Vista previa de links: grande (imagen arriba) o compacta (imagen al costado)
// ---------------------------------------------------------------------------

export type LinkLayout = 'large' | 'compact' | 'text' | 'none';

/**
 * Qué tarjeta lleva un link, como WhatsApp: la imagen grande arriba cuando
 * la imagen es grande; la compacta (miniatura al costado) con logos, íconos
 * o imágenes chicas; solo texto sin imagen; nada con las vistas previas
 * apagadas. Sin medidas conocidas se va a lo seguro (compacta).
 */
export function linkLayout(d: { image?: string; imageWidth?: number; imageHeight?: number }, pref: ChatDisplay['linkPreviews'] = 'large'): LinkLayout {
  if (pref === 'off') return 'none';
  if (!d.image) return 'text';
  if (pref === 'compact') return 'compact';
  const w = Number(d.imageWidth) || 0;
  const h = Number(d.imageHeight) || 0;
  if (!w || !h) return 'compact';
  // Chicas: logos, favicons, miniaturas.
  if (w < 300 || h < 150) return 'compact';
  // Cuadradas medianas (logo de una marca, avatar): compacta. Las cuadradas grandes (una foto) van grandes.
  const ratio = w / h;
  if (ratio > 0.8 && ratio < 1.25 && w < 480) return 'compact';
  return 'large';
}

/** Proporción con la que se muestra la imagen grande: entre 4:5 (las muy altas se recortan) y 2.4:1 (las muy anchas). */
export function linkImageRatio(w?: number, h?: number): number {
  const r = w && h ? w / h : 1.91;
  return Math.min(2.4, Math.max(0.8, r));
}
