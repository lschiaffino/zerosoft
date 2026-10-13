import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { listCredentials } from '@/lib/flow-credentials';
import { canEditFlows } from '@/lib/flow-http';
import CredentialsManager from '@/components/flow/CredentialsManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

export default async function FlowCredentialsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return <CredentialsManager credentials={await listCredentials(user.id)} canEdit={canEditFlows(user)} />;
}
