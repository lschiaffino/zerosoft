import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { issueExists } from '@/lib/analytics/errors';
import { parseIssueRef } from '@/lib/analytics/more-types';
import { getProject } from '@/lib/analytics/projects';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un error que no existe o es de otro workspace responde 404 y no 200. Solo lee. */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; ref: string }> }) {
  const { locale, ref } = await props.params;
  const user = await requireUser(locale);
  const parsed = parseIssueRef(ref);
  if (!parsed) notFound();
  const project = await getProject(user.id, parsed.projectId);
  if (!project || !(await issueExists(project.id, parsed.fingerprint))) notFound();
  return props.children;
}
