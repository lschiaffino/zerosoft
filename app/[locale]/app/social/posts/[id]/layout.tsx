import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getPost, socialActor, SocialError } from '@/lib/social';

/** Arriba de loading.tsx: un registro que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const post = await getPost(socialActor(user), id).catch((err) => {
    if (err instanceof SocialError && err.status === 404) return null;
    throw err;
  });
  if (!post) notFound();
  return props.children;
}
