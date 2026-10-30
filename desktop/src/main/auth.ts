/**
 * Login del escritorio sin Google en una webview:
 *
 * 1. beginLogin() arma un verifier PKCE y un state al azar y abre en el
 *    navegador del sistema <servidor>/api/desktop/login?challenge&state.
 * 2. La persona entra con Google en su navegador (o ya tenía sesión),
 *    confirma, y el servidor redirige a zerosoft://auth/callback?code&state
 *    con un código de un solo uso que vence en 2 minutos.
 * 3. completeLogin() valida el state, canjea código + verifier en
 *    POST /api/desktop/token y recibe la cookie de sesión. Sin el verifier
 *    (que nunca sale de este proceso) el código no sirve.
 *
 * La cookie va al cookie store de la sesión de la ventana como cookie de
 * sesión y una copia cifrada con safeStorage (Keychain en Mac, DPAPI en
 * Windows) queda en <userData>/session.bin para la próxima vez. Si el
 * servidor la renueva, se actualiza la copia; si se cierra sesión, se borra.
 */
import { app, net, safeStorage, shell } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appSession, locale, server, TEST_MODE } from './state';
import { testHooks } from './test-hooks';

interface Pending {
  state: string;
  verifier: string;
  server: string;
  at: number;
}

interface StoredSession {
  server: string;
  name: string;
  value: string;
  domain: string | null;
  secure: boolean;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;
let pending: Pending | null = null;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function storeFile() {
  return path.join(app.getPath('userData'), 'session.bin');
}

function readStore(): StoredSession | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = safeStorage.decryptString(fs.readFileSync(storeFile()));
    const v = JSON.parse(raw) as StoredSession;
    return v && typeof v.value === 'string' && typeof v.name === 'string' ? v : null;
  } catch {
    return null;
  }
}

function writeStore(s: StoredSession | null) {
  try {
    if (!s) {
      fs.rmSync(storeFile(), { force: true });
      return;
    }
    // Sin cifrado disponible (Linux sin llavero) no se guarda en disco: la sesión dura lo que la app.
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(storeFile(), safeStorage.encryptString(JSON.stringify(s)), { mode: 0o600 });
  } catch {
    /* sin disco: la cookie sigue en memoria */
  }
}

let stored: StoredSession | null = null;

async function applyCookie(s: StoredSession) {
  await appSession().cookies.set({
    url: s.server,
    name: s.name,
    value: s.value,
    ...(s.domain ? { domain: s.domain } : {}),
    path: '/',
    secure: s.secure,
    httpOnly: true,
    sameSite: 'lax',
  });
}

/** Al arrancar: si hay una sesión guardada para este servidor y no venció, vuelve al cookie store. */
export async function restoreSession(): Promise<boolean> {
  const s = readStore();
  if (!s || s.server !== server() || s.expiresAt <= Date.now()) {
    if (s) writeStore(null);
    return false;
  }
  stored = s;
  const existing = await appSession().cookies.get({ url: s.server, name: s.name });
  if (!existing.length) await applyCookie(s);
  return true;
}

/** Sigue la cookie de sesión: renovaciones del servidor y cierre de sesión. */
export function watchSessionCookie() {
  appSession().cookies.on('changed', (_e, cookie, cause, removed) => {
    if (!stored || cookie.name !== stored.name) return;
    if (removed) {
      // 'overwrite' es una renovación (sigue un alta); lo demás es cierre de sesión o vencimiento.
      if (cause !== 'overwrite') {
        stored = null;
        writeStore(null);
      }
      return;
    }
    const expiresAt = cookie.expirationDate ? cookie.expirationDate * 1000 : stored.expiresAt;
    stored = { ...stored, value: cookie.value, expiresAt };
    writeStore(stored);
  });
}

export function isSignedIn(): boolean {
  return !!stored && stored.expiresAt > Date.now();
}

export async function beginLogin(): Promise<void> {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  pending = { state, verifier, server: server(), at: Date.now() };
  const url = new URL('/api/desktop/login', pending.server);
  url.searchParams.set('challenge', challenge);
  url.searchParams.set('state', state);
  url.searchParams.set('locale', locale());
  // Solo para el texto de la confirmación ("la app de zerosoft en una Mac").
  url.searchParams.set('device', process.platform);
  if (TEST_MODE) {
    testHooks.openedExternal.push(url.toString());
    return;
  }
  await shell.openExternal(url.toString());
}

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Vuelta del navegador (deep link validado). true = sesión lista. */
export async function completeLogin(code: string, state: string): Promise<boolean> {
  const p = pending;
  if (!p || Date.now() - p.at > PENDING_TTL_MS || !sameString(p.state, state)) return false;
  pending = null;
  if (p.server !== server()) return false;
  type TokenResponse = { token?: string; cookie?: { name?: string; domain?: string | null; secure?: boolean; maxAge?: number } };
  let data: TokenResponse | null;
  try {
    const res = await net.fetch(new URL('/api/desktop/token', p.server).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, verifier: p.verifier }),
    });
    if (!res.ok) return false;
    data = (await res.json()) as TokenResponse;
  } catch {
    return false;
  }
  const name = data?.cookie?.name;
  const value = data?.token;
  if (!value || !name || !/^(__Secure-)?next-auth\.session-token$/.test(name)) return false;
  const s: StoredSession = {
    server: p.server,
    name,
    value,
    domain: typeof data?.cookie?.domain === 'string' ? data.cookie.domain : null,
    secure: p.server.startsWith('https://'),
    expiresAt: Date.now() + Math.min(Math.max(Number(data?.cookie?.maxAge) || 0, 60), 30 * 86_400) * 1000,
  };
  stored = s;
  writeStore(s);
  await applyCookie(s);
  return true;
}

export async function signOut(): Promise<void> {
  stored = null;
  writeStore(null);
  const ses = appSession();
  const cookies = await ses.cookies.get({ url: server() });
  await Promise.all(cookies.filter((c) => /next-auth/.test(c.name)).map((c) => ses.cookies.remove(server(), c.name)));
}
