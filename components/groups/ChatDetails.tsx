'use client';

import GroupMembers from './wa/GroupMembers';
import { BriefcaseIcon, CheckCircle, GroupIcon, InfoIcon, Note, PhotoIcon, Retry, Sparkle } from './wa/icons';
import ChatAiTab from './wa/ChatAiTab';
import type { ChatInsights, ChatProposal, InsightRange } from '@/lib/wa-insights';
import type { AskResult } from './wa/ChatAiAsk';
import type { CreateResult } from './wa/ChatAiProposals';
import DetailsTabs from './wa/DetailsTabs';
import SharedMedia from './wa/SharedMedia';
import { ChatNotes, CrmDeals } from './ChatDetailsParts';
import type { SheetSharedItem } from './wa/ContactSheet';
import type { MemberTargetResult } from '@/lib/wa-group-members';
import type { NewChatEntry } from '@/lib/wa-new-chat';
import { useLinesPersonSheet } from './person-sheet';
import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, GroupsPerson, LabelDto, MemberDto, PropertyDef } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import { useGroupsInbox } from './InboxShell';
import GroupSettingsSection from './GroupSettingsSection';
import HubspotSection from './HubspotSection';
import PropertyInput from './PropertyInput';
import { ChatTasksSection, TASKS_CHANGED } from './TaskModal';
import { LabelTag, api, useErrorText, useToast } from './ui';
import { AuditLog } from './PlatformPanels';
import AssignmentHistory from './AssignmentHistory';
import { parseDbUtc } from '@/lib/utils';
import { phoneLabel } from '@/components/inbox/wa/util';

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

interface SharedRow {
  id: string;
  url: string;
  mime: string;
  name: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  urls?: string[];
  authorId?: string | null;
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
  starredKey = '',
  notesKey = '',
  aiUnread = 0,
  aiUnreadFrom,
  onJumpToMessage,
}: {
  chat: ChatDto;
  onChange: (c: ChatDto) => void;
  members: MemberDto[];
  people: GroupsPerson[];
  labels: LabelDto[];
  properties: PropertyDef[];
  agents: Array<{ id: string; name: string }>;
  /** null: la app CRM está apagada para quien mira; no hay sección CRM. */
  crm: { contact: CrmRef | null; company: CrmRef | null } | null;
  caps: ProviderCaps;
  /** Persona logueada (tareas: "para mí" por defecto). */
  me?: string;
  /** Quitar un chat de Groups es de admins. */
  isAdmin?: boolean;
  compact?: boolean;
  /** Cambia cuando cambian los destacados de la conversación: la lista se vuelve a leer. */
  starredKey?: string;
  /** Cambia cuando se escribe o se borra una nota interna en la conversación: la pestaña Notas se vuelve a leer. */
  notesKey?: string;
  /** Mensajes sin leer al abrir el chat: la pestaña AI ofrece resumir desde la última lectura. */
  aiUnread?: number;
  /** El primer mensaje sin leer al abrir el chat. */
  aiUnreadFrom?: string;
  /** Desde la conversación: un destacado lleva a su mensaje (sin esto no hay lista de destacados). */
  onJumpToMessage?: (id: string) => void;
}) {
  const t = useTranslations('groups');
  const tsheet = useTranslations('groups.wa.contactSheet');
  const errText = useErrorText();
  const router = useRouter();
  const locale = useLocale();
  const inbox = useGroupsInbox();
  const [toast, showToast] = useToast();
  const [members, setMembers] = useState(initialMembers);
  // Un miembro abre su ficha (como en WhatsApp), con Mensaje para ir a su chat 1:1 en la línea.
  const personSheet = useLinesPersonSheet(chat.id, (code) => showToast(errText(code), true), (text) => showToast(text));
  const [activityOpen, setActivityOpen] = useState(false);
  const [props, setProps] = useState<Record<string, unknown>>(chat.properties);
  const [memberBusy, setMemberBusy] = useState(false);
  const crmOn = crm !== null;
  const [crmState, setCrmState] = useState(crm ?? { contact: null, company: null });
  const [crmQuery, setCrmQuery] = useState('');
  const [crmResults, setCrmResults] = useState<Array<{ id: string; group: string; label: string; meta: string }>>([]);
  const [tickets, setTickets] = useState<TicketLite[] | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledLite[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [name, setName] = useState(chat.name);
  const [description, setDescription] = useState(chat.description);
  const isGroup = chat.kind === 'group';
  const tdet = useTranslations('groups.wa.details');
  // Lo compartido, los destacados y las notas del chat, para sus pestañas (Archivos, Notas).
  const loadShared = useCallback(
    async (kind: 'media' | 'docs' | 'links' | 'starred'): Promise<SheetSharedItem[] | null> => {
      const r = await api<{ items: SharedRow[] }>(`/api/groups/chats/${chat.id}?shared=${kind}`);
      if (!r.data) return null;
      return r.data.items.map((m) => ({
        id: m.id,
        url: m.url,
        video: m.mime.startsWith('video/'),
        kind: m.mime.startsWith('image/') ? 'image' : m.mime.startsWith('video/') ? 'video' : m.mime.startsWith('audio/') ? 'audio' : m.mime ? 'document' : undefined,
        name: m.name,
        body: m.body,
        sentAt: m.sentAt,
        fromMe: m.fromMe,
        senderName: m.senderName,
        ...(m.urls ? { urls: m.urls } : {}),
      }));
    },
    [chat.id],
  );

  // La pestaña AI: las ideas del rango, solo con lo que quien mira ve (app/api/groups/chats/[id]/summary).
  const runInsights = useCallback(
    async (range: InsightRange): Promise<{ ok: true; insights: ChatInsights } | { ok: false; code: string }> => {
      const r = await api<{ insights: ChatInsights }>(`/api/groups/chats/${chat.id}/summary`, { body: { kind: 'insights', range, locale } });
      return r.data ? { ok: true, insights: r.data.insights } : { ok: false, code: r.error ?? 'failed' };
    },
    [chat.id, locale],
  );
  const askChat = useCallback(
    async (question: string): Promise<AskResult> => {
      const r = await api<{ answer: string; messages: number }>(`/api/groups/chats/${chat.id}/summary`, { body: { kind: 'ask', question, locale } });
      return r.data ? { ok: true, answer: r.data } : { ok: false, code: r.error ?? 'failed' };
    },
    [chat.id, locale],
  );
  // Un seguimiento propuesto que la persona aprobó: con las mismas acciones de la pestaña Tareas (tarea del chat, que
  // va también a CRM › Tareas, o ticket).
  const createProposal = useCallback(
    async (p: ChatProposal): Promise<CreateResult> => {
      if (p.kind === 'ticket') {
        const r = await api<TicketLite>('/api/groups/tickets', { body: { chatId: chat.id, title: p.title, priority: p.priority } });
        if (!r.data) return { ok: false, code: r.error ?? 'failed' };
        const tk = r.data;
        setTickets((list) => [tk, ...(list ?? []).filter((x) => x.id !== tk.id)]);
        return { ok: true, created: { kind: 'ticket', href: `/app/lines/tickets?open=${tk.id}`, label: `#${tk.number} ${tk.title}` } };
      }
      const r = await api<{ id: string; title: string }>('/api/groups/tasks', {
        body: { chatId: chat.id, title: p.title, notes: p.notes, priority: p.priority, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      if (!r.data) return { ok: false, code: r.error ?? 'failed' };
      window.dispatchEvent(new Event(TASKS_CHANGED));
      return { ok: true, created: { kind: 'task', href: `/app/lines/tasks?open=${r.data.id}`, label: r.data.title || p.title } };
    },
    [chat.id],
  );

  // Cada campo vuelve al valor del servidor solo si ese valor cambió (o si es otro chat). Cualquier guardado
  // (una etiqueta, "mantener archivado") trae un chat nuevo con `properties` en otro objeto: depender del objeto
  // borraba lo que se estaba escribiendo en el nombre, la descripción o las propiedades.
  const propsKey = JSON.stringify(chat.properties ?? {});
  useEffect(() => {
    setProps(JSON.parse(propsKey) as Record<string, unknown>);
  }, [chat.id, propsKey]);
  useEffect(() => setName(chat.name), [chat.id, chat.name]);
  useEffect(() => setDescription(chat.description), [chat.id, chat.description]);

  useEffect(() => {
    void api<{ tickets: TicketLite[] }>(`/api/groups/tickets?chat=${chat.id}&status=all`).then((r) => setTickets(r.data?.tickets ?? []));
    void api<{ broadcasts: ScheduledLite[] }>(`/api/groups/broadcasts?chat=${chat.id}&kind=scheduled`).then((r) =>
      setScheduled((r.data?.broadcasts ?? []).filter((b) => b.status === 'scheduled')),
    );
  }, [chat.id]);

  useEffect(() => {
    const q = crmQuery.trim();
    if (!crmOn || q.length < 2) {
      setCrmResults([]);
      return;
    }
    const id = setTimeout(async () => {
      const r = await api<{ items: Array<{ id: string; group: string; label: string; meta: string }> }>(`/api/search?q=${encodeURIComponent(q)}`);
      setCrmResults((r.data?.items ?? []).filter((i) => i.group === 'contacts' || i.group === 'companies').slice(0, 8));
    }, 250);
    return () => clearTimeout(id);
  }, [crmQuery, crmOn]);

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

  async function syncMembers() {
    setMemberBusy(true);
    const res = await api<{ members: MemberDto[] }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'sync' } });
    setMemberBusy(false);
    if (res.data) setMembers(res.data.members);
    else showToast(errText(res.error), true);
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

  // "Bloquear a X" (chat 1:1): en WhatsApp, por el adaptador de la línea, como en la info del contacto de WhatsApp.
  async function setBlocked(on: boolean) {
    setConfirmBlock(false);
    const res = await api<ChatDto>(`/api/groups/chats/${chat.id}`, { body: { action: on ? 'block' : 'unblock' } });
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    onChange({ ...chat, blocked: !!res.data.blocked });
    showToast(on ? tsheet('blockedToast', { name: chat.name }) : tsheet('unblockedToast', { name: chat.name }));
  }

  const toggleLabel = (id: string) => {
    const ids = chat.labels.map((l) => l.id);
    void patch({ labelIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  };

  // Las secciones, una vez: el panel del chat (compact) las reparte en pestañas; la página del grupo las muestra
  // todas, una debajo de otra, como antes.
  const infoSection = (
    <>
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
              data-focus-target="description"
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
      {!isGroup && chat.about && (
        <section className="gr-detail-section">
          <h3 className="gr-detail-title">{t('details.about')}</h3>
          <p className="gr-pre gr-description-text wa-about">{chat.about}</p>
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
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            data-testid="keep-archived"
            checked={chat.keepArchived}
            onChange={(e) => {
              const on = e.target.checked;
              void patch({ keepArchived: on }).then((r) => r && showToast(on ? t('wa.keepArchivedOn') : t('wa.keepArchivedOffToast')));
            }}
          />
          {t('wa.keepArchived')}
        </label>
        <p className="ui-help">{t('wa.keepArchivedHint')}</p>
      </section>

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

      {isGroup && caps.groups && <GroupSettingsSection chat={chat} caps={caps} onChange={onChange} showToast={showToast} />}

    </>
  );
  const membersSection = isGroup ? (
    <>
      {isGroup && (
        <section className="gr-detail-section" data-testid="lines-members-section">
          <GroupMembers
            members={members}
            groupName={chat.name}
            canManage={caps.groups}
            unsupported={t('details.groupsUnsupported')}
            initialLink={chat.inviteLink}
            showPhone={phoneLabel}
            toast={showToast}
            limit={compact ? 30 : 200}
            more={
              compact
                ? (n) =>
                    n > 30 && (
                      <Link href={`/app/lines/list/${chat.id}`} className="ui-help">
                        {t('details.allMembers', { n })}
                      </Link>
                    )
                : undefined
            }
            onMembers={(list) => {
              setMembers(list as MemberDto[]);
              onChange({ ...chat, memberCount: list.length });
            }}
            run={async (action, targets) => {
              const res = await api<{ result: { results: MemberTargetResult[] }; members: MemberDto[] }>(`/api/groups/chats/${chat.id}/members`, {
                body: { action, ...targets },
              });
              if (!res.data) return { ok: false, error: res.error };
              // El encabezado de la página del grupo (servidor) y la lista muestran la cantidad.
              router.refresh();
              inbox.refresh();
              return { ok: true, results: res.data.result.results, members: res.data.members };
            }}
            searchContacts={async (q) => {
              const r = await api<{ frequent: NewChatEntry[]; contacts: NewChatEntry[] }>(
                `/api/groups/contacts?number=${encodeURIComponent(chat.numberId)}&q=${encodeURIComponent(q)}&limit=50`,
              );
              const seen = new Set<string>();
              return [...(r.data?.frequent ?? []), ...(r.data?.contacts ?? [])]
                .filter((e) => !seen.has(e.key) && seen.add(e.key))
                .map((e) => ({
                  key: e.key,
                  name: e.name,
                  phoneLabel: e.phoneLabel,
                  phone: e.phone,
                  pictureUrl: e.pictureUrl,
                  ref: e.contactId ? `contact:${e.contactId}` : e.chatId ? `chat:${e.chatId}` : undefined,
                }));
            }}
            getInviteLink={async (revoke) => {
              const res = await api<{ link: string }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'invite', revoke } });
              return res.data ? { link: res.data.link } : { error: res.error };
            }}
            sendInvite={async (targets, text) => {
              const res = await api<{ results: MemberTargetResult[] }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'inviteSend', ...targets, text } });
              return res.data ? { results: res.data.results } : { error: res.error };
            }}
            onOpen={(m) => personSheet.open({ phone: m.phone }, m.name || phoneLabel(m.phone), m.picture || undefined)}
            onMessage={async (m) => {
              const res = await api<{ id: string }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'message', phone: m.phone } });
              if (res.data) router.push(`/app/lines/inbox/${res.data.id}`);
              else showToast(errText(res.error), true);
            }}
          >
            {caps.groups && (
              // Una fila de acción más, como Agregar miembros (antes era un botón fantasma suelto y corrido).
              <div className="wa-gm-actions">
                <button type="button" className="wa-gm-action is-quiet" data-testid="group-sync-members" onClick={() => void syncMembers()} disabled={memberBusy} aria-busy={memberBusy || undefined}>
                  <span className="wa-gm-action-icon" aria-hidden="true">
                    <Retry size={18} />
                  </span>
                  {t('details.syncMembers')}
                </button>
              </div>
            )}
          </GroupMembers>
        </section>
      )}

    </>
  ) : null;
  const crmSection = (
    <>
      {crmOn && (
        <section className="gr-detail-section" data-testid="chat-crm">
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
      )}
      {crmOn && compact && (crmState.contact || crmState.company) && (
        <CrmDeals chatId={chat.id} version={`${crmState.contact?.id ?? ''}:${crmState.company?.id ?? ''}`} />
      )}

      <HubspotSection chatId={chat.id} isAdmin={isAdmin} showToast={showToast} />
      {!crmOn && compact && (
        <section className="gr-detail-section">
          <p className="ui-help">{tdet('crmOff')}</p>
        </section>
      )}
    </>
  );
  const tasksSection = (
    <>
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

    </>
  );
  const historySection = (
    <>
      <AssignmentHistory chatId={chat.id} people={people} version={chat.assignedTo ?? ''} />

      <section className="gr-detail-section" aria-labelledby={`gr-activity-${chat.id}`}>
        <details className="gr-activity" onToggle={(e) => setActivityOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="gr-detail-title" id={`gr-activity-${chat.id}`}>
            {t('audit.title')}
          </summary>
          {activityOpen && <AuditLog key={`${chat.assignedTo}-${chat.status}-${chat.labels.length}`} chatId={chat.id} people={people} compact />}
        </details>
      </section>

      {!isGroup && (chat.canBlock || chat.blocked) && (
        <section className="gr-detail-section gr-detail-block">
          <button
            type="button"
            className="btn btn-ghost btn-sm gr-danger"
            data-testid="chat-block"
            data-blocked={chat.blocked ? 'true' : undefined}
            onClick={() => (chat.blocked ? void setBlocked(false) : setConfirmBlock(true))}
          >
            {chat.blocked ? tsheet('unblockName', { name: chat.name }) : tsheet('blockName', { name: chat.name })}
          </button>
        </section>
      )}

      <section className="gr-detail-section gr-detail-foot">
        <p className="ui-help"><LocalText>{t('details.since', { time: parseDbUtc(chat.createdAt).toLocaleDateString(locale) })}</LocalText></p>
        {isAdmin && (
          <a className="btn btn-ghost btn-sm" href={`/api/groups/export?type=messages&chat=${chat.id}`}>
          {t('details.exportMessages')}
        </a>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setConfirmDelete(true)}>
            {t('details.remove')}
          </button>
        )}
      </section>
    </>
  );

  return (
    <div className={`gr-detail-body${compact ? ' is-compact' : ''}`}>
      {compact ? (
        <DetailsTabs
          storageKey={`zs-lines-details-tab:${me}`}
          label={tdet('tabsLabel')}
          tabs={[
            { id: 'info', label: tdet('tabs.info'), icon: <InfoIcon size={18} />, content: <>{infoSection}{historySection}</> },
            ...(membersSection ? [{ id: 'members', label: tdet('tabs.members'), icon: <GroupIcon size={18} />, count: chat.memberCount || members.length, content: membersSection }] : []),
            {
              id: 'media',
              label: tdet('tabs.media'),
              icon: <PhotoIcon size={18} />,
              content: <SharedMedia key={chat.id} load={loadShared} chatName={chat.name} starredKey={starredKey} onJumpToMessage={onJumpToMessage} />,
            },
            { id: 'notes', label: tdet('tabs.notes'), icon: <Note size={18} />, content: <ChatNotes chatId={chat.id} people={people} me={me} version={notesKey} onJumpToMessage={onJumpToMessage} /> },
            { id: 'tasks', label: tdet('tabs.tasks'), icon: <CheckCircle size={18} />, content: tasksSection },
            { id: 'crm', label: tdet('tabs.crm'), icon: <BriefcaseIcon size={18} />, content: crmSection },
            {
              id: 'ai',
              label: tdet('tabs.ai'),
              icon: <Sparkle size={18} />,
              content: (
                <ChatAiTab
                  key={chat.id}
                  chatKey={chat.id}
                  stateUrl={`/api/groups/chats/${chat.id}?part=ai`}
                  run={runInsights}
                  unread={aiUnread}
                  unreadFrom={aiUnreadFrom}
                  sectionClass="gr-detail-section"
                  titleClass="gr-detail-title"
                  askChat={askChat}
                  kinds={['task', 'ticket']}
                  where={tdet('ai.whereLines')}
                  createProposal={createProposal}
                />
              ),
            },
          ]}
        />
      ) : (
        <>
          {infoSection}
          {membersSection}
          {crmSection}
          {tasksSection}
          {historySection}
        </>
      )}
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
      <ConfirmDialog
        open={confirmBlock}
        title={tsheet('blockTitle', { name: chat.name })}
        body={tsheet('blockBody', { name: chat.name })}
        confirmLabel={tsheet('block')}
        cancelLabel={tsheet('cancel')}
        danger
        onConfirm={() => void setBlocked(true)}
        onCancel={() => setConfirmBlock(false)}
      />
      {personSheet.sheet}
      {toast}
    </div>
  );
}
