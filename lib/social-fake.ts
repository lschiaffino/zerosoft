/**
 * Social en modo falso (SOCIAL_FAKE=1, solo con NODE_ENV=test o DEMO_MODE):
 * todas las redes conectan, publican, reciben comentarios y devuelven
 * métricas sin salir a internet. Determinístico para los e2e:
 *
 * - OAuth: la URL de autorización vuelve directo al callback con code=fake.
 * - Publicar: un texto con "[fail]" falla para siempre (contenido rechazado);
 *   con "[flaky]" falla el primer intento (error de red) y sale en el
 *   reintento. Instagram, Threads y TikTok devuelven primero "procesando" y
 *   publican en el chequeo siguiente, como las APIs reales.
 * - Bandeja: cada publicación recibe un comentario de "Fake Fan"; las redes
 *   con mensajes directos reciben uno por cuenta.
 * - Métricas: números fijos que salen de un hash del id.
 */
import { createHash } from 'crypto';
import type { SocialNetwork } from './social-networks';
import { NETWORK_SPECS } from './social-networks';
import { SocialApiError, type DiscoveredAccount, type SocialProvider } from './social-providers';

const hash = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const ASYNC: SocialNetwork[] = ['instagram', 'threads', 'tiktok'];

function fakeAccounts(network: SocialNetwork): DiscoveredAccount[] {
  const name = NETWORK_SPECS[network].name;
  const tokens = { accessToken: `fake-access-${network}`, refreshToken: `fake-refresh-${network}`, expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString() };
  const base = (id: string, label: string, kind: DiscoveredAccount['kind'], handle: string): DiscoveredAccount => ({
    network,
    kind,
    externalId: id,
    name: label,
    handle,
    avatarUrl: null,
    profileUrl: `https://social.fake/${network}/${handle}`,
    followers: 1000 + (hash(id) % 5000),
    tokens,
    meta: network === 'instagram' ? { pageId: 'fake-page-1' } : network === 'linkedin' ? { author: id } : {},
  });
  if (network === 'facebook') return [base('fake-page-1', 'Fake Coffee Page', 'page', 'fakecoffee'), base('fake-page-2', 'Fake Bakery Page', 'page', 'fakebakery')];
  if (network === 'linkedin') return [base('urn:li:person:fake', 'Fake Person', 'profile', 'fakeperson'), base('urn:li:organization:42', 'Fake Company', 'organization', 'fakecompany')];
  if (network === 'instagram') return [base('fake-ig-1', 'fake.coffee', 'business', 'fake.coffee')];
  if (network === 'youtube') return [base('fake-channel-1', 'Fake Channel', 'channel', 'fakechannel')];
  return [base(`fake-${network}-1`, `Fake ${name}`, 'profile', `fake${network}`)];
}

const done = (network: SocialNetwork, id: string) => ({ done: true as const, externalId: id, url: `https://social.fake/${network}/post/${encodeURIComponent(id)}` });

export const FAKE_PROVIDER: SocialProvider = {
  usesPkce: true,
  authorizeUrl({ network, state, redirectUri }) {
    return `${redirectUri}?${new URLSearchParams({ code: `fake-${network}`, state }).toString()}`;
  },
  async exchange({ network, code }) {
    if (code === 'fake-denied') throw new SocialApiError('not_authorized', 'The person cancelled');
    return fakeAccounts(network);
  },
  async refresh() {
    return { accessToken: 'fake-access-refreshed', refreshToken: 'fake-refresh-refreshed', expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString() };
  },
  async publish(acc, { text, attempt }) {
    if (text.includes('[fail]')) throw new SocialApiError('invalid_content', `${NETWORK_SPECS[acc.network].name} rejected the post (fake)`, 400);
    if (text.includes('[flaky]') && attempt <= 1) throw new SocialApiError('network', 'Temporary error (fake)', 503);
    const id = `fake_${acc.network}_${crypto.randomUUID().slice(0, 8)}`;
    if (ASYNC.includes(acc.network)) return { done: false, ref: id };
    return done(acc.network, id);
  },
  async checkPublish(acc, ref) {
    return done(acc.network, ref);
  },
  async comment() {},
  async fetchInbox(acc, { posts }) {
    const now = new Date().toISOString();
    const items = posts.map((p) => ({
      kind: 'comment' as const,
      externalId: `c_${p}`,
      postExternalId: p,
      threadRef: p,
      authorName: 'Fake Fan',
      authorHandle: 'fakefan',
      authorId: 'fan-1',
      text: 'Love this! Where can I buy it?',
      receivedAt: now,
    }));
    if (NETWORK_SPECS[acc.network].inbox.includes('dm')) {
      items.push({ kind: 'dm' as never, externalId: `dm_${acc.externalId}`, postExternalId: '', threadRef: `t_${acc.externalId}`, authorName: 'Curious Customer', authorHandle: 'curious', authorId: 'cust-1', text: 'Hi! Do you ship to Montevideo?', receivedAt: now });
    }
    if (NETWORK_SPECS[acc.network].inbox.includes('mention')) {
      items.push({ kind: 'mention' as never, externalId: `m_${acc.externalId}`, postExternalId: '', threadRef: null as never, authorName: 'Brand Watcher', authorHandle: 'watcher', authorId: 'w-1', text: `Big fan of @${acc.handle ?? 'you'}`, receivedAt: now });
    }
    return { items, cursor: now };
  },
  async reply(_acc, target) {
    return { externalId: `r_${target.externalId}_${Date.now()}` };
  },
  async postMetrics(_acc, ids) {
    const out: Record<string, { impressions: number; reach: number; engagement: number; likes: number; comments: number; shares: number; clicks: number; views: number }> = {};
    for (const id of ids) {
      const h = hash(id);
      const likes = 5 + (h % 40);
      const comments = 1 + (h % 7);
      const shares = h % 5;
      const impressions = 200 + (h % 1800);
      out[id] = { impressions, reach: Math.round(impressions * 0.7), likes, comments, shares, clicks: 3 + (h % 30), views: impressions, engagement: likes + comments + shares };
    }
    return out;
  },
  async accountMetrics(acc) {
    return { followers: 1000 + (hash(acc.externalId) % 5000) + Math.floor(Date.now() / 86_400_000) % 7 };
  },
};

export async function fakeBlueskySession(identifier: string, password: string): Promise<DiscoveredAccount> {
  if (password === 'wrong') throw new SocialApiError('not_authorized', 'Invalid identifier or password');
  const [account] = fakeAccounts('bluesky');
  const handle = identifier.replace(/^@/, '') || 'fake.bsky.social';
  return { ...account, externalId: `did:plc:${hash(handle).toString(36)}`, name: handle, handle, profileUrl: `https://social.fake/bluesky/${handle}` };
}
