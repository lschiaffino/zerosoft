import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { listVariables } from '@/lib/flow-variables';
import { canEditFlows } from '@/lib/flow-http';
import VariablesManager from '@/components/flow/VariablesManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

/** Variables de quien mira ({{vars.x}} en los flows que corren con su acceso). */
export default async function FlowVariablesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return <VariablesManager variables={await listVariables(user.id, user.actingUser?.id ?? user.id)} canEdit={canEditFlows(user)} />;
}
