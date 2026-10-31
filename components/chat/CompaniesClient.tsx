'use client';

import { useTranslations } from 'next-intl';
import ChatCollection, { type CollectionItem } from './ChatCollection';

interface Company extends CollectionItem {
  domain: string | null;
  plan: string | null;
  notes: string | null;
  people: number;
}

export default function CompaniesClient() {
  const t = useTranslations('chat');
  return (
    <ChatCollection<Company>
      ns="companies"
      api="/api/chat/companies"
      listKey="companies"
      canManage
      fields={[
        { id: 'name', label: t('companies.name'), type: 'text', required: true, maxLength: 120 },
        { id: 'domain', label: t('companies.domain'), type: 'text', maxLength: 200, placeholder: 'acme.com' },
        { id: 'plan', label: t('companies.plan'), type: 'text', maxLength: 80 },
        { id: 'notes', label: t('companies.notes'), type: 'textarea', maxLength: 2000 },
      ]}
      columns={[
        { label: t('companies.name'), render: (c) => c.name },
        { label: t('companies.domain'), render: (c) => c.domain ?? '–' },
        { label: t('companies.plan'), render: (c) => c.plan ?? '–' },
        { label: t('companies.people'), render: (c) => c.people },
      ]}
    />
  );
}
