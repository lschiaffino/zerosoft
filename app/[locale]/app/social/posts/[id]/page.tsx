import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import Composer from '@/components/social/Composer';
import PostDetail from '@/components/social/PostDetail';
import { requireUser, userCanUseApp } from '@/lib/session';
import { getPost, listAccounts, listLibrary, listPostEvents, socialActor, socialRoleOf, SocialError } from '@/lib/social';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('post.title') };
}

/** Una publicación: estado por red, links a lo publicado, aprobación e historial. ?edit=1 abre el compositor. */
export default async function SocialPostPage(props: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { locale, id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const post = await getPost(actor, id).catch((err) => {
    if (err instanceof SocialError && err.status === 404) return null;
    throw err;
  });
  if (!post) notFound();
  const editing = sp.edit === '1' && post.canEdit;
  const back = { href: '/app/social/posts', label: t('posts.title') };
  if (editing) {
    const [accounts, library, role] = await Promise.all([listAccounts(actor), listLibrary(actor), socialRoleOf(actor)]);
    return (
      <div className="ui-page">
        <PageHeader title={t('compose.editTitle')} back={{ href: `/app/social/posts/${id}`, label: t('post.title') }} />
        <Composer accounts={accounts} post={post} library={library} canShorten={userCanUseApp(user, 'link')} drafter={role === 'drafter'} />
      </div>
    );
  }
  const events = await listPostEvents(actor, id);
  return (
    <div className="ui-page">
      <PageHeader title={t('post.title')} back={back} />
      <PostDetail post={post} events={events} />
    </div>
  );
}
