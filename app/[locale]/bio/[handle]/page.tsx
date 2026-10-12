import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicBio } from '@/lib/link-bio';
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
    <main className="bio-page">
      <div className="bio-card">
        {bio.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bio.avatarUrl} alt="" className="bio-avatar" />
        ) : (
          <span className="bio-avatar bio-avatar-fallback mono">{bio.title.slice(0, 1).toUpperCase()}</span>
        )}
        <h1 className="bio-title">{bio.title}</h1>
        <p className="bio-handle mono">@{bio.handle}</p>
        {bio.bio && <p className="bio-text">{bio.bio}</p>}
        <ul className="bio-links">
          {bio.links.map((l) => (
            <li key={l.id}>
              <a className="bio-link" href={l.href} rel="noopener">
                {l.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
