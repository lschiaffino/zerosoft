/**
 * Embeds de Docs: de un link pegado a la URL del iframe del proveedor. Puro
 * (lo usan el editor, la vista de lectura y el servidor). El iframe se arma
 * siempre desde el link original con estas reglas: nunca se guarda ni se
 * acepta una URL de iframe que mande el cliente, así que solo se embeben
 * estos hosts y por https.
 */

export type EmbedProvider =
  | 'youtube'
  | 'vimeo'
  | 'loom'
  | 'figma'
  | 'google_maps'
  | 'google_docs'
  | 'google_drive'
  | 'codepen'
  | 'codesandbox'
  | 'twitter'
  | 'gist'
  | 'spotify'
  | 'miro'
  | 'excalidraw'
  | 'typeform'
  | 'airtable'
  | 'calendly';

export interface EmbedInfo {
  provider: EmbedProvider;
  /** Nombre visible del proveedor. */
  label: string;
  /** URL del iframe (src); para gist, srcdoc. */
  src?: string;
  srcdoc?: string;
  /** Alto por defecto del iframe en px. */
  height: number;
  /** Proporción fija (video): el alto sale del ancho. */
  aspect?: number;
  /** Permisos del iframe (atributo sandbox). */
  sandbox: string;
  allow?: string;
}

const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation';

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u;
  } catch {
    return null;
  }
}

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, '');
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function youtubeId(u: URL): string | null {
  const h = host(u);
  if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
    return m?.[1] ?? null;
  }
  return null;
}

/** Segundos de un `t=` de YouTube ("90", "1m30s"). */
function youtubeStart(u: URL): number {
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Info del embed para un link, o null si el host no se embebe (queda como bookmark). */
export function embedFor(raw: string): EmbedInfo | null {
  const u = parse(raw);
  if (!u) return null;
  const h = host(u);
  const video = { height: 360, aspect: 16 / 9, sandbox: SANDBOX, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen' };

  const yt = youtubeId(u);
  if (yt && ID.test(yt)) {
    const start = youtubeStart(u);
    return { provider: 'youtube', label: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${yt}${start ? `?start=${start}` : ''}`, ...video };
  }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const m = u.pathname.match(/(?:^|\/)(\d{4,})(?:\/([A-Za-z0-9]+))?/);
    if (m) {
      const hash = m[2] && !/^\d+$/.test(m[2]) ? `?h=${m[2]}` : '';
      return { provider: 'vimeo', label: 'Vimeo', src: `https://player.vimeo.com/video/${m[1]}${hash}`, ...video };
    }
  }
  if (h === 'loom.com') {
    const m = u.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{16,64})/i);
    if (m) return { provider: 'loom', label: 'Loom', src: `https://www.loom.com/embed/${m[1]}`, ...video };
  }
  if (h === 'figma.com') {
    if (/^\/(file|design|proto|board|slides|deck)\//.test(u.pathname)) {
      const clean = `https://www.figma.com${u.pathname}${u.search}`;
      return { provider: 'figma', label: 'Figma', src: `https://www.figma.com/embed?embed_host=zerosoft&url=${encodeURIComponent(clean)}`, height: 450, sandbox: SANDBOX, allow: 'fullscreen' };
    }
  }
  if ((h === 'google.com' || h.endsWith('.google.com')) && u.pathname.startsWith('/maps')) {
    const q = u.searchParams.get('q') ?? decodeURIComponent(u.pathname.match(/\/place\/([^/]+)/)?.[1] ?? '').replace(/\+/g, ' ');
    const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const query = q || (at ? `${at[1]},${at[2]}` : '');
    if (query) return { provider: 'google_maps', label: 'Google Maps', src: `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`, height: 360, sandbox: SANDBOX };
  }
  if (h === 'maps.app.goo.gl' || h === 'goo.gl') return null;
  if (h === 'docs.google.com') {
    const m = u.pathname.match(/^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([A-Za-z0-9_-]+)/);
    if (m) {
      const [, kind, published, id] = m;
      const tail = kind === 'presentation' ? (published ? '/embed' : '/embed') : kind === 'forms' ? '/viewform?embedded=true' : published ? '/pubhtml?widget=true' : '/preview';
      return { provider: 'google_docs', label: 'Google Docs', src: `https://docs.google.com/${kind}/d/${published ?? ''}${id}${tail}`, height: kind === 'presentation' ? 400 : 560, sandbox: SANDBOX, allow: 'fullscreen' };
    }
  }
  if (h === 'drive.google.com') {
    const m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m) return { provider: 'google_drive', label: 'Google Drive', src: `https://drive.google.com/file/d/${m[1]}/preview`, height: 480, sandbox: SANDBOX, allow: 'autoplay; fullscreen' };
  }
  if (h === 'codepen.io') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(?:pen|full|details|embed)\/([A-Za-z0-9]+)/);
    if (m) return { provider: 'codepen', label: 'CodePen', src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, height: 420, sandbox: SANDBOX };
  }
  if (h === 'codesandbox.io') {
    const m = u.pathname.match(/^\/(?:s|p\/sandbox|embed)\/([A-Za-z0-9_-]+)/);
    if (m) return { provider: 'codesandbox', label: 'CodeSandbox', src: `https://codesandbox.io/embed/${m[1]}`, height: 500, sandbox: SANDBOX };
  }
  if (h === 'twitter.com' || h === 'x.com' || h === 'mobile.twitter.com') {
    const m = u.pathname.match(/^\/[A-Za-z0-9_]{1,30}\/status(?:es)?\/(\d{5,25})/);
    if (m) return { provider: 'twitter', label: 'X', src: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&dnt=true`, height: 560, sandbox: SANDBOX };
  }
  if (h === 'gist.github.com') {
    const m = u.pathname.match(/^\/([A-Za-z0-9-]{1,39})\/([0-9a-f]{8,40})\/?$/i);
    if (m) {
      // Sin iframe propio: el script del gist en un srcdoc aislado (sandbox sin
      // allow-same-origin: no toca nuestro origen).
      const src = `https://gist.github.com/${m[1]}/${m[2]}.js`;
      return {
        provider: 'gist',
        label: 'GitHub Gist',
        srcdoc: `<!doctype html><html><head><base target="_blank"><style>body{margin:0}</style></head><body><script src="${src}"></script></body></html>`,
        height: 360,
        sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox',
      };
    }
  }
  if (h === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) return { provider: 'spotify', label: 'Spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 380, sandbox: SANDBOX, allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' };
  }
  if (h === 'miro.com') {
    const m = u.pathname.match(/^\/app\/board\/([A-Za-z0-9_=-]+)/);
    if (m) return { provider: 'miro', label: 'Miro', src: `https://miro.com/app/live-embed/${m[1]}/`, height: 450, sandbox: SANDBOX, allow: 'fullscreen; clipboard-read; clipboard-write' };
  }
  if (h === 'excalidraw.com' && u.hash.startsWith('#json=')) {
    return { provider: 'excalidraw', label: 'Excalidraw', src: `https://excalidraw.com/${u.hash}`, height: 450, sandbox: SANDBOX };
  }
  if (h.endsWith('.typeform.com') && /^\/to\/[A-Za-z0-9]+/.test(u.pathname)) {
    return { provider: 'typeform', label: 'Typeform', src: `https://${u.hostname}${u.pathname}`, height: 500, sandbox: SANDBOX };
  }
  if (h === 'airtable.com') {
    const m = u.pathname.match(/^\/(?:embed\/)?((?:app[A-Za-z0-9]+\/)?shr[A-Za-z0-9]+)/);
    if (m) return { provider: 'airtable', label: 'Airtable', src: `https://airtable.com/embed/${m[1]}`, height: 533, sandbox: SANDBOX };
  }
  if (h === 'calendly.com') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?\/?$/);
    if (m) return { provider: 'calendly', label: 'Calendly', src: `https://calendly.com/${m[1]}${m[2] ? `/${m[2]}` : ''}?embed_type=Inline`, height: 630, sandbox: SANDBOX };
  }
  return null;
}

/** Link válido para un bookmark o embed (http/https, con host y sin credenciales). */
export function cleanExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const u = parse(raw);
  if (!u || !u.hostname || u.username || u.password) return null;
  return u.toString();
}

/** El texto pegado es un solo link (lo que dispara el menú de pegar como bookmark/embed). */
export function pastedUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  return cleanExternalUrl(t);
}

/** Dominio visible de un link ("figma.com"). */
export function linkSite(raw: string): string {
  const u = parse(raw);
  return u ? host(u) : raw;
}
