/**
 * Social: las redes que se conectan y sus reglas (puro: lo usan el servidor,
 * el compositor en el navegador y los tests).
 *
 * Los límites salen de la documentación pública de cada API (revisada el
 * 2026-10-29) y del tope de subida de la suite (10 MB por archivo). Donde la
 * red permite más que nuestra subida, manda la subida.
 */

export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'threads', 'bluesky'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export function isSocialNetwork(v: unknown): v is SocialNetwork {
  return typeof v === 'string' && (SOCIAL_NETWORKS as readonly string[]).includes(v);
}

/** Lo que llega por la bandeja de cada red (donde la API lo permite). */
export type InboxKind = 'comment' | 'mention' | 'dm';

export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  mime: string;
  size: number;
  name?: string;
  width?: number | null;
  height?: number | null;
  /** Segundos (videos). */
  duration?: number | null;
}

export interface NetworkSpec {
  name: string;
  /** Proveedor OAuth (Facebook e Instagram comparten la app de Meta). */
  provider: 'meta' | 'linkedin' | 'x' | 'tiktok' | 'google' | 'threads' | 'bluesky';
  /** Variables de entorno de la app de desarrollador (null = no hace falta: Bluesky usa contraseña de app). */
  env: [string, string] | null;
  /** Límite de texto y cómo se cuenta. */
  limit: number;
  count: 'chars' | 'x' | 'graphemes';
  /** La red exige algo adjunto. */
  requiresMedia: false | 'any' | 'video';
  maxImages: number;
  maxVideos: number;
  /** Se pueden mezclar fotos y video en la misma publicación. */
  mix: boolean;
  imageMaxBytes: number;
  videoMaxBytes: number;
  imageTypes: readonly string[];
  videoMinSec: number;
  videoMaxSec: number;
  /** Relación de aspecto aceptada (ancho / alto) para fotos y video; null = cualquiera. */
  imageAspect: [number, number] | null;
  videoAspect: [number, number] | null;
  firstComment: boolean;
  inbox: readonly InboxKind[];
  /** Qué hace falta del plan de la red para la bandeja (se muestra tal cual). */
  inboxNote?: 'x_paid';
}

const MB = 1024 * 1024;
/** Tope de la subida de la suite (lib/uploads.ts MAX_UPLOAD_SIZE). */
export const SOCIAL_UPLOAD_MAX = 10 * MB;
const RASTER = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export const NETWORK_SPECS: Record<SocialNetwork, NetworkSpec> = {
  facebook: {
    name: 'Facebook',
    provider: 'meta',
    env: ['META_APP_ID', 'META_APP_SECRET'],
    limit: 63206,
    count: 'chars',
    requiresMedia: false,
    maxImages: 10,
    maxVideos: 1,
    mix: false,
    imageMaxBytes: 10 * MB,
    videoMaxBytes: SOCIAL_UPLOAD_MAX,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    videoMinSec: 1,
    videoMaxSec: 240 * 60,
    imageAspect: null,
    videoAspect: null,
    firstComment: true,
    inbox: ['comment', 'dm'],
  },
  instagram: {
    name: 'Instagram',
    provider: 'meta',
    env: ['META_APP_ID', 'META_APP_SECRET'],
    limit: 2200,
    count: 'chars',
    requiresMedia: 'any',
    maxImages: 10,
    maxVideos: 1,
    mix: false,
    imageMaxBytes: 8 * MB,
    videoMaxBytes: SOCIAL_UPLOAD_MAX,
    // La API de publicación de Instagram solo acepta JPEG.
    imageTypes: ['image/jpeg'],
    videoMinSec: 3,
    videoMaxSec: 15 * 60,
    imageAspect: [0.8, 1.91],
    videoAspect: [0.01, 10],
    firstComment: true,
    inbox: ['comment', 'dm'],
  },
  linkedin: {
    name: 'LinkedIn',
    provider: 'linkedin',
    env: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    limit: 3000,
    count: 'chars',
    requiresMedia: false,
    maxImages: 20,
    maxVideos: 1,
    mix: false,
    imageMaxBytes: 10 * MB,
    videoMaxBytes: SOCIAL_UPLOAD_MAX,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    videoMinSec: 3,
    videoMaxSec: 30 * 60,
    imageAspect: null,
    videoAspect: [1 / 2.4, 2.4],
    firstComment: true,
    inbox: ['comment'],
  },
  x: {
    name: 'X',
    provider: 'x',
    env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    limit: 280,
    count: 'x',
    requiresMedia: false,
    maxImages: 4,
    // Video en X pide la subida por partes: todavía no.
    maxVideos: 0,
    mix: false,
    imageMaxBytes: 5 * MB,
    videoMaxBytes: 0,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    videoMinSec: 0,
    videoMaxSec: 0,
    imageAspect: null,
    videoAspect: null,
    firstComment: true,
    inbox: ['mention'],
    inboxNote: 'x_paid',
  },
  tiktok: {
    name: 'TikTok',
    provider: 'tiktok',
    env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    limit: 2200,
    count: 'chars',
    requiresMedia: 'video',
    maxImages: 0,
    maxVideos: 1,
    mix: false,
    imageMaxBytes: 0,
    videoMaxBytes: SOCIAL_UPLOAD_MAX,
    imageTypes: [],
    videoMinSec: 3,
    videoMaxSec: 10 * 60,
    imageAspect: null,
    videoAspect: null,
    firstComment: false,
    inbox: [],
  },
  youtube: {
    name: 'YouTube',
    provider: 'google',
    env: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
    // Descripción; el título es la primera línea (hasta 100).
    limit: 5000,
    count: 'chars',
    requiresMedia: 'video',
    maxImages: 0,
    maxVideos: 1,
    mix: false,
    imageMaxBytes: 0,
    videoMaxBytes: SOCIAL_UPLOAD_MAX,
    imageTypes: [],
    videoMinSec: 1,
    videoMaxSec: 12 * 60 * 60,
    imageAspect: null,
    videoAspect: null,
    firstComment: true,
    inbox: ['comment'],
  },
  threads: {
    name: 'Threads',
    provider: 'threads',
    env: ['THREADS_APP_ID', 'THREADS_APP_SECRET'],
    limit: 500,
    count: 'chars',
    requiresMedia: false,
    maxImages: 10,
    maxVideos: 1,
    mix: false,
    imageMaxBytes: 8 * MB,
    videoMaxBytes: SOCIAL_UPLOAD_MAX,
    imageTypes: ['image/jpeg', 'image/png'],
    videoMinSec: 1,
    videoMaxSec: 5 * 60,
    imageAspect: [0.01, 10],
    videoAspect: [0.01, 10],
    firstComment: true,
    inbox: ['comment'],
  },
  bluesky: {
    name: 'Bluesky',
    provider: 'bluesky',
    env: null,
    limit: 300,
    count: 'graphemes',
    requiresMedia: false,
    maxImages: 4,
    maxVideos: 0,
    mix: false,
    imageMaxBytes: 1 * MB,
    videoMaxBytes: 0,
    imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    videoMinSec: 0,
    videoMaxSec: 0,
    imageAspect: null,
    videoAspect: null,
    firstComment: true,
    inbox: ['comment', 'mention'],
  },
};

/** Modo falso (e2e y demo): todas las redes "configuradas" y nada sale a internet. */
export function socialFake(env: Record<string, string | undefined> = process.env): boolean {
  if (env.SOCIAL_FAKE !== '1') return false;
  return env.NODE_ENV === 'test' || env.DEMO_MODE === 'true';
}

/** ¿La instancia tiene la app de desarrollador de esta red? */
export function networkConfigured(network: SocialNetwork, env: Record<string, string | undefined> = process.env): boolean {
  if (socialFake(env)) return true;
  const spec = NETWORK_SPECS[network];
  if (!spec.env) return true;
  return Boolean(env[spec.env[0]]?.trim() && env[spec.env[1]]?.trim());
}

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;

/** Largo del texto como lo cuenta la red (X: cada link vale 23; Bluesky: grafemas). */
export function countText(network: SocialNetwork, text: string): number {
  const spec = NETWORK_SPECS[network];
  if (spec.count === 'x') {
    let n = 0;
    const withoutUrls = text.replace(URL_RE, () => {
      n += 23;
      return '';
    });
    // X pesa doble los caracteres CJK y los emoji; el resto, uno.
    for (const ch of withoutUrls) n += /[ᄀ-ￜ]|[\u{1F000}-\u{1FFFF}]/u.test(ch) ? 2 : 1;
    return n;
  }
  if (spec.count === 'graphemes') {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
    if (Seg) return [...new Seg(undefined, { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length;
}

export type ValidationIssue =
  | { code: 'empty' }
  | { code: 'too_long'; limit: number; count: number }
  | { code: 'media_required' }
  | { code: 'video_required' }
  | { code: 'images_not_supported' }
  | { code: 'video_not_supported' }
  | { code: 'too_many_images'; max: number }
  | { code: 'too_many_videos'; max: number }
  | { code: 'mixed_media' }
  | { code: 'image_type'; name: string; types: string }
  | { code: 'image_too_large'; name: string; maxMb: number }
  | { code: 'video_too_large'; name: string; maxMb: number }
  | { code: 'video_too_short'; name: string; min: number }
  | { code: 'video_too_long'; name: string; max: number }
  | { code: 'aspect_ratio'; name: string; min: string; max: string };

const mb = (bytes: number) => Math.round((bytes / MB) * 10) / 10;
const ratio = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Lo que impide publicar este texto y estos archivos en la red. Vacío = se
 * puede. La duración y las medidas las manda el navegador al subir; si
 * faltan, no se valida esa parte (la red lo rechaza y queda el error).
 */
export function validateForNetwork(network: SocialNetwork, text: string, media: readonly MediaItem[] = []): ValidationIssue[] {
  const spec = NETWORK_SPECS[network];
  const issues: ValidationIssue[] = [];
  const images = media.filter((m) => m.type === 'image');
  const videos = media.filter((m) => m.type === 'video');
  if (!text.trim() && media.length === 0) issues.push({ code: 'empty' });
  const count = countText(network, text);
  if (count > spec.limit) issues.push({ code: 'too_long', limit: spec.limit, count });
  if (spec.requiresMedia === 'any' && media.length === 0) issues.push({ code: 'media_required' });
  if (spec.requiresMedia === 'video' && videos.length === 0) issues.push({ code: 'video_required' });
  if (images.length && spec.maxImages === 0) issues.push({ code: 'images_not_supported' });
  else if (images.length > spec.maxImages) issues.push({ code: 'too_many_images', max: spec.maxImages });
  if (videos.length && spec.maxVideos === 0) issues.push({ code: 'video_not_supported' });
  else if (videos.length > spec.maxVideos) issues.push({ code: 'too_many_videos', max: spec.maxVideos });
  if (!spec.mix && images.length && videos.length) issues.push({ code: 'mixed_media' });
  for (const m of images) {
    const name = m.name || 'image';
    if (spec.maxImages === 0) break;
    if (spec.imageTypes.length && !spec.imageTypes.includes(m.mime)) {
      issues.push({ code: 'image_type', name, types: spec.imageTypes.map((t) => t.replace('image/', '').toUpperCase()).join(', ') });
    }
    if (m.size > spec.imageMaxBytes) issues.push({ code: 'image_too_large', name, maxMb: mb(spec.imageMaxBytes) });
    if (spec.imageAspect && m.width && m.height) {
      const r = m.width / m.height;
      if (r < spec.imageAspect[0] - 0.005 || r > spec.imageAspect[1] + 0.005) {
        issues.push({ code: 'aspect_ratio', name, min: ratio(spec.imageAspect[0]), max: ratio(spec.imageAspect[1]) });
      }
    }
  }
  for (const m of videos) {
    const name = m.name || 'video';
    if (spec.maxVideos === 0) break;
    if (m.size > spec.videoMaxBytes) issues.push({ code: 'video_too_large', name, maxMb: mb(spec.videoMaxBytes) });
    if (m.duration != null && m.duration > 0) {
      if (m.duration < spec.videoMinSec) issues.push({ code: 'video_too_short', name, min: spec.videoMinSec });
      if (m.duration > spec.videoMaxSec) issues.push({ code: 'video_too_long', name, max: spec.videoMaxSec });
    }
    if (spec.videoAspect && m.width && m.height) {
      const r = m.width / m.height;
      if (r < spec.videoAspect[0] - 0.005 || r > spec.videoAspect[1] + 0.005) {
        issues.push({ code: 'aspect_ratio', name, min: ratio(spec.videoAspect[0]), max: ratio(spec.videoAspect[1]) });
      }
    }
  }
  return issues;
}

/** Hashtags (#tag) y menciones (@handle) del texto, sin repetir. */
export function extractTags(text: string): { hashtags: string[]; mentions: string[] } {
  const hashtags = [...new Set([...text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,100})/gu)].map((m) => m[2]))];
  const mentions = [...new Set([...text.matchAll(/(^|\s)@([A-Za-z0-9_.-]{1,100})/g)].map((m) => m[2]))];
  return { hashtags, mentions };
}

/** Texto final para una cuenta: el propio de la red si lo hay, si no el común. */
export function textFor(base: string, override: string | null | undefined): string {
  return override != null && override !== '' ? override : base;
}
