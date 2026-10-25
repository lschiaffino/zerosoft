import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getVideo, listVideoViews } from '@/lib/crm-media';
import PageHeader from '@/components/ui/PageHeader';
import VideoDetail from '@/components/crm/VideoDetail';

export const dynamic = 'force-dynamic';

export default async function VideoPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.media' });
  const video = await getVideo(user.id, id);
  if (!video) notFound();
  const views = await listVideoViews(user.id, id);
  const contact = video.contact_id
    ? ((await getDb().prepare('SELECT id, first_name, last_name, email FROM crm_contacts WHERE id = ?').get(video.contact_id)) as
        | { id: string; first_name: string; last_name: string; email: string }
        | undefined)
    : undefined;
  const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const canManage = isWorkspaceAdmin(user) || !video.created_by || video.created_by === realUserId(user);
  return (
    <div className="app-page ui-page">
      <PageHeader back={{ href: '/app/crm/videos', label: t('videosTitle') }} title={video.title} />
      <VideoDetail
        video={{
          id: video.id,
          title: video.title,
          url: `/api/crm/videos/${video.id}/file`,
          contentType: video.content_type,
          message: video.message,
          durationSec: video.duration_sec,
          contact: contact ? { id: contact.id, name: `${contact.first_name} ${contact.last_name}`.trim() || contact.email, email: contact.email } : null,
        }}
        views={views}
        shareUrl={`${baseUrl}/${locale}/watch/${video.token}`}
        canManage={canManage}
      />
    </div>
  );
}
