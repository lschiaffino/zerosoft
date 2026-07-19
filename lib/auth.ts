import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { upsertUser, getUserByEmail } from './db';
import { seedUserIfNeeded } from './seed';

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
  callbacks: {
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
