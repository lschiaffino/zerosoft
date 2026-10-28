import { useTranslations } from 'next-intl';
import type { LinkStatus } from '@/lib/links';

const TONE: Record<LinkStatus, string> = {
  active: 'badge-ok',
  archived: '',
  blocked: 'badge-bad',
  expired: 'badge-warn',
  limit: 'badge-warn',
  protected: 'badge-info',
};

const KEY: Record<LinkStatus, string> = {
  active: 'statusActive',
  archived: 'statusArchived',
  blocked: 'statusBlocked',
  expired: 'statusExpired',
  limit: 'statusLimit',
  protected: 'statusProtected',
};

/** Estado de un link como badge recto del kit (.badge-ok, -warn, -info). */
export default function StatusBadge({ status }: { status: LinkStatus }) {
  const t = useTranslations('link.table');
  return <span className={`badge ${TONE[status]}`.trim()}>{t(KEY[status])}</span>;
}
