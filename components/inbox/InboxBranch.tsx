'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useShellBranch } from '@/components/app/useShellBranch';
import type { FolderDto } from '@/lib/inbox/types';
import { api, INBOX_CHANGED, notifyInboxChanged } from './api';
import { FolderDialog } from './InboxDialogs';

/**
 * Carpetas de Inbox en el sidebar, debajo de "Bandeja" (como las pizarras de
 * Board): con sus no leídos, la abierta marcada y "Nueva carpeta". Se recarga
 * al navegar y cuando la app avisa un cambio (INBOX_CHANGED).
 */
export default function InboxBranch() {
  const t = useTranslations('inbox.folders');
  const pathname = usePathname();
  const router = useRouter();
  const slot = useShellBranch();
  const [folders, setFolders] = useState<FolderDto[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<{ folders: FolderDto[] }>('/api/inbox/folders').then((r) => {
        if (alive && r.ok) setFolders(r.data.folders);
      });
    load();
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !folders) return null;
  const depth = (f: FolderDto): number => {
    let d = 0;
    let p = f.parentId;
    while (p && d < 4) {
      d++;
      p = folders.find((x) => x.id === p)?.parentId ?? null;
    }
    return d;
  };
  // Padres antes que hijos, en el orden guardado.
  const ordered: FolderDto[] = [];
  const add = (parent: string | null) => {
    for (const f of folders.filter((x) => (x.parentId ?? null) === parent)) {
      ordered.push(f);
      add(f.id);
    }
  };
  add(null);
  for (const f of folders) if (!ordered.includes(f)) ordered.push(f);

  return createPortal(
    <nav className="docs-branch ib-branch" aria-label={t('title')}>
      {folders.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branchEmpty')}</p>
      ) : (
        <ul className="docs-tree" role="list" aria-label={t('title')}>
          {ordered.map((f) => {
            const href = `/app/inbox/f/${f.id}`;
            const active = pathname === href;
            return (
              <li key={f.id} className={`docs-tree-row${active ? ' active' : ''}`} style={{ paddingLeft: depth(f) * 12 }}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={href} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                  <span className="docs-tree-icon" aria-hidden="true">
                    <span className="ib-swatch" style={{ background: f.color || 'var(--c-inbox)' }} />
                  </span>
                  <span className="docs-tree-title">{f.name}</span>
                  {f.count > 0 && <span className="ib-branch-count">{f.count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="ib-branch-new" onClick={() => setCreating(true)}>
        + {t('new')}
      </button>
      <FolderDialog
        open={creating}
        folder={null}
        onClose={() => setCreating(false)}
        onSaved={(f) => {
          setCreating(false);
          notifyInboxChanged();
          if (f) router.push(`/app/inbox/f/${f.id}`);
        }}
      />
    </nav>,
    slot,
  );
}
