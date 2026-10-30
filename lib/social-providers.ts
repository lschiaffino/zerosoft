/**
 * Social: clientes de las APIs de cada red (server-only).
 *
 * Todo sale por safeFetch y solo a hosts fijos de cada red (API_HOSTS); los
 * tokens van en headers o en el cuerpo, nunca en mensajes de error ni logs.
 * Las llamadas a Graph de Meta llevan appsecret_proof. Los errores se
 * normalizan en SocialApiError con un código (token_expired, rate_limited,
 * invalid_content…) y el texto de la red, para mostrarlo en el destino.
 *
 * Construido contra la documentación pública de cada API (2026-10-29). Sin
 * credenciales reales no se probó contra cuentas vivas: los e2e usan el modo
 * falso (lib/social-fake.ts).
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { safeFetch } from './safe-fetch';
import { localUploadPath } from './uploads';
import type { InboxKind, MediaItem, SocialNetwork } from './social-networks';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export class SocialApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message.slice(0, 300));
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  /** ISO; null = no vence (tokens de página de Meta). */
  expiresAt?: string | null;
  refreshExpiresAt?: string | null;
}

export interface DiscoveredAccount {
  network: SocialNetwork;
  kind: 'page' | 'business' | 'profile' | 'organization' | 'channel';
  externalId: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  followers?: number | null;
  tokens: TokenSet;
  /** Datos no secretos que hacen falta para publicar (página de una cuenta de Instagram, autor de LinkedIn…). */
  meta?: Record<string, unknown>;
}

/** Cuenta lista para llamar a la API (tokens ya descifrados). */
export interface AccountCreds {
  id: string;
  network: SocialNetwork;
  kind: string;
  externalId: string;
  handle: string | null;
  accessToken: string;
  refreshToken: string;
  meta: Record<string, unknown>;
}

export interface PublishInput {
  text: string;
  media: MediaItem[];
  /** Intento (1 = el primero); el modo falso lo usa para simular fallas pasajeras. */
  attempt: number;
}

export type PublishResult = { done: true; externalId: string; url: string | null } | { done: false; ref: string };

export interface FetchedInboxItem {
  kind: InboxKind;
  externalId: string;
  /** Referencia para contestar (conversación, comentario raíz, uri+cid de Bluesky…). */
  threadRef?: string | null;
  /** Publicación nuestra a la que pertenece (external_id del destino). */
  postExternalId?: string | null;
  authorName: string;
  authorHandle?: string | null;
  authorId?: string | null;
  text: string;
  receivedAt: string;
}

export interface PostMetrics {
  impressions?: number | null;
  reach?: number | null;
  engagement?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  clicks?: number | null;
  views?: number | null;
}

export interface AccountMetrics {
  followers?: number | null;
  impressions?: number | null;
  reach?: number | null;
  engagement?: number | null;
}

export interface ReplyTarget {
  kind: InboxKind;
  externalId: string;
  threadRef: string | null;
  authorId: string | null;
}

export interface SocialProvider {
  authorizeUrl(opts: { network: SocialNetwork; state: string; redirectUri: string; challenge: string | null }): string;
  /** PKCE (X y Google lo usan; el resto no lo admite en el flujo web). */
  usesPkce: boolean;
  exchange(opts: { network: SocialNetwork; code: string; redirectUri: string; verifier: string | null }): Promise<DiscoveredAccount[]>;
  refresh?(acc: AccountCreds): Promise<TokenSet | null>;
  publish(acc: AccountCreds, input: PublishInput): Promise<PublishResult>;
  checkPublish?(acc: AccountCreds, ref: string): Promise<PublishResult>;
  comment?(acc: AccountCreds, externalId: string, text: string): Promise<void>;
  fetchInbox?(acc: AccountCreds, opts: { cursor: string | null; posts: string[] }): Promise<{ items: FetchedInboxItem[]; cursor?: string | null }>;
  reply?(acc: AccountCreds, target: ReplyTarget, text: string): Promise<{ externalId: string | null }>;
  postMetrics?(acc: AccountCreds, externalIds: string[]): Promise<Record<string, PostMetrics>>;
  accountMetrics?(acc: AccountCreds): Promise<AccountMetrics>;
}

// ---------- HTTP ----------

/** Hosts a los que Social puede llamar. Cualquier otro se corta antes de salir. */
const API_HOSTS = new Set([
  'graph.facebook.com',
  'www.facebook.com',
  'api.linkedin.com',
  'www.linkedin.com',
  'api.x.com',
  'x.com',
  'open.tiktokapis.com',
  'open-upload.tiktokapis.com',
  'www.tiktok.com',
  'www.googleapis.com',
  'oauth2.googleapis.com',
  'accounts.google.com',
  'graph.threads.net',
  'threads.net',
  'bsky.social',
]);

function allowedHost(host: string): boolean {
  if (API_HOSTS.has(host)) return true;
  // URLs de subida que devuelven las APIs (LinkedIn, TikTok) en subdominios propios.
  return /\.(linkedin|tiktokapis)\.com$/.test(host);
}

/** Host de las subidas públicas de Vercel Blob (los archivos que publicamos). */
function allowedMediaHost(host: string): boolean {
  return /\.public\.blob\.vercel-storage\.com$/.test(host);
}

function classify(status: number, body: Json): SocialApiError {
  const msg = String(
    body?.error?.message ?? body?.error_description ?? body?.message ?? body?.detail ?? body?.title ?? body?.errors?.[0]?.message ?? body?.error ?? `HTTP ${status}`,
  );
  const metaCode = Number(body?.error?.code);
  if (status === 401 || metaCode === 190) return new SocialApiError('token_expired', msg, status);
  if (status === 429 || metaCode === 4 || metaCode === 17 || metaCode === 32 || metaCode === 613) return new SocialApiError('rate_limited', msg, status);
  if (status === 403 || metaCode === 10 || metaCode === 200) return new SocialApiError('not_authorized', msg, status);
  if (status >= 500) return new SocialApiError('network', msg, status);
  if (/duplicate/i.test(msg)) return new SocialApiError('duplicate', msg, status);
  return new SocialApiError('invalid_content', msg, status);
}

async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; body: Json; headers: Headers }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !allowedHost(u.hostname)) throw new SocialApiError('network', `blocked host ${u.hostname}`);
  let res: Response;
  try {
    res = await safeFetch(url, init, init.timeoutMs ?? 20_000);
  } catch {
    throw new SocialApiError('network', `Could not reach ${u.hostname}`);
  }
  const text = await res.text().catch(() => '');
  let body: Json = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw classify(res.status, body);
  return { status: res.status, body, headers: res.headers };
}

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const JSONH = { 'content-type': 'application/json' };
const inSeconds = (s: unknown): string | null => (Number(s) > 0 ? new Date(Date.now() + Number(s) * 1000).toISOString() : null);

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/** URL pública del archivo (Meta y Threads lo bajan ellos). */
export function publicMediaUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${appBase()}${url}`;
}

/** Bytes de un archivo subido (disco local o Vercel Blob). */
export async function readMedia(m: MediaItem): Promise<Buffer> {
  // Solo subidas de Social registradas (social_media): nunca una URL que no subimos nosotros.
  const { isRegisteredMedia } = await import('./social');
  if (!(await isRegisteredMedia(m.url))) throw new SocialApiError('invalid_media', 'Media must be an uploaded file');
  const local = localUploadPath(m.url, 'social');
  if (local) return readFile(local);
  const u = new URL(m.url);
  if (u.protocol !== 'https:' || !allowedMediaHost(u.hostname)) throw new SocialApiError('invalid_media', 'Media must be an uploaded file');
  const res = await safeFetch(m.url, {}, 30_000);
  if (!res.ok) throw new SocialApiError('invalid_media', `Could not read ${m.name ?? 'media'}`);
  return Buffer.from(await res.arrayBuffer());
}

const env = (name: string) => process.env[name]?.trim() ?? '';

// ---------- PKCE ----------

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------- Meta (Facebook e Instagram) ----------

const GRAPH = 'https://graph.facebook.com/v21.0';
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'pages_messaging',
  'read_insights',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'instagram_manage_messages',
];

/** appsecret_proof: HMAC-SHA256 del token con el app secret (Meta lo exige si la app lo pide). */
export function appSecretProof(token: string, secret = env('META_APP_SECRET')): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

function graphUrl(path: string, token: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...params, access_token: token, appsecret_proof: appSecretProof(token) });
  return `${GRAPH}${path}?${q.toString()}`;
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  return (await http(graphUrl(path, token, params))).body;
}

async function graphPost(path: string, token: string, data: Record<string, string>): Promise<Json> {
  return (await http(`${GRAPH}${path}`, { method: 'POST', headers: FORM, body: form({ ...data, access_token: token, appsecret_proof: appSecretProof(token) }) })).body;
}

const meta: SocialProvider = {
  usesPkce: false,
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({ client_id: env('META_APP_ID'), redirect_uri: redirectUri, state, response_type: 'code', scope: META_SCOPES.join(',') });
    return `https://www.facebook.com/v21.0/dialog/oauth?${q.toString()}`;
  },
  async exchange({ network, code, redirectUri }) {
    const short = (
      await http(`${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), redirect_uri: redirectUri, code })}`)
    ).body;
    // Token largo de usuario: los de página que salen de él no vencen.
    const long = (
      await http(
        `${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), fb_exchange_token: String(short.access_token) })}`,
      )
    ).body;
    const userToken = String(long.access_token ?? short.access_token);
    const pages = await graphGet('/me/accounts', userToken, {
      fields: 'id,name,access_token,link,followers_count,picture{url},instagram_business_account{id,username,name,profile_picture_url,followers_count}',
      limit: '100',
    });
    const out: DiscoveredAccount[] = [];
    for (const p of (pages?.data ?? []) as Json[]) {
      const pageToken = String(p.access_token ?? '');
      if (!pageToken) continue;
      if (network === 'facebook') {
        out.push({
          network: 'facebook',
          kind: 'page',
          externalId: String(p.id),
          name: String(p.name ?? ''),
          avatarUrl: p.picture?.data?.url ?? null,
          profileUrl: p.link ?? `https://www.facebook.com/${p.id}`,
          followers: p.followers_count ?? null,
          tokens: { accessToken: pageToken, expiresAt: null },
        });
      }
      const ig = p.instagram_business_account;
      if (network === 'instagram' && ig?.id) {
        out.push({
          network: 'instagram',
          kind: 'business',
          externalId: String(ig.id),
          name: String(ig.name ?? ig.username ?? ''),
          handle: ig.username ?? null,
          avatarUrl: ig.profile_picture_url ?? null,
          profileUrl: ig.username ? `https://www.instagram.com/${ig.username}` : null,
          followers: ig.followers_count ?? null,
          tokens: { accessToken: pageToken, expiresAt: null },
          meta: { pageId: String(p.id) },
        });
      }
    }
    return out;
  },
  async publish(acc, { text, media }) {
    const token = acc.accessToken;
    if (acc.network === 'facebook') {
      const images = media.filter((m) => m.type === 'image');
      const video = media.find((m) => m.type === 'video');
      if (video) {
        const r = await graphPost(`/${acc.externalId}/videos`, token, { file_url: publicMediaUrl(video.url), description: text });
        return { done: true, externalId: String(r.id), url: `https://www.facebook.com/${acc.externalId}/videos/${r.id}` };
      }
      if (images.length === 1) {
        const r = await graphPost(`/${acc.externalId}/photos`, token, { url: publicMediaUrl(images[0].url), caption: text });
        const id = String(r.post_id ?? r.id);
        return { done: true, externalId: id, url: `https://www.facebook.com/${id}` };
      }
      const attached: string[] = [];
      for (const img of images) {
        const r = await graphPost(`/${acc.externalId}/photos`, token, { url: publicMediaUrl(img.url), published: 'false' });
        attached.push(JSON.stringify({ media_fbid: String(r.id) }));
      }
      const data: Record<string, string> = { message: text };
      attached.forEach((a, i) => (data[`attached_media[${i}]`] = a));
      const r = await graphPost(`/${acc.externalId}/feed`, token, data);
      return { done: true, externalId: String(r.id), url: `https://www.facebook.com/${r.id}` };
    }
    // Instagram: contenedor → (procesa) → media_publish.
    const igId = acc.externalId;
    let creation: string;
    if (media.length > 1) {
      const children: string[] = [];
      for (const m of media) {
        const c = await graphPost(`/${igId}/media`, token, m.type === 'video' ? { media_type: 'VIDEO', video_url: publicMediaUrl(m.url), is_carousel_item: 'true' } : { image_url: publicMediaUrl(m.url), is_carousel_item: 'true' });
        children.push(String(c.id));
      }
      creation = String((await graphPost(`/${igId}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: text })).id);
    } else {
      const m = media[0];
      if (!m) throw new SocialApiError('validation', 'Instagram needs a photo or a video');
      const params: Record<string, string> = m.type === 'video' ? { media_type: 'REELS', video_url: publicMediaUrl(m.url), caption: text } : { image_url: publicMediaUrl(m.url), caption: text };
      creation = String((await graphPost(`/${igId}/media`, token, params)).id);
    }
    return (await meta.checkPublish!(acc, creation)) ?? { done: false, ref: creation };
  },
  async checkPublish(acc, ref) {
    if (acc.network !== 'instagram') return { done: false, ref };
    const st = await graphGet(`/${ref}`, acc.accessToken, { fields: 'status_code' });
    if (st?.status_code === 'ERROR' || st?.status_code === 'EXPIRED') throw new SocialApiError('invalid_media', `Instagram could not process the media (${st.status_code})`);
    if (st?.status_code && st.status_code !== 'FINISHED') return { done: false, ref };
    const pub = await graphPost(`/${acc.externalId}/media_publish`, acc.accessToken, { creation_id: ref });
    const id = String(pub.id);
    const link = await graphGet(`/${id}`, acc.accessToken, { fields: 'permalink' }).catch(() => null);
    return { done: true, externalId: id, url: link?.permalink ?? null };
  },
  async comment(acc, externalId, text) {
    await graphPost(`/${externalId}/comments`, acc.accessToken, { message: text });
  },
  async fetchInbox(acc, { posts }) {
    const items: FetchedInboxItem[] = [];
    const token = acc.accessToken;
    for (const postId of posts.slice(0, 20)) {
      if (acc.network === 'facebook') {
        const r = await graphGet(`/${postId}/comments`, token, { fields: 'id,message,from{id,name},created_time', order: 'reverse_chronological', limit: '25' }).catch(() => null);
        for (const c of (r?.data ?? []) as Json[]) {
          if (c.from?.id === acc.externalId) continue;
          items.push({ kind: 'comment', externalId: String(c.id), postExternalId: postId, authorName: c.from?.name ?? 'Facebook user', authorId: c.from?.id ?? null, text: String(c.message ?? ''), receivedAt: String(c.created_time ?? new Date().toISOString()) });
        }
      } else {
        const r = await graphGet(`/${postId}/comments`, token, { fields: 'id,text,username,timestamp,from{id,username}', limit: '25' }).catch(() => null);
        for (const c of (r?.data ?? []) as Json[]) {
          if (c.username && c.username === acc.handle) continue;
          items.push({ kind: 'comment', externalId: String(c.id), postExternalId: postId, authorName: c.username ?? 'Instagram user', authorHandle: c.username ?? null, authorId: c.from?.id ?? null, text: String(c.text ?? ''), receivedAt: String(c.timestamp ?? new Date().toISOString()) });
        }
      }
    }
    // Mensajes directos (Messenger e Instagram) por la página.
    const pageId = acc.network === 'facebook' ? acc.externalId : String(acc.meta.pageId ?? '');
    if (pageId) {
      const conv = await graphGet(`/${pageId}/conversations`, token, {
        platform: acc.network === 'facebook' ? 'messenger' : 'instagram',
        fields: 'id,messages.limit(5){id,message,from,created_time}',
        limit: '10',
      }).catch(() => null);
      for (const c of (conv?.data ?? []) as Json[]) {
        for (const m of (c.messages?.data ?? []) as Json[]) {
          const from = m.from ?? {};
          if (from.id === pageId || from.id === acc.externalId || !m.message) continue;
          items.push({ kind: 'dm', externalId: String(m.id), threadRef: String(c.id), authorName: from.name ?? from.username ?? 'Contact', authorHandle: from.username ?? null, authorId: from.id ?? null, text: String(m.message), receivedAt: String(m.created_time ?? new Date().toISOString()) });
        }
      }
    }
    return { items };
  },
  async reply(acc, target, text) {
    if (target.kind === 'dm') {
      const pageId = acc.network === 'facebook' ? acc.externalId : String(acc.meta.pageId ?? '');
      const r = await http(graphUrl(`/${pageId}/messages`, acc.accessToken), {
        method: 'POST',
        headers: JSONH,
        body: JSON.stringify({ recipient: { id: target.authorId }, message: { text }, messaging_type: 'RESPONSE' }),
      });
      return { externalId: r.body?.message_id ?? null };
    }
    const path = acc.network === 'instagram' ? `/${target.externalId}/replies` : `/${target.externalId}/comments`;
    const r = await graphPost(path, acc.accessToken, { message: text });
    return { externalId: r?.id ? String(r.id) : null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    for (const id of ids.slice(0, 25)) {
      if (acc.network === 'facebook') {
        const base = await graphGet(`/${id}`, acc.accessToken, { fields: 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares' }).catch(() => null);
        const ins = await graphGet(`/${id}/insights`, acc.accessToken, { metric: 'post_impressions,post_impressions_unique,post_clicks' }).catch(() => null);
        const val = (name: string) => Number((ins?.data as Json[] | undefined)?.find((d) => d.name === name)?.values?.[0]?.value ?? 0) || null;
        const likes = Number(base?.reactions?.summary?.total_count ?? 0);
        const comments = Number(base?.comments?.summary?.total_count ?? 0);
        const shares = Number(base?.shares?.count ?? 0);
        out[id] = { impressions: val('post_impressions'), reach: val('post_impressions_unique'), clicks: val('post_clicks'), likes, comments, shares, engagement: likes + comments + shares };
      } else {
        const base = await graphGet(`/${id}`, acc.accessToken, { fields: 'like_count,comments_count' }).catch(() => null);
        const ins = await graphGet(`/${id}/insights`, acc.accessToken, { metric: 'reach,views,shares,saved' }).catch(() => null);
        const val = (name: string) => Number((ins?.data as Json[] | undefined)?.find((d) => d.name === name)?.values?.[0]?.value ?? 0) || null;
        const likes = Number(base?.like_count ?? 0);
        const comments = Number(base?.comments_count ?? 0);
        const shares = val('shares') ?? 0;
        out[id] = { reach: val('reach'), views: val('views'), impressions: val('views'), likes, comments, shares, engagement: likes + comments + shares + (val('saved') ?? 0) };
      }
    }
    return out;
  },
  async accountMetrics(acc) {
    const r = await graphGet(`/${acc.externalId}`, acc.accessToken, { fields: 'followers_count' });
    return { followers: r?.followers_count ?? null };
  },
};

// ---------- LinkedIn ----------

const LI = 'https://api.linkedin.com';
const LI_VERSION = '202410';
const liHeaders = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  'linkedin-version': LI_VERSION,
  'x-restli-protocol-version': '2.0.0',
  ...extra,
});

async function liUpload(acc: AccountCreds, m: MediaItem): Promise<string> {
  const owner = String(acc.meta.author);
  const bytes = await readMedia(m);
  if (m.type === 'image') {
    const init = await http(`${LI}/rest/images?action=initializeUpload`, { method: 'POST', headers: liHeaders(acc.accessToken, JSONH), body: JSON.stringify({ initializeUploadRequest: { owner } }) });
    const { uploadUrl, image } = init.body.value;
    await http(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${acc.accessToken}` }, body: new Uint8Array(bytes), timeoutMs: 60_000 });
    return String(image);
  }
  const init = await http(`${LI}/rest/videos?action=initializeUpload`, {
    method: 'POST',
    headers: liHeaders(acc.accessToken, JSONH),
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }),
  });
  const v = init.body.value;
  const etags: string[] = [];
  for (const part of v.uploadInstructions as Json[]) {
    const res = await http(part.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes.subarray(part.firstByte, part.lastByte + 1)), timeoutMs: 60_000 });
    etags.push(String(res.headers.get('etag') ?? ''));
  }
  await http(`${LI}/rest/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: liHeaders(acc.accessToken, JSONH),
    body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? '', uploadedPartIds: etags } }),
  });
  return String(v.video);
}

const linkedin: SocialProvider = {
  usesPkce: false,
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env('LINKEDIN_CLIENT_ID'),
      redirect_uri: redirectUri,
      state,
      scope: 'openid profile w_member_social r_organization_social w_organization_social rw_organization_admin',
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q.toString()}`;
  },
  async exchange({ code, redirectUri }) {
    const tok = (
      await http('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: FORM,
        body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env('LINKEDIN_CLIENT_ID'), client_secret: env('LINKEDIN_CLIENT_SECRET') }),
      })
    ).body;
    const tokens: TokenSet = {
      accessToken: String(tok.access_token),
      refreshToken: tok.refresh_token ?? null,
      expiresAt: inSeconds(tok.expires_in),
      refreshExpiresAt: inSeconds(tok.refresh_token_expires_in),
    };
    const me = (await http(`${LI}/v2/userinfo`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).body;
    const out: DiscoveredAccount[] = [
      { network: 'linkedin', kind: 'profile', externalId: String(me.sub), name: String(me.name ?? ''), avatarUrl: me.picture ?? null, tokens, meta: { author: `urn:li:person:${me.sub}` } },
    ];
    // Páginas de empresa que administra (necesita la aprobación de Community Management API).
    const acls = await http(`${LI}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: liHeaders(tokens.accessToken) }).catch(() => null);
    for (const el of (acls?.body?.elements ?? []) as Json[]) {
      const urn = String(el.organization ?? el.organizationTarget ?? '');
      const id = urn.split(':').pop();
      if (!id) continue;
      const org = await http(`${LI}/rest/organizations/${id}`, { headers: liHeaders(tokens.accessToken) }).catch(() => null);
      out.push({
        network: 'linkedin',
        kind: 'organization',
        externalId: urn,
        name: String(org?.body?.localizedName ?? `Organization ${id}`),
        handle: org?.body?.vanityName ?? null,
        profileUrl: org?.body?.vanityName ? `https://www.linkedin.com/company/${org.body.vanityName}` : null,
        tokens,
        meta: { author: urn },
      });
    }
    return out;
  },
  async refresh(acc) {
    if (!acc.refreshToken) return null;
    const tok = (
      await http('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: FORM,
        body: form({ grant_type: 'refresh_token', refresh_token: acc.refreshToken, client_id: env('LINKEDIN_CLIENT_ID'), client_secret: env('LINKEDIN_CLIENT_SECRET') }),
      })
    ).body;
    return { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? acc.refreshToken, expiresAt: inSeconds(tok.expires_in), refreshExpiresAt: inSeconds(tok.refresh_token_expires_in) };
  },
  async publish(acc, { text, media }) {
    const author = String(acc.meta.author);
    const body: Json = {
      author,
      commentary: text.replace(/[(){}[\]<>@|~_*\\]/g, (c) => `\\${c}`),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (media.length) {
      const ids: string[] = [];
      for (const m of media) ids.push(await liUpload(acc, m));
      body.content = ids.length > 1 ? { multiImage: { images: ids.map((id) => ({ id })) } } : { media: { id: ids[0] } };
    }
    const r = await http(`${LI}/rest/posts`, { method: 'POST', headers: liHeaders(acc.accessToken, JSONH), body: JSON.stringify(body) });
    const urn = r.headers.get('x-restli-id') ?? r.body?.id;
    if (!urn) throw new SocialApiError('network', 'LinkedIn did not return the post id');
    return { done: true, externalId: String(urn), url: `https://www.linkedin.com/feed/update/${urn}` };
  },
  async comment(acc, externalId, text) {
    await http(`${LI}/rest/socialActions/${encodeURIComponent(externalId)}/comments`, {
      method: 'POST',
      headers: liHeaders(acc.accessToken, JSONH),
      body: JSON.stringify({ actor: acc.meta.author, object: externalId, message: { text } }),
    });
  },
  async fetchInbox(acc, { posts }) {
    const items: FetchedInboxItem[] = [];
    for (const urn of posts.slice(0, 20)) {
      const r = await http(`${LI}/rest/socialActions/${encodeURIComponent(urn)}/comments`, { headers: liHeaders(acc.accessToken) }).catch(() => null);
      for (const c of (r?.body?.elements ?? []) as Json[]) {
        if (c.actor === acc.meta.author) continue;
        items.push({
          kind: 'comment',
          externalId: String(c.$URN ?? c.commentUrn ?? c.id),
          threadRef: urn,
          postExternalId: urn,
          authorName: 'LinkedIn member',
          authorId: c.actor ?? null,
          text: String(c.message?.text ?? ''),
          receivedAt: new Date(Number(c.created?.time ?? Date.now())).toISOString(),
        });
      }
    }
    return { items };
  },
  async reply(acc, target, text) {
    const post = target.threadRef ?? '';
    const r = await http(`${LI}/rest/socialActions/${encodeURIComponent(post)}/comments`, {
      method: 'POST',
      headers: liHeaders(acc.accessToken, JSONH),
      body: JSON.stringify({ actor: acc.meta.author, object: post, parentComment: target.externalId, message: { text } }),
    });
    return { externalId: r.headers.get('x-restli-id') ?? null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    for (const urn of ids.slice(0, 25)) {
      const r = await http(`${LI}/rest/socialActions/${encodeURIComponent(urn)}`, { headers: liHeaders(acc.accessToken) }).catch(() => null);
      const likes = Number(r?.body?.likesSummary?.totalLikes ?? 0);
      const comments = Number(r?.body?.commentsSummary?.aggregatedTotalComments ?? 0);
      out[urn] = { likes, comments, engagement: likes + comments };
    }
    return out;
  },
  async accountMetrics(acc) {
    if (acc.kind !== 'organization') return {};
    const r = await http(`${LI}/rest/networkSizes/${encodeURIComponent(acc.externalId)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers: liHeaders(acc.accessToken) });
    return { followers: r.body?.firstDegreeSize ?? null };
  },
};

// ---------- X ----------

const XAPI = 'https://api.x.com/2';
const xBasic = () => `Basic ${Buffer.from(`${env('X_CLIENT_ID')}:${env('X_CLIENT_SECRET')}`).toString('base64')}`;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const x: SocialProvider = {
  usesPkce: true,
  authorizeUrl({ state, redirectUri, challenge }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env('X_CLIENT_ID'),
      redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write users.read media.write offline.access',
      state,
      code_challenge: challenge ?? '',
      code_challenge_method: 'S256',
    });
    return `https://x.com/i/oauth2/authorize?${q.toString()}`;
  },
  async exchange({ code, redirectUri, verifier }) {
    const tok = (
      await http(`${XAPI}/oauth2/token`, {
        method: 'POST',
        headers: { ...FORM, authorization: xBasic() },
        body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier ?? '', client_id: env('X_CLIENT_ID') }),
      })
    ).body;
    const tokens: TokenSet = { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? null, expiresAt: inSeconds(tok.expires_in) };
    const me = (await http(`${XAPI}/users/me?user.fields=profile_image_url,public_metrics`, { headers: bearer(tokens.accessToken) })).body.data;
    return [
      {
        network: 'x',
        kind: 'profile',
        externalId: String(me.id),
        name: String(me.name ?? ''),
        handle: me.username ?? null,
        avatarUrl: me.profile_image_url ?? null,
        profileUrl: me.username ? `https://x.com/${me.username}` : null,
        followers: me.public_metrics?.followers_count ?? null,
        tokens,
      },
    ];
  },
  async refresh(acc) {
    if (!acc.refreshToken) return null;
    const tok = (
      await http(`${XAPI}/oauth2/token`, {
        method: 'POST',
        headers: { ...FORM, authorization: xBasic() },
        body: form({ grant_type: 'refresh_token', refresh_token: acc.refreshToken, client_id: env('X_CLIENT_ID') }),
      })
    ).body;
    return { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? acc.refreshToken, expiresAt: inSeconds(tok.expires_in) };
  },
  async publish(acc, { text, media }) {
    const mediaIds: string[] = [];
    for (const m of media.filter((i) => i.type === 'image')) {
      const fd = new FormData();
      fd.set('media', new Blob([new Uint8Array(await readMedia(m))], { type: m.mime }), m.name ?? 'image');
      fd.set('media_category', 'tweet_image');
      const r = await http(`${XAPI}/media/upload`, { method: 'POST', headers: bearer(acc.accessToken), body: fd, timeoutMs: 60_000 });
      mediaIds.push(String(r.body?.data?.id ?? r.body?.media_id_string));
    }
    const r = await http(`${XAPI}/tweets`, {
      method: 'POST',
      headers: { ...bearer(acc.accessToken), ...JSONH },
      body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
    });
    const id = String(r.body.data.id);
    return { done: true, externalId: id, url: `https://x.com/${acc.handle ?? 'i'}/status/${id}` };
  },
  async comment(acc, externalId, text) {
    await http(`${XAPI}/tweets`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: externalId } }) });
  },
  async fetchInbox(acc, { cursor }) {
    const q = new URLSearchParams({ 'tweet.fields': 'created_at,author_id,conversation_id', expansions: 'author_id', 'user.fields': 'username,name', max_results: '50' });
    if (cursor) q.set('since_id', cursor);
    const r = await http(`${XAPI}/users/${acc.externalId}/mentions?${q.toString()}`, { headers: bearer(acc.accessToken) });
    const users = new Map<string, Json>(((r.body?.includes?.users ?? []) as Json[]).map((u) => [String(u.id), u]));
    const items: FetchedInboxItem[] = ((r.body?.data ?? []) as Json[]).map((t) => {
      const u = users.get(String(t.author_id)) ?? {};
      return { kind: 'mention', externalId: String(t.id), threadRef: t.conversation_id ?? null, authorName: u.name ?? 'X user', authorHandle: u.username ?? null, authorId: t.author_id ?? null, text: String(t.text ?? ''), receivedAt: String(t.created_at ?? new Date().toISOString()) };
    });
    return { items, cursor: r.body?.meta?.newest_id ?? cursor };
  },
  async reply(acc, target, text) {
    const r = await http(`${XAPI}/tweets`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: target.externalId } }) });
    return { externalId: r.body?.data?.id ?? null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    if (!ids.length) return out;
    const r = await http(`${XAPI}/tweets?ids=${ids.slice(0, 100).join(',')}&tweet.fields=public_metrics,non_public_metrics`, { headers: bearer(acc.accessToken) }).catch(() =>
      http(`${XAPI}/tweets?ids=${ids.slice(0, 100).join(',')}&tweet.fields=public_metrics`, { headers: bearer(acc.accessToken) }),
    );
    for (const t of (r.body?.data ?? []) as Json[]) {
      const p = t.public_metrics ?? {};
      const likes = Number(p.like_count ?? 0);
      const comments = Number(p.reply_count ?? 0);
      const shares = Number(p.retweet_count ?? 0) + Number(p.quote_count ?? 0);
      out[String(t.id)] = { impressions: p.impression_count ?? null, likes, comments, shares, clicks: t.non_public_metrics?.url_link_clicks ?? null, engagement: likes + comments + shares };
    }
    return out;
  },
  async accountMetrics(acc) {
    const r = await http(`${XAPI}/users/me?user.fields=public_metrics`, { headers: bearer(acc.accessToken) });
    return { followers: r.body?.data?.public_metrics?.followers_count ?? null };
  },
};

// ---------- TikTok ----------

const TT = 'https://open.tiktokapis.com/v2';

const tiktok: SocialProvider = {
  usesPkce: false,
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({ client_key: env('TIKTOK_CLIENT_KEY'), scope: 'user.info.basic,user.info.profile,user.info.stats,video.publish,video.upload,video.list', response_type: 'code', redirect_uri: redirectUri, state });
    return `https://www.tiktok.com/v2/auth/authorize/?${q.toString()}`;
  },
  async exchange({ code, redirectUri }) {
    const tok = (
      await http(`${TT}/oauth/token/`, {
        method: 'POST',
        headers: FORM,
        body: form({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
      })
    ).body;
    const tokens: TokenSet = { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? null, expiresAt: inSeconds(tok.expires_in), refreshExpiresAt: inSeconds(tok.refresh_expires_in) };
    const me = (await http(`${TT}/user/info/?fields=open_id,avatar_url,display_name,username,follower_count`, { headers: bearer(tokens.accessToken) })).body?.data?.user ?? {};
    return [
      {
        network: 'tiktok',
        kind: 'profile',
        externalId: String(me.open_id ?? tok.open_id),
        name: String(me.display_name ?? me.username ?? 'TikTok'),
        handle: me.username ?? null,
        avatarUrl: me.avatar_url ?? null,
        profileUrl: me.username ? `https://www.tiktok.com/@${me.username}` : null,
        followers: me.follower_count ?? null,
        tokens,
      },
    ];
  },
  async refresh(acc) {
    if (!acc.refreshToken) return null;
    const tok = (
      await http(`${TT}/oauth/token/`, {
        method: 'POST',
        headers: FORM,
        body: form({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: acc.refreshToken }),
      })
    ).body;
    return { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? acc.refreshToken, expiresAt: inSeconds(tok.expires_in), refreshExpiresAt: inSeconds(tok.refresh_expires_in) };
  },
  async publish(acc, { text, media }) {
    const video = media.find((m) => m.type === 'video');
    if (!video) throw new SocialApiError('validation', 'TikTok needs a video');
    const creator = (await http(`${TT}/post/publish/creator_info/query/`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: '{}' })).body?.data ?? {};
    const levels: string[] = creator.privacy_level_options ?? [];
    // Las apps sin auditar solo pueden publicar en privado (SELF_ONLY): se usa lo que TikTok permita.
    const privacy = levels.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : (levels[0] ?? 'SELF_ONLY');
    const bytes = await readMedia(video);
    const init = (
      await http(`${TT}/post/publish/video/init/`, {
        method: 'POST',
        headers: { ...bearer(acc.accessToken), ...JSONH },
        body: JSON.stringify({
          post_info: { title: text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
          source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
        }),
      })
    ).body?.data;
    await http(String(init.upload_url), {
      method: 'PUT',
      headers: { 'content-type': video.mime || 'video/mp4', 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
      body: new Uint8Array(bytes),
      timeoutMs: 120_000,
    });
    return { done: false, ref: String(init.publish_id) };
  },
  async checkPublish(acc, ref) {
    const st = (await http(`${TT}/post/publish/status/fetch/`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ publish_id: ref }) })).body?.data ?? {};
    if (st.status === 'FAILED') throw new SocialApiError('invalid_media', `TikTok rejected the video (${st.fail_reason ?? 'failed'})`);
    if (st.status !== 'PUBLISH_COMPLETE') return { done: false, ref };
    const id = String((st.publicaly_available_post_id ?? [])[0] ?? ref);
    return { done: true, externalId: id, url: acc.handle && st.publicaly_available_post_id?.length ? `https://www.tiktok.com/@${acc.handle}/video/${id}` : null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    const r = await http(`${TT}/video/query/?fields=id,like_count,comment_count,share_count,view_count`, {
      method: 'POST',
      headers: { ...bearer(acc.accessToken), ...JSONH },
      body: JSON.stringify({ filters: { video_ids: ids.slice(0, 20) } }),
    }).catch(() => null);
    for (const v of (r?.body?.data?.videos ?? []) as Json[]) {
      const likes = Number(v.like_count ?? 0);
      const comments = Number(v.comment_count ?? 0);
      const shares = Number(v.share_count ?? 0);
      out[String(v.id)] = { views: v.view_count ?? null, impressions: v.view_count ?? null, likes, comments, shares, engagement: likes + comments + shares };
    }
    return out;
  },
  async accountMetrics(acc) {
    const r = await http(`${TT}/user/info/?fields=follower_count`, { headers: bearer(acc.accessToken) });
    return { followers: r.body?.data?.user?.follower_count ?? null };
  },
};

// ---------- YouTube ----------

const YT = 'https://www.googleapis.com/youtube/v3';

const youtube: SocialProvider = {
  usesPkce: true,
  authorizeUrl({ state, redirectUri, challenge }) {
    const q = new URLSearchParams({
      client_id: env('YOUTUBE_CLIENT_ID'),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: challenge ?? '',
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  },
  async exchange({ code, redirectUri, verifier }) {
    const tok = (
      await http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: FORM,
        body: form({ code, client_id: env('YOUTUBE_CLIENT_ID'), client_secret: env('YOUTUBE_CLIENT_SECRET'), redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier ?? '' }),
      })
    ).body;
    const tokens: TokenSet = { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? null, expiresAt: inSeconds(tok.expires_in) };
    const ch = (await http(`${YT}/channels?part=snippet,statistics&mine=true`, { headers: bearer(tokens.accessToken) })).body;
    return ((ch?.items ?? []) as Json[]).map((c) => ({
      network: 'youtube' as const,
      kind: 'channel' as const,
      externalId: String(c.id),
      name: String(c.snippet?.title ?? ''),
      handle: c.snippet?.customUrl ?? null,
      avatarUrl: c.snippet?.thumbnails?.default?.url ?? null,
      profileUrl: `https://www.youtube.com/channel/${c.id}`,
      followers: Number(c.statistics?.subscriberCount ?? 0) || null,
      tokens,
    }));
  },
  async refresh(acc) {
    if (!acc.refreshToken) return null;
    const tok = (
      await http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: FORM,
        body: form({ grant_type: 'refresh_token', refresh_token: acc.refreshToken, client_id: env('YOUTUBE_CLIENT_ID'), client_secret: env('YOUTUBE_CLIENT_SECRET') }),
      })
    ).body;
    return { accessToken: String(tok.access_token), refreshToken: tok.refresh_token ?? acc.refreshToken, expiresAt: inSeconds(tok.expires_in) };
  },
  async publish(acc, { text, media }) {
    const video = media.find((m) => m.type === 'video');
    if (!video) throw new SocialApiError('validation', 'YouTube needs a video');
    const [first, ...rest] = text.split('\n');
    const title = (first || video.name || 'Video').slice(0, 100);
    const description = rest.join('\n').trim() || text;
    const bytes = await readMedia(video);
    const boundary = `zs${randomBytes(12).toString('hex')}`;
    const metaPart = JSON.stringify({ snippet: { title, description: description.slice(0, 5000) }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: ${video.mime || 'video/mp4'}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await http('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
      method: 'POST',
      headers: { ...bearer(acc.accessToken), 'content-type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
      timeoutMs: 120_000,
    });
    const id = String(r.body.id);
    return { done: true, externalId: id, url: `https://www.youtube.com/watch?v=${id}` };
  },
  async comment(acc, externalId, text) {
    await http(`${YT}/commentThreads?part=snippet`, {
      method: 'POST',
      headers: { ...bearer(acc.accessToken), ...JSONH },
      body: JSON.stringify({ snippet: { videoId: externalId, topLevelComment: { snippet: { textOriginal: text } } } }),
    });
  },
  async fetchInbox(acc, { posts }) {
    const items: FetchedInboxItem[] = [];
    for (const videoId of posts.slice(0, 20)) {
      const r = await http(`${YT}/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&maxResults=20&order=time`, { headers: bearer(acc.accessToken) }).catch(() => null);
      for (const t of (r?.body?.items ?? []) as Json[]) {
        const c = t.snippet?.topLevelComment;
        const s = c?.snippet ?? {};
        if (s.authorChannelId?.value === acc.externalId) continue;
        items.push({ kind: 'comment', externalId: String(c?.id ?? t.id), postExternalId: videoId, authorName: s.authorDisplayName ?? 'YouTube user', authorId: s.authorChannelId?.value ?? null, text: String(s.textOriginal ?? s.textDisplay ?? ''), receivedAt: String(s.publishedAt ?? new Date().toISOString()) });
      }
    }
    return { items };
  },
  async reply(acc, target, text) {
    const r = await http(`${YT}/comments?part=snippet`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ snippet: { parentId: target.externalId, textOriginal: text } }) });
    return { externalId: r.body?.id ?? null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    if (!ids.length) return out;
    const r = await http(`${YT}/videos?part=statistics&id=${ids.slice(0, 50).map(encodeURIComponent).join(',')}`, { headers: bearer(acc.accessToken) });
    for (const v of (r.body?.items ?? []) as Json[]) {
      const s = v.statistics ?? {};
      const likes = Number(s.likeCount ?? 0);
      const comments = Number(s.commentCount ?? 0);
      out[String(v.id)] = { views: Number(s.viewCount ?? 0), impressions: Number(s.viewCount ?? 0), likes, comments, engagement: likes + comments };
    }
    return out;
  },
  async accountMetrics(acc) {
    const r = await http(`${YT}/channels?part=statistics&id=${encodeURIComponent(acc.externalId)}`, { headers: bearer(acc.accessToken) });
    return { followers: Number(r.body?.items?.[0]?.statistics?.subscriberCount ?? 0) || null };
  },
};

// ---------- Threads ----------

const TH = 'https://graph.threads.net/v1.0';

async function thPost(path: string, token: string, data: Record<string, string>): Promise<Json> {
  return (await http(`${TH}${path}`, { method: 'POST', headers: FORM, body: form({ ...data, access_token: token }) })).body;
}
async function thGet(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  return (await http(`${TH}${path}?${new URLSearchParams({ ...params, access_token: token })}`)).body;
}

const threads: SocialProvider = {
  usesPkce: false,
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({
      client_id: env('THREADS_APP_ID'),
      redirect_uri: redirectUri,
      scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies,threads_manage_insights',
      response_type: 'code',
      state,
    });
    return `https://threads.net/oauth/authorize?${q.toString()}`;
  },
  async exchange({ code, redirectUri }) {
    const short = (
      await http('https://graph.threads.net/oauth/access_token', {
        method: 'POST',
        headers: FORM,
        body: form({ client_id: env('THREADS_APP_ID'), client_secret: env('THREADS_APP_SECRET'), grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
      })
    ).body;
    const long = (
      await http(`https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: env('THREADS_APP_SECRET'), access_token: String(short.access_token) })}`)
    ).body;
    const token = String(long.access_token ?? short.access_token);
    const me = await thGet('/me', token, { fields: 'id,username,name,threads_profile_picture_url' });
    return [
      {
        network: 'threads',
        kind: 'profile',
        externalId: String(me.id),
        name: String(me.name ?? me.username ?? ''),
        handle: me.username ?? null,
        avatarUrl: me.threads_profile_picture_url ?? null,
        profileUrl: me.username ? `https://www.threads.net/@${me.username}` : null,
        tokens: { accessToken: token, expiresAt: inSeconds(long.expires_in) },
      },
    ];
  },
  async refresh(acc) {
    const r = (await http(`https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: acc.accessToken })}`)).body;
    return { accessToken: String(r.access_token), expiresAt: inSeconds(r.expires_in) };
  },
  async publish(acc, { text, media }) {
    const uid = acc.externalId;
    let creation: string;
    if (media.length > 1) {
      const children: string[] = [];
      for (const m of media) {
        const c = await thPost(`/${uid}/threads`, acc.accessToken, m.type === 'video' ? { media_type: 'VIDEO', video_url: publicMediaUrl(m.url), is_carousel_item: 'true' } : { media_type: 'IMAGE', image_url: publicMediaUrl(m.url), is_carousel_item: 'true' });
        children.push(String(c.id));
      }
      creation = String((await thPost(`/${uid}/threads`, acc.accessToken, { media_type: 'CAROUSEL', children: children.join(','), text })).id);
    } else if (media.length === 1) {
      const m = media[0];
      creation = String((await thPost(`/${uid}/threads`, acc.accessToken, m.type === 'video' ? { media_type: 'VIDEO', video_url: publicMediaUrl(m.url), text } : { media_type: 'IMAGE', image_url: publicMediaUrl(m.url), text })).id);
    } else {
      creation = String((await thPost(`/${uid}/threads`, acc.accessToken, { media_type: 'TEXT', text })).id);
    }
    return (await threads.checkPublish!(acc, creation)) ?? { done: false, ref: creation };
  },
  async checkPublish(acc, ref) {
    const st = await thGet(`/${ref}`, acc.accessToken, { fields: 'status,error_message' });
    if (st?.status === 'ERROR' || st?.status === 'EXPIRED') throw new SocialApiError('invalid_media', `Threads could not process the post (${st.error_message ?? st.status})`);
    if (st?.status && st.status !== 'FINISHED') return { done: false, ref };
    const pub = await thPost(`/${acc.externalId}/threads_publish`, acc.accessToken, { creation_id: ref });
    const id = String(pub.id);
    const link = await thGet(`/${id}`, acc.accessToken, { fields: 'permalink' }).catch(() => null);
    return { done: true, externalId: id, url: link?.permalink ?? null };
  },
  async comment(acc, externalId, text) {
    const c = await thPost(`/${acc.externalId}/threads`, acc.accessToken, { media_type: 'TEXT', text, reply_to_id: externalId });
    await thPost(`/${acc.externalId}/threads_publish`, acc.accessToken, { creation_id: String(c.id) });
  },
  async fetchInbox(acc, { posts }) {
    const items: FetchedInboxItem[] = [];
    for (const id of posts.slice(0, 20)) {
      const r = await thGet(`/${id}/replies`, acc.accessToken, { fields: 'id,text,username,timestamp' }).catch(() => null);
      for (const c of (r?.data ?? []) as Json[]) {
        if (c.username && c.username === acc.handle) continue;
        items.push({ kind: 'comment', externalId: String(c.id), postExternalId: id, authorName: c.username ?? 'Threads user', authorHandle: c.username ?? null, text: String(c.text ?? ''), receivedAt: String(c.timestamp ?? new Date().toISOString()) });
      }
    }
    return { items };
  },
  async reply(acc, target, text) {
    const c = await thPost(`/${acc.externalId}/threads`, acc.accessToken, { media_type: 'TEXT', text, reply_to_id: target.externalId });
    const p = await thPost(`/${acc.externalId}/threads_publish`, acc.accessToken, { creation_id: String(c.id) });
    return { externalId: p?.id ? String(p.id) : null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    for (const id of ids.slice(0, 25)) {
      const r = await thGet(`/${id}/insights`, acc.accessToken, { metric: 'views,likes,replies,reposts,quotes' }).catch(() => null);
      const val = (n: string) => Number((r?.data as Json[] | undefined)?.find((d) => d.name === n)?.values?.[0]?.value ?? 0);
      const likes = val('likes');
      const comments = val('replies');
      const shares = val('reposts') + val('quotes');
      out[id] = { views: val('views'), impressions: val('views'), likes, comments, shares, engagement: likes + comments + shares };
    }
    return out;
  },
  async accountMetrics(acc) {
    const r = await thGet(`/${acc.externalId}/threads_insights`, acc.accessToken, { metric: 'followers_count' }).catch(() => null);
    return { followers: Number((r?.data as Json[] | undefined)?.[0]?.total_value?.value ?? 0) || null };
  },
};

// ---------- Bluesky (contraseña de app, sin OAuth) ----------

const BSKY = 'https://bsky.social/xrpc';

export async function blueskySession(identifier: string, password: string): Promise<DiscoveredAccount> {
  const s = (await http(`${BSKY}/com.atproto.server.createSession`, { method: 'POST', headers: JSONH, body: JSON.stringify({ identifier, password }) })).body;
  const profile = (await http(`${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(s.did)}`, { headers: bearer(s.accessJwt) }).catch(() => null))?.body ?? {};
  return {
    network: 'bluesky',
    kind: 'profile',
    externalId: String(s.did),
    name: String(profile.displayName || s.handle),
    handle: s.handle ?? null,
    avatarUrl: profile.avatar ?? null,
    profileUrl: `https://bsky.app/profile/${s.handle}`,
    followers: profile.followersCount ?? null,
    // El token de acceso dura unas horas; el de refresco, meses.
    tokens: { accessToken: String(s.accessJwt), refreshToken: String(s.refreshJwt), expiresAt: new Date(Date.now() + 90 * 60_000).toISOString() },
  };
}

/** Links y #hashtags como facets (Bluesky no los detecta solo). Offsets en bytes UTF-8. */
export function blueskyFacets(text: string): Json[] {
  const facets: Json[] = [];
  const enc = new TextEncoder();
  const byteAt = (i: number) => enc.encode(text.slice(0, i)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const start = m.index ?? 0;
    facets.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(start + m[0].length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const start = (m.index ?? 0) + m[1].length;
    facets.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(start + 1 + m[2].length) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return facets;
}

const rkey = (uri: string) => uri.split('/').pop() ?? '';

const bluesky: SocialProvider = {
  usesPkce: false,
  authorizeUrl() {
    throw new SocialApiError('not_configured', 'Bluesky connects with an app password');
  },
  async exchange() {
    throw new SocialApiError('not_configured', 'Bluesky connects with an app password');
  },
  async refresh(acc) {
    const s = (await http(`${BSKY}/com.atproto.server.refreshSession`, { method: 'POST', headers: bearer(acc.refreshToken) })).body;
    return { accessToken: String(s.accessJwt), refreshToken: String(s.refreshJwt), expiresAt: new Date(Date.now() + 90 * 60_000).toISOString() };
  },
  async publish(acc, { text, media }) {
    const record: Json = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
    const facets = blueskyFacets(text);
    if (facets.length) record.facets = facets;
    const images = media.filter((m) => m.type === 'image');
    if (images.length) {
      const out: Json[] = [];
      for (const m of images) {
        const blob = (await http(`${BSKY}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...bearer(acc.accessToken), 'content-type': m.mime }, body: new Uint8Array(await readMedia(m)), timeoutMs: 60_000 })).body.blob;
        out.push({ alt: '', image: blob, ...(m.width && m.height ? { aspectRatio: { width: m.width, height: m.height } } : {}) });
      }
      record.embed = { $type: 'app.bsky.embed.images', images: out };
    }
    const r = (await http(`${BSKY}/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ repo: acc.externalId, collection: 'app.bsky.feed.post', record }) })).body;
    // externalId = uri|cid: hace falta el cid para contestar.
    return { done: true, externalId: `${r.uri}|${r.cid}`, url: `https://bsky.app/profile/${acc.handle ?? acc.externalId}/post/${rkey(String(r.uri))}` };
  },
  async comment(acc, externalId, text) {
    const [uri, cid] = externalId.split('|');
    const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), reply: { root: { uri, cid }, parent: { uri, cid } } };
    await http(`${BSKY}/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ repo: acc.externalId, collection: 'app.bsky.feed.post', record }) });
  },
  async fetchInbox(acc, { cursor }) {
    const r = (await http(`${BSKY}/app.bsky.notification.listNotifications?limit=50`, { headers: bearer(acc.accessToken) })).body;
    const items: FetchedInboxItem[] = [];
    let newest = cursor;
    for (const n of (r?.notifications ?? []) as Json[]) {
      if (n.reason !== 'reply' && n.reason !== 'mention') continue;
      if (cursor && String(n.indexedAt) <= cursor) continue;
      if (!newest || String(n.indexedAt) > newest) newest = String(n.indexedAt);
      const root = n.record?.reply?.root ?? { uri: n.uri, cid: n.cid };
      items.push({
        kind: n.reason === 'reply' ? 'comment' : 'mention',
        externalId: String(n.uri),
        threadRef: JSON.stringify({ uri: n.uri, cid: n.cid, rootUri: root.uri, rootCid: root.cid }),
        postExternalId: n.record?.reply?.parent?.uri ? `${n.record.reply.parent.uri}|${n.record.reply.parent.cid}` : null,
        authorName: n.author?.displayName || n.author?.handle || 'Bluesky user',
        authorHandle: n.author?.handle ?? null,
        authorId: n.author?.did ?? null,
        text: String(n.record?.text ?? ''),
        receivedAt: String(n.indexedAt ?? new Date().toISOString()),
      });
    }
    return { items, cursor: newest ?? null };
  },
  async reply(acc, target, text) {
    const ref = JSON.parse(target.threadRef ?? '{}');
    const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), reply: { root: { uri: ref.rootUri ?? ref.uri, cid: ref.rootCid ?? ref.cid }, parent: { uri: ref.uri, cid: ref.cid } } };
    const r = (await http(`${BSKY}/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...bearer(acc.accessToken), ...JSONH }, body: JSON.stringify({ repo: acc.externalId, collection: 'app.bsky.feed.post', record }) })).body;
    return { externalId: r?.uri ?? null };
  },
  async postMetrics(acc, ids) {
    const out: Record<string, PostMetrics> = {};
    const uris = ids.map((i) => i.split('|')[0]).slice(0, 25);
    if (!uris.length) return out;
    const r = (await http(`${BSKY}/app.bsky.feed.getPosts?${uris.map((u) => `uris=${encodeURIComponent(u)}`).join('&')}`, { headers: bearer(acc.accessToken) })).body;
    for (const p of (r?.posts ?? []) as Json[]) {
      const id = ids.find((i) => i.startsWith(`${p.uri}|`)) ?? p.uri;
      const likes = Number(p.likeCount ?? 0);
      const comments = Number(p.replyCount ?? 0);
      const shares = Number(p.repostCount ?? 0) + Number(p.quoteCount ?? 0);
      out[id] = { likes, comments, shares, engagement: likes + comments + shares };
    }
    return out;
  },
  async accountMetrics(acc) {
    const r = (await http(`${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(acc.externalId)}`, { headers: bearer(acc.accessToken) })).body;
    return { followers: r?.followersCount ?? null };
  },
};

export const REAL_PROVIDERS: Record<SocialNetwork, SocialProvider> = {
  facebook: meta,
  instagram: meta,
  linkedin,
  x,
  tiktok,
  youtube,
  threads,
  bluesky,
};
