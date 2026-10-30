'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { setProjectCookie } from './client';

/**
 * Al abrir algo de otro proyecto (un link, ⌘K), ese pasa a ser el proyecto
 * que se mira: el selector de arriba y el sidebar se ponen al día.
 */
export default function SyncProject({ projectId, currentId }: { projectId: string; currentId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (projectId === currentId) return;
    setProjectCookie(projectId);
    router.refresh();
  }, [projectId, currentId, router]);
  return null;
}
