/**
 * Rec: sesión, espectador y errores de las rutas API. Server-only.
 */
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId, type SessionUser } from './session';
import { AiError } from './ai';
import { UploadError } from './uploads';
import { getPublicVideoRow, publicAccess, RecError, unlockCookieName, type RecActor, type RecVideoRow, type RecViewer } from './rec';

export function recJson<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function recFail(err: unknown) {
  if (err instanceof RecError) return recJson({ error: err.code }, err.status);
  if (err instanceof UploadError) return recJson({ error: err.code }, err.status);
  if (err instanceof AiError) return recJson({ error: err.code }, err.code === 'ai_disabled' ? 503 : 429);
  throw err;
}

export function actorOf(user: SessionUser): RecActor {
  const person = user.actingUser ?? user;
  // Sin pasar por los helpers de sesión: la búsqueda global (Cmd+K) lo llama con el usuario ya resuelto.
  return { ws: user.id, actor: person.id, admin: user.role === 'owner' || user.role === 'admin', name: person.name || person.email || '' };
}

export async function recActor(): Promise<{ actor: RecActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { res: recJson({ error: 'unauthorized' }, 401) };
  return { actor: actorOf(user), user };
}

const VK_COOKIE = 'rec_vk';

/**
 * Quién mira un video público: logueado ("u:<id>", con su nombre) o anónimo
 * con una cookie propia de Rec (se crea en la primera respuesta). `name` es
 * el nombre que escribió el espectador anónimo para comentar.
 */
export async function resolveViewer(req: NextRequest, v: Pick<RecVideoRow, 'created_by'>, name?: string): Promise<{ viewer: RecViewer; newKey: string | null; user: SessionUser | null }> {
  const user = await getCurrentUser();
  if (user) {
    const person = user.actingUser ?? user;
    const id = realUserId(user);
    return { viewer: { key: `u:${id}`, userId: id, name: person.name || person.email || '', isAuthor: id === v.created_by }, newKey: null, user };
  }
  const existing = req.cookies.get(VK_COOKIE)?.value;
  const key = existing && /^[\w-]{16,40}$/.test(existing) ? existing : randomBytes(16).toString('base64url');
  return { viewer: { key: `a:${key}`, userId: null, name: (name ?? '').trim().slice(0, 80), isAuthor: false }, newKey: existing === key ? null : key, user: null };
}

export function withViewerCookie(res: NextResponse, newKey: string | null): NextResponse {
  if (newKey) res.cookies.set(VK_COOKIE, newKey, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 86400 });
  return res;
}

/** Video público ya autorizado para este request (contraseña, vencimiento, workspace). */
export async function publicVideoFor(req: NextRequest, shareId: string): Promise<{ v: RecVideoRow & { author_name: string | null } } | { res: NextResponse }> {
  const v = await getPublicVideoRow(shareId);
  if (!v) return { res: recJson({ error: 'not_found' }, 404) };
  const user = await getCurrentUser();
  const access = publicAccess(v, user?.id ?? null, req.cookies.get(unlockCookieName(v.share_id))?.value ?? null);
  if (access !== 'ok') return { res: recJson({ error: access }, access === 'expired' ? 410 : 403) };
  return { v };
}
