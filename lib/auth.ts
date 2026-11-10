import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { upsertUser, getUserByEmail } from './db';
import { isTrustedReturnUrl } from './hosts';

function hostOfUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Dominio de la cookie de sesión. Solo cuando la app vive en *.zerosoft.ai
 * (NEXTAUTH_URL) se comparte con los subdominios (feedback.zerosoft.ai) vía
 * domain=.zerosoft.ai. SESSION_COOKIE_DOMAIN lo sobreescribe, pero solo si
 * NEXTAUTH_URL está dentro de ese dominio. En cualquier otro caso: cookie del
 * host (default de NextAuth); los dominios propios de Link nunca la reciben.
 */
export function sessionCookieDomain(
  nextAuthUrl = process.env.NEXTAUTH_URL,
  explicit = process.env.SESSION_COOKIE_DOMAIN,
): string | undefined {
  const host = hostOfUrl(nextAuthUrl);
  if (!host) return undefined;
  const wanted = (explicit ?? '').trim().toLowerCase().replace(/^\./, '');
  if (wanted) return host === wanted || host.endsWith(`.${wanted}`) ? `.${wanted}` : undefined;
  if (host === 'zerosoft.ai' || host.endsWith('.zerosoft.ai')) return '.zerosoft.ai';
  return undefined;
}

function sessionCookies(): NextAuthOptions['cookies'] {
  const domain = sessionCookieDomain();
  if (!domain) return undefined;
  const secure = (process.env.NEXTAUTH_URL ?? '').startsWith('https://');
  return {
    sessionToken: {
      name: `${secure ? '__Secure-' : ''}next-auth.session-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure, domain },
    },
  };
}

function googleRedirectUri(): string | undefined {
  // Forzar el redirect_uri exacto que Google espera. En Vercel el dominio
  // detectado por NextAuth a veces es el interno (*.vercel.app) en lugar del
  // custom domain, lo que genera redirect_uri_mismatch.
  const base =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/api/auth/callback/google`;
}

const providers = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const redirectUri = googleRedirectUri();
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      ...(redirectUri
        ? {
            authorization: {
              params: { redirect_uri: redirectUri },
            },
          }
        : {}),
    })
  );
}
// Código por email (lib/email-login.ts): para quien no entra con Google.
providers.push(
  CredentialsProvider({
    id: 'email-code',
    name: 'Email',
    credentials: { email: { label: 'Email', type: 'email' }, code: { label: 'Code', type: 'text' } },
    async authorize(credentials, req) {
      const { emailLoginEnabled, ipFromHeaders, verifyLoginCode } = await import('./email-login');
      if (!emailLoginEnabled()) return null;
      const res = await verifyLoginCode(credentials?.email, credentials?.code, ipFromHeaders(req?.headers as Record<string, unknown> | undefined));
      if (res.ok) return { id: res.email, email: res.email, name: null };
      // NextAuth devuelve el mensaje como `error`: el formulario muestra el aviso del límite.
      if (res.error === 'daily_limit' || res.error === 'rate_limited') throw new Error(res.error);
      return null;
    },
  }),
);

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/en/auth/signin' },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: sessionCookies(),
  events: {
    // Cerrar sesión cierra también la del servidor: ese JWT ya no vale aunque alguien lo haya copiado.
    async signOut({ token }) {
      const sid = (token as { sid?: unknown } | null)?.sid;
      const uid = (token as { uid?: unknown } | null)?.uid;
      if (typeof sid !== 'string' || typeof uid !== 'string') return;
      const { recordSecurityEvent, revokeSession } = await import('./account-security');
      if (await revokeSession(uid, sid)) await recordSecurityEvent({ userId: uid, action: 'logout' });
    },
  },
  callbacks: {
    // Volver después del login: mismo origen o un host de la app de confianza
    // (p. ej. feedback.zerosoft.ai). El login siempre ocurre en NEXTAUTH_URL.
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl}${url}`;
      return isTrustedReturnUrl(url, baseUrl) ? url : baseUrl;
    },
    async signIn({ user, account, profile }) {
      if (!user.email) return false;
      // Google: solo con el email verificado por Google (si no, cualquiera podría declarar uno ajeno).
      if (account?.provider === 'google' && (profile as { email_verified?: unknown } | undefined)?.email_verified !== true) return false;
      // Los datos de ejemplo ya no se siembran solos: se ofrecen en el onboarding (/app/welcome).
      await upsertUser({ email: user.email, name: user.name, image: user.image });
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.email) {
        const dbUser = await getUserByEmail(user.email);
        if (dbUser) {
          token.uid = dbUser.id;
          // Cada login es una sesión del servidor (lib/account-security.ts): se lista en
          // Ajustes › Seguridad y se puede cerrar. Con dos pasos queda pendiente hasta el código.
          const { createSession, recordSecurityEvent } = await import('./account-security');
          const method = account?.provider === 'google' ? 'google' : 'email';
          token.sid = await createSession(dbUser.id, { method });
          await recordSecurityEvent({ userId: dbUser.id, action: 'login', meta: { method, mfa: Boolean(dbUser.mfa_enabled_at) } });
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      if (typeof token.sid === 'string') (session as { sid?: string }).sid = token.sid;
      return session;
    },
  },
};
