import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicBio } from '@/lib/link-bio';
import BioView from '@/components/link/BioView';
import '@/styles/link.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await props.params;
  const bio = await getPublicBio(handle);
  if (!bio) return {};
  return {
    title: `${bio.title} (@${bio.handle})`,
    description: bio.bio || undefined,
    openGraph: { title: bio.title, description: bio.bio || undefined, images: bio.avatarUrl ? [bio.avatarUrl] : undefined },
  };
}

/** Página pública link-in-bio: zerosoft.ai/@handle (el middleware la reescribe acá). */
export default async function BioPage(props: { params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;
  const bio = await getPublicBio(handle);
  if (!bio) notFound();

  return (
    <BioView
      title={bio.title}
      handle={bio.handle}
      bio={bio.bio}
      avatarUrl={bio.avatarUrl}
      links={bio.links}
      theme={bio.theme}
      accent={bio.accent}
    />
  );
}
