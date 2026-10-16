'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';
import EmptyState from '@/components/ui/EmptyState';

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  company: string;
  lifecycle: string;
  lifecycleLabel: string;
  created: string;
}

interface SearchResult {
  id: string;
  name: string;
  email: string;
}

interface ListMembersProps {
  listId: string;
  members: MemberRow[];
}

/** Miembros de una lista estática: quitar + agregar (search contra /api/crm/contacts). */
export default function ListMembers({ listId, members }: ListMembersProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Búsqueda con debounce de contactos para agregar.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/crm/contacts?q=${encodeURIComponent(q)}&pageSize=6`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then(
          (data: {
            rows: Array<{ id: string; first_name: string; last_name: string; email: string }>;
          }) => {
            setResults(
              data.rows.map((c) => ({
                id: c.id,
                name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
                email: c.email,
              })),
            );
            setSearching(false);
          },
        )
        .catch(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  async function addMember(contactId: string) {
    setBusyId(contactId);
    await fetch(`/api/crm/lists/${listId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId] }),
    }).catch(() => null);
    setBusyId(null);
    setSearch('');
    setResults([]);
    router.refresh();
  }

  async function removeMember(contactId: string) {
    setBusyId(contactId);
    await fetch(`/api/crm/lists/${listId}/members`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId }),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  const memberIds = new Set(members.map((m) => m.id));

  return (
    <div className="list-members">
      <div className="member-add">
        <input
          className="input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('lists.addMembers')}
          aria-label={t('lists.addMembers')}
        />
        {(searching || results.length > 0) && (
          <div className="member-results">
            {results
              .filter((r) => !memberIds.has(r.id))
              .map((r) => (
                <div className="member-result" key={r.id}>
                  <span>
                    {r.name} <span className="muted">{r.email}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyId === r.id}
                    aria-busy={busyId === r.id || undefined}
                    onClick={() => addMember(r.id)}
                  >
                    {t('common.add')}
                  </button>
                </div>
              ))}
            {!searching && results.filter((r) => !memberIds.has(r.id)).length === 0 && (
              <p className="muted member-result-empty">{t('record.noResults')}</p>
            )}
          </div>
        )}
      </div>

      {members.length === 0 ? (
        <EmptyState quiet title={t('record.empty.staticListTitle')} body={t('record.empty.staticListBody')} />
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <caption className="sr-only">{t('lists.membersTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('contacts.table.name')}</th>
                <th scope="col">{t('contacts.table.email')}</th>
                <th scope="col">{t('contacts.table.company')}</th>
                <th scope="col">{t('contacts.table.lifecycle')}</th>
                <th scope="col">{t('contacts.table.created')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={busyId === m.id ? 'row-busy' : undefined}>
                  <td>
                    <Link href={`/app/crm/contacts/${m.id}`} className="cell-name">
                      {m.name}
                    </Link>
                  </td>
                  <td className="muted cell-email">{m.email || '—'}</td>
                  <td className="muted">{m.company || '—'}</td>
                  <td>
                    <span className={`badge stage-${m.lifecycle}`}>{m.lifecycleLabel}</span>
                  </td>
                  <td className="num muted cell-date">{m.created}</td>
                  <td>
                    <div className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm row-delete"
                        title={t('lists.removeMember')}
                        aria-label={t('lists.removeMember')}
                        onClick={() => removeMember(m.id)}
                      >
                        <CrmIcon name="x" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
