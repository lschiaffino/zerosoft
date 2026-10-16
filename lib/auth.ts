import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { upsertUser, getUserByEmail } from './db';
import { seedUserIfNeeded } from './seed';
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

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/en/auth/signin' },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: sessionCookies(),
  callbacks: {
    // Volver después del login: mismo origen o un host de la app de confianza
    // (p. ej. feedback.zerosoft.ai). El login siempre ocurre en NEXTAUTH_URL.
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl}${url}`;
      return isTrustedReturnUrl(url, baseUrl) ? url : baseUrl;
    },
    async signIn({ user }) {
      if (!user.email) return false;
      const dbUser = await upsertUser({ email: user.email, name: user.name, image: user.image });
      await seedUserIfNeeded(dbUser.id);
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await getUserByEmail(user.email);
        if (dbUser) token.uid = dbUser.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
};
