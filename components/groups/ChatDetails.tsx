'use client';

import { MessageMenu } from './ThreadParts';
import LocalText from '@/components/ui/LocalText';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, GroupsPerson, LabelDto, MemberDto, PropertyDef } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import { useGroupsInbox } from './InboxShell';
import GroupSettingsSection from './GroupSettingsSection';
import HubspotSection from './HubspotSection';
import PropertyInput from './PropertyInput';
import { ChatTasksSection } from './TaskModal';
import { LabelTag, api, useErrorText, useToast } from './ui';
import { AuditLog } from './PlatformPanels';
import { parseDbUtc } from '@/lib/utils';

interface CrmRef {
  id: string;
  name: string;
}

interface TicketLite {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  breached: boolean;
}

interface ScheduledLite {
  id: string;
  body: string;
  scheduledAt: string;
  status: string;
}

/**
 * Detalles de un chat o grupo: asignación, etiquetas, propiedades, vínculo
 * con el CRM y con HubSpot, agente de Agents, miembros (agregar, quitar, admins), link de
 * invitación, tickets, programados y export. Lo usan la bandeja (columna
 * derecha) y la página del grupo.
 */
export default function ChatDetails({
  chat,
  onChange,
  members: initialMembers,
  people,
  labels,
  properties,
  agents,
  crm,
  caps,
  me = '',
  isAdmin = false,
  compact = false,
}: {
  chat: ChatDto;
  onChange: (c: ChatDto) => void;
  members: MemberDto[];
  people: GroupsPerson[];
  labels: LabelDto[];
  properties: PropertyDef[];
  agents: Array<{ id: string; name: string }>;
  crm: { contact: CrmRef | null; company: CrmRef | null };
  caps: ProviderCaps;
  /** Persona logueada (tareas: "para mí" por defecto). */
  me?: string;
  /** Quitar un chat de Groups es de admins. */
  isAdmin?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const locale = useLocale();
  const inbox = useGroupsInbox();
  const [toast, showToast] = useToast();
  const [members, setMembers] = useState(initialMembers);
  const [activityOpen, setActivityOpen] = useState(false);
  const [props, setProps] = useState<Record<string, unknown>>(chat.properties);
  const [phones, setPhones] = useState('');
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberResult, setMemberResult] = useState<Array<{ phone: string; ok: boolean; error?: string }> | null>(null);
  const [link, setLink] = useState(chat.inviteLink);
  const [crmState, setCrmState] = useState(crm);
  const [crmQuery, setCrmQuery] = useState('');
  const [crmResults, setCrmResults] = useState<Array<{ id: string; group: string; label: string; meta: string }>>([]);
  const [tickets, setTickets] = useState<TicketLite[] | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledLite[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(chat.name);
  const [description, setDescription] = useState(chat.description);
  const isGroup = chat.kind === 'group';

  useEffect(() => {
    setProps(chat.properties);
    setName(chat.name);
    setDescription(chat.description);
    setLink(chat.inviteLink);
  }, [chat.id, chat.properties, chat.name, chat.description, chat.inviteLink]);

  useEffect(() => {
    void api<{ tickets: TicketLite[] }>(`/api/groups/tickets?chat=${chat.id}&status=all`).then((r) => setTickets(r.data?.tickets ?? []));
    void api<{ broadcasts: ScheduledLite[] }>(`/api/groups/broadcasts?chat=${chat.id}&kind=scheduled`).then((r) =>
      setScheduled((r.data?.broadcasts ?? []).filter((b) => b.status === 'scheduled')),
    );
  }, [chat.id]);

  useEffect(() => {
    const q = crmQuery.trim();
    if (q.length < 2) {
      setCrmResults([]);
      return;
    }
    const id = setTimeout(async () => {
      const r = await api<{ items: Array<{ id: string; group: string; label: string; meta: string }> }>(`/api/search?q=${encodeURIComponent(q)}`);
      setCrmResults((r.data?.items ?? []).filter((i) => i.group === 'contacts' || i.group === 'companies').slice(0, 8));
    }, 250);
    return () => clearTimeout(id);
  }, [crmQuery]);

  async function patch(body: Record<string, unknown>) {
    const res = await api<ChatDto>(`/api/groups/chats/${chat.id}`, { method: 'PATCH', body });
    if (res.data) {
      onChange(res.data);
      // El nombre también vive en el título de la página (servidor) y en la lista: se refrescan.
      if (typeof body.name === 'string') router.refresh();
      inbox.refresh();
    } else showToast(errText(res.error), true);
    return res.data;
  }

  const [memberQ, setMemberQ] = useState('');
  // Grupos grandes (1.000 miembros): se dibujan de a 200.
  const [memberLimit, setMemberLimit] = useState(200);
  const shownMembers = memberQ.trim()
    ? members.filter((m) => `${m.name} ${m.phone}`.toLowerCase().includes(memberQ.trim().toLowerCase().replace(/^\+/, '')))
    : members;

  async function memberAction(action: 'add' | 'remove' | 'promote' | 'demote', list: string[]) {
    setMemberBusy(true);
    setMemberResult(null);
    const res = await api<{ result: { results: Array<{ phone: string; ok: boolean; error?: string }> }; members: MemberDto[] }>(
      `/api/groups/chats/${chat.id}/members`,
      { body: { action, phones: list } },
    );
    setMemberBusy(false);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    setMembers(res.data.members);
    onChange({ ...chat, memberCount: res.data.members.length });
    // El encabezado de la página del grupo (servidor) y la lista muestran la cantidad.
    router.refresh();
    inbox.refresh();
    if (action === 'add') {
      setMemberResult(res.data.result.results);
      setPhones('');
    }
  }

  async function syncMembers() {
    setMemberBusy(true);
    const res = await api<{ members: MemberDto[] }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'sync' } });
    setMemberBusy(false);
    if (res.data) setMembers(res.data.members);
    else showToast(errText(res.error), true);
  }

  async function invite(revoke: boolean) {
    const res = await api<{ link: string }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'invite', revoke } });
    if (res.data) {
      setLink(res.data.link);
      showToast(revoke ? t('details.inviteRevoked') : t('details.inviteReady'));
    } else showToast(errText(res.error), true);
  }

  async function linkCrm(item: { id: string; group: string; label: string }) {
    const body = item.group === 'contacts' ? { crmContactId: item.id } : { crmCompanyId: item.id };
    const res = await patch(body);
    if (res) {
      setCrmState((s) => (item.group === 'contacts' ? { ...s, contact: { id: item.id, name: item.label } } : { ...s, company: { id: item.id, name: item.label } }));
      setCrmQuery('');
      setCrmResults([]);
    }
  }

  async function cancelScheduled(id: string) {
    const res = await api(`/api/groups/broadcasts/${id}`, { method: 'PATCH', body: { action: 'cancel' } });
    if (res.data) setScheduled((s) => (s ?? []).filter((x) => x.id !== id));
    else showToast(errText(res.error), true);
  }

  async function remove() {
    const res = await api(`/api/groups/chats/${chat.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    if (compact) {
      // Desde la bandeja: se sigue en la bandeja, en el chat siguiente.
      const i = inbox.rows.findIndex((r) => r.id === chat.id);
      const next = inbox.rows.filter((r) => r.id !== chat.id)[Math.max(0, i)] ?? null;
      inbox.refresh();
      router.push(next ? `/app/lines/inbox/${next.id}` : '/app/lines/inbox');
    } else {
      router.push('/app/lines/list');
      router.refresh();
    }
  }

  const toggleLabel = (id: string) => {
    const ids = chat.labels.map((l) => l.id);
    void patch({ labelIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  };

  return (
    <div className={`gr-detail-body${compact ? ' is-compact' : ''}`}>
      {!compact && (
        <section className="gr-detail-section">
          <h3 className="gr-detail-title">{t('details.name')}</h3>
          <form
            className="gr-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name !== chat.name) void patch({ name });
            }}
          >
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label={t('details.name')} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={!name.trim() || name === chat.name}>
              {t('common.save')}
            </button>
          </form>
          {isGroup && !caps.groups && <p className="ui-help">{t('details.renameLocal')}</p>}
        </section>
      )}

      {!compact && isGroup && (
        <section className="gr-detail-section">
          <h3 className="gr-detail-title">{t('details.description')}</h3>
          <form
            className="ui-fields"
            onSubmit={(e) => {
              e.preventDefault();
              if (description !== chat.description) void patch({ description }).then((d) => d && showToast(t('common.saved')));
            }}
          >
            <textarea
              className="input gr-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('details.descriptionPlaceholder')}
              aria-label={t('details.description')}
            />
            <div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={description === chat.description}>
                {t('common.save')}
              </button>
            </div>
          </form>
          {caps.groups && <p className="ui-help">{t('details.descriptionHelp')}</p>}
        </section>
      )}
      {compact && isGroup && chat.description && (
        <section className="gr-detail-section">
          <h3 className="gr-detail-title">{t('details.description')}</h3>
          <p className="gr-pre gr-description-text">{chat.description}</p>
        </section>
      )}

      {compact && isGroup && (
        <p className="gr-detail-link">
          <Link href={`/app/lines/list/${chat.id}`}>{t('details.openGroup')}</Link>
        </p>
      )}

      <section className="gr-detail-section">
        <h3 className="gr-detail-title">{t('details.labels')}</h3>
        {labels.length === 0 ? (
          <p className="ui-help">
            {t('details.noLabels')} <Link href="/app/lines/settings?tab=labels">{t('details.manageLabels')}</Link>
          </p>
        ) : (
          <div className="gr-label-picker">
            {labels.map((l) => {
              const on = chat.labels.some((x) => x.id === l.id);
              return (
                <button key={l.id} type="button" className={`gr-label-toggle${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleLabel(l.id)}>
                  <LabelTag name={l.name} color={l.color} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="gr-detail-section">
        <h3 className="gr-detail-title">{t('details.crm')}</h3>
        <ul className="gr-crm-links">
          {crmState.company && (
            <li>
              <Link href={`/app/crm/companies/${crmState.company.id}`}>{crmState.company.name}</Link>
              <span className="ui-help">{t('details.company')}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void patch({ crmCompanyId: null }).then((r) => r && setCrmState((s) => ({ ...s, company: null })))}
              >
                {t('common.remove')}
              </button>
            </li>
          )}
          {crmState.contact && (
            <li>
              <Link href={`/app/crm/contacts/${crmState.contact.id}`}>{crmState.contact.name}</Link>
              <span className="ui-help">{t('details.contact')}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void patch({ crmContactId: null }).then((r) => r && setCrmState((s) => ({ ...s, contact: null })))}
              >
                {t('common.remove')}
              </button>
            </li>
          )}
        </ul>
        {(!crmState.company || !crmState.contact) && (
          <div className="gr-crm-search">
            <input className="input" type="search" value={crmQuery} onChange={(e) => setCrmQuery(e.target.value)} placeholder={t('details.crmSearch')} aria-label={t('details.crmSearch')} />
            {crmResults.length > 0 && (
              <ul className="gr-crm-results">
                {crmResults.map((r) => (
                  <li key={`${r.group}-${r.id}`}>
                    <button type="button" onClick={() => void linkCrm(r)}>
                      {r.label} <span className="ui-help">{r.group === 'contacts' ? t('details.contact') : t('details.company')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="ui-help">{t('details.crmHelp')}</p>
      </section>

      <HubspotSection chatId={chat.id} isAdmin={isAdmin} showToast={showToast} />

      {properties.length > 0 && (
        <section className="gr-detail-section">
          <h3 className="gr-detail-title">{t('details.properties')}</h3>
          <form
            className="ui-fields"
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ properties: props }).then((r) => r && showToast(t('common.saved')));
            }}
          >
            {properties.map((p) => (
              <PropertyInput key={p.id} def={p} value={props[p.key]} onChange={(v) => setProps({ ...props, [p.key]: v })} />
            ))}
            <div>
              <button type="submit" className="btn btn-secondary btn-sm">
                {t('common.save')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="gr-detail-section">
        <h3 className="gr-detail-title">{t('details.agent')}</h3>
        <select className="select" value={chat.agentId ?? ''} onChange={(e) => void patch({ agentId: e.target.value || null })} aria-label={t('details.agent')}>
          <option value="">{t('details.noAgent')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="ui-help">{agents.length === 0 ? t('details.agentNone') : t('details.agentHelp')}</p>
      </section>

      {isGroup && (
        <section className="gr-detail-section">
          <div className="gr-detail-head">
            <h3 className="gr-detail-title">{t('details.members', { n: members.length })}</h3>
            {caps.groups && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void syncMembers()} aria-busy={memberBusy || undefined}>
                {t('details.syncMembers')}
              </button>
            )}
          </div>
          {!caps.groups ? (
            <p className="ui-help">{t('details.groupsUnsupported')}</p>
          ) : (
            <>
              <form
                className="gr-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const list = phones.split(/[\n,;]+/).filter(Boolean);
                  if (list.length) void memberAction('add', list);
                }}
              >
                <input className="input" value={phones} onChange={(e) => setPhones(e.target.value)} placeholder={t('details.addPlaceholder')} aria-label={t('details.addMembers')} />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={!phones.trim() || memberBusy}>
                  {t('details.add')}
                </button>
              </form>
              {memberResult && memberResult.some((r) => !r.ok) && (
                <p className="ui-help" role="status">
                  {t('details.notAdded', { phones: memberResult.filter((r) => !r.ok).map((r) => `+${r.phone}`).join(', ') })}
                </p>
              )}
              {members.length > 8 && (
                <input
                  className="input gr-member-search"
                  type="search"
                  value={memberQ}
                  onChange={(e) => setMemberQ(e.target.value)}
                  placeholder={t('details.searchMembers')}
                  aria-label={t('details.searchMembers')}
                />
              )}
              <ul className="gr-members">
                {shownMembers.slice(0, compact && !memberQ ? 30 : memberLimit).map((m) => (
                  <li key={m.phone}>
                    <span className="gr-member-who">
                      <span className="gr-member-name">{m.name || `+${m.phone}`}</span>
                      {m.name && <span className="gr-member-phone ui-help">+{m.phone}</span>}
                    </span>
                    {m.role !== 'member' && <span className="badge badge-outline">{t(`roles.${m.role}`)}</span>}
                    {m.role !== 'superadmin' && !(m as MemberDto & { masked?: boolean }).masked && (
                      <span className="gr-member-actions">
                        <MessageMenu
                          label={t('details.memberOptions', { name: m.name || `+${m.phone}` })}
                          align="right"
                          items={[
                            { key: 'role', label: m.role === 'admin' ? t('details.demote') : t('details.promote'), onSelect: () => void memberAction(m.role === 'admin' ? 'demote' : 'promote', [m.phone]) },
                            { key: 'remove', label: t('details.removeMember'), danger: true, onSelect: () => void memberAction('remove', [m.phone]) },
                          ]}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {!(compact && !memberQ) && shownMembers.length > memberLimit && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMemberLimit((n) => n + 200)}>
                  {t('details.moreMembers', { n: shownMembers.length - memberLimit })}
                </button>
              )}
              {compact && !memberQ && members.length > 30 && (
                <Link href={`/app/lines/list/${chat.id}`} className="ui-help">
                  {t('details.allMembers', { n: members.length })}
                </Link>
              )}
              <div className="gr-invite">
                <h4 className="gr-detail-title">{t('details.invite')}</h4>
                {link.startsWith('sample:') ? (
                  <p className="gr-banner" role="status">
                    {t('details.sampleInvite')}
                  </p>
                ) : link ? (
                  <p className="gr-invite-link">
                    <input className="input" readOnly value={link} aria-label={t('details.invite')} onFocus={(e) => e.target.select()} />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(link).catch(() => null);
                        showToast(t('common.copied'));
                      }}
                    >
                      {t('common.copy')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void invite(true)}>
                      {t('details.revoke')}
                    </button>
                  </p>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void invite(false)}>
                    {t('details.getInvite')}
                  </button>
                )}
                <p className="ui-help">{t('details.inviteHelp')}</p>
              </div>
            </>
          )}
        </section>
      )}

      {isGroup && caps.groups && <GroupSettingsSection chat={chat} caps={caps} onChange={onChange} showToast={showToast} />}

      <ChatTasksSection chatId={chat.id} people={people} me={me} />

      <section className="gr-detail-section">
        <h3 className="gr-detail-title">{t('details.tickets')}</h3>
        {tickets === null ? (
          <p className="ui-help">{t('common.loading')}</p>
        ) : tickets.length === 0 ? (
          <p className="ui-help">{t('details.noTickets')}</p>
        ) : (
          <ul className="gr-mini-list">
            {tickets.slice(0, 8).map((tk) => (
              <li key={tk.id}>
                <Link href={`/app/lines/tickets?open=${tk.id}`}>
                  #{tk.number} {tk.title}
                </Link>
                <span className={`badge ${tk.breached ? 'badge-bad' : 'badge-outline'}`}>{t(`ticketStatus.${tk.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {scheduled && scheduled.length > 0 && (
        <section className="gr-detail-section">
          <h3 className="gr-detail-title">{t('details.scheduled')}</h3>
          <ul className="gr-mini-list">
            {scheduled.map((s) => (
              <li key={s.id}>
                <span>
                  <LocalText>{parseDbUtc(s.scheduledAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</LocalText> · {s.body.slice(0, 60)}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancelScheduled(s.id)}>
                  {t('common.cancel')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="gr-detail-section" aria-labelledby={`gr-activity-${chat.id}`}>
        <details className="gr-activity" onToggle={(e) => setActivityOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="gr-detail-title" id={`gr-activity-${chat.id}`}>
            {t('audit.title')}
          </summary>
          {activityOpen && <AuditLog key={`${chat.assignedTo}-${chat.status}-${chat.labels.length}`} chatId={chat.id} people={people} compact />}
        </details>
      </section>

      <section className="gr-detail-section gr-detail-foot">
        <p className="ui-help"><LocalText>{t('details.since', { time: parseDbUtc(chat.createdAt).toLocaleDateString(locale) })}</LocalText></p>
        <a className="btn btn-ghost btn-sm" href={`/api/groups/export?type=messages&chat=${chat.id}`}>
          {t('details.exportMessages')}
        </a>
        {isAdmin && (
          <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setConfirmDelete(true)}>
            {t('details.remove')}
          </button>
        )}
      </section>
      <ConfirmDialog
        open={confirmDelete}
        title={t('details.removeTitle')}
        body={t('details.removeBody')}
        confirmLabel={t('details.removeConfirm')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      {toast}
    </div>
  );
}
