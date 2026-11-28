'use client';

import LocalText from '@/components/ui/LocalText';
import { useMounted } from '@/components/ui/useMounted';
import { DEFAULT_CALL_OUTCOMES, formatCallDuration, isDefaultOutcome } from '@/lib/crm-calls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPOSE_EVENT, type ComposeType } from './recordLayout';
import { useTranslations } from 'next-intl';
import { announceQueued, isQueuedResponse } from '@/lib/offline-queue';
import { Link, useRouter } from '@/i18n/navigation';
import type { EmailThreadView } from '@/lib/crm-email';
import EmailThread from './EmailThread';
import CrmIcon, { type CrmIconName } from './CrmIcon';
import { useCrmOptions } from './CrmViewer';
import FilesPanel, { type FileItem } from './FilesPanel';
import CallDetails from './CallDetails';
import type { CallView } from '@/lib/crm-voice';
import MentionTextarea from './MentionTextarea';
import NoteEditor, { RichNoteBody } from './RichNote';
import ActivityComments from './ActivityComments';
import { NOTE_MD_MAX, noteMarkdownToText, plainToMarkdown } from '@/lib/crm-note-format';
import type { Mentionable } from '@/lib/crm-mentions';
import CallSummaryBlock, { type CallSummaryState } from './CallSummaryBlock';
import CallFollowupBlock from './CallFollowupBlock';
import TimelineMenu from './TimelineMenu';
import RecordCombobox, { type ComboOption } from './RecordCombobox';
import { searchAssociable } from './assocSearch';
import {
  applyFilters,
  groupTimeline,
  relativeTime,
  tabCounts,
  timelineAuthors,
  TIMELINE_TYPES,
  type TimelineTab,
  type TimelineType,
} from './timelineModel';
import { parseDbUtc } from '@/lib/utils';
import { formatMoney } from '@/lib/crm-money';

/** Lo que suma la respuesta al guardar una nota o tarea con @menciones (lib/crm-mention-notify.ts). */
interface MentionsReply {
  mentions_not_notified?: Array<{ id: string; name: string }>;
}

/** lead y objectRecord: leads y registros de objetos propios (sin emails). */
export type TimelineRecordType = 'contact' | 'company' | 'deal' | 'lead' | 'objectRecord';

export interface TimelineItem {
  id: string;
  type: 'note' | 'task' | 'call' | 'meeting' | 'email' | 'whatsapp' | 'change';
  /** Tarea de llamada o email (077). */
  task_kind?: '' | 'call' | 'email';
  subject: string;
  body: string;
  /** Notas: 'md' = con formato (C1); sin dato o 'text', texto plano. */
  body_format?: 'text' | 'md';
  /** Comentarios del hilo de la actividad (C1) y la actividad donde cuelga (un thread de emails: la suya). */
  comment_count?: number;
  comment_activity_id?: string;
  due_at: string | null;
  done: 0 | 1;
  pinned: 0 | 1;
  direction: string;
  outcome: string;
  /** Llamadas: 'whatsapp' si el toque fue por WhatsApp. */
  channel?: string;
  duration_min: number | null;
  contact_name?: string | null;
  company_name?: string | null;
  deal_name?: string | null;
  created_at: string;
  /** Thread de emails (Gmail o enviados desde el CRM) o chat de Lines: read-only. */
  external?: boolean;
  from_email?: string;
  thread?: EmailThreadView;
  /** Adjuntos de la actividad. */
  files?: FileItem[];
  /** Registros de la actividad. */
  contact_id?: string | null;
  company_id?: string | null;
  deal_id?: string | null;
  /** Llamadas y reuniones: resumen con IA guardado. */
  ai_summary?: CallSummaryState | null;
  /** Llamada desde el navegador: grabación, transcripción y resumen. */
  voice?: CallView;
  /** Tareas: de dónde vienen fuera del CRM (lib/tasks.ts), con link de vuelta. */
  source?: { href: string; app: 'groups' | 'chat' | 'docs' | 'track'; label: string };
  /** Tarea de un chat de Lines que quien mira no ve: el título es el marcador, sin notas y sin editar el texto. */
  chat_private?: 1;
  /** 1 = viene de un registro asociado (lib/crm-timeline.ts). */
  rollup?: 0 | 1;
  /** Quién la registró (owner; sin owner, el dueño del workspace). */
  author_id?: string;
  author_name?: string | null;
  /** Chat de Lines vinculado (lib/crm-timeline.ts listRecordChats). */
  wa?: { chatId: string; group: boolean; messages: Array<{ id: string; at: string; out: boolean; who: string; text: string }> };
  /** Cambio de una propiedad (lib/crm-timeline.ts listPropertyChanges): una línea, sin acciones. */
  change?: {
    field: string;
    label?: string;
    from: string;
    to: string;
    reason: string;
    actor?: string;
    fromPrivate?: boolean;
    toPrivate?: boolean;
    valueType?: string;
    currency?: string;
  };
}

/** Nombres de las propiedades de fábrica y de sus valores, los mismos del panel Historial de la ficha. */
export interface ChangeLabels {
  fields: Record<string, string>;
  values?: Record<string, Record<string, string>>;
}

/** Herramientas del composer de email: templates/snippets, IA y tracking. */
export interface EmailTools {
  templates: Array<{ id: string; kind: 'template' | 'snippet'; name: string; subject: string; body: string }>;
  aiEnabled: boolean;
  trackingDefault: boolean;
  /** Para el render de variables (preview) y el contexto de la IA. */
  contactId?: string;
  dealId?: string;
}

interface TimelineProps {
  recordType: TimelineRecordType;
  recordId: string;
  items: TimelineItem[];
  emptyLabel: string;
  locale: string;
  /** Email precargado en el composer cuando type === email. */
  defaultEmail?: string;
  emailTools?: EmailTools;
  /** Personas del workspace que se pueden @mencionar en notas y tareas (y asignar). */
  mentionables?: Mentionable[];
  /** Acción rápida de la ficha (`?compose=`): abre el composer en ese tipo y le da el foco. */
  compose?: ComposeType | null;
  /** Persona que mira: queda como dueña de lo que registra. */
  currentPersonId?: string;
  /** Hay más actividad que la primera página (GET /api/crm/timeline). */
  hasMore?: boolean;
  /** Nombres para los cambios de propiedades; sin ellos, solo se ven los de campos propios y el lifecycle automático. */
  changeLabels?: ChangeLabels;
}

/** Tipos donde el texto acepta @menciones (y avisan). */
const MENTION_TYPES = new Set(['note', 'task']);

type ComposerKind = 'note' | 'email' | 'logEmail' | 'call' | 'task' | 'meeting';
const ACTIVITY_OF: Record<ComposerKind, 'note' | 'email' | 'call' | 'task' | 'meeting'> = {
  note: 'note',
  email: 'email',
  logEmail: 'email',
  call: 'call',
  task: 'task',
  meeting: 'meeting',
};
/** Botones de creación por pestaña, con los nombres de HubSpot. */
const CREATE_BY_TAB: Record<TimelineTab, ComposerKind[]> = {
  all: ['note', 'email', 'logEmail', 'call', 'task', 'meeting'],
  note: ['note'],
  email: ['email', 'logEmail'],
  call: ['call'],
  task: ['task'],
  meeting: ['meeting'],
  whatsapp: [],
};
const MEETING_OUTCOMES = ['scheduled', 'completed', 'rescheduled', 'no_show', 'canceled'] as const;

const TYPE_ICON: Record<string, CrmIconName> = {
  note: 'note',
  email: 'mail',
  call: 'phone',
  task: 'task',
  meeting: 'calendar',
  whatsapp: 'message',
};

const STORE_TYPES = 'zs:crm:timeline:types';
const STORE_ASSOC = 'zs:crm:timeline:associated';
const STORE_CHANGES = 'zs:crm:timeline:changes';

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sin storage: el filtro vale hasta recargar */
  }
}

/** Cmd+Enter (Mac) o Ctrl+Enter, sin una sugerencia de @mención abierta que ya lo usó. */
function isModEnter(e: { key: string; metaKey: boolean; ctrlKey: boolean; defaultPrevented: boolean; nativeEvent: { isComposing?: boolean } }): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented && !e.nativeEvent.isComposing;
}

function formatWhen(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parseDbUtc(iso));
}

function formatDay(iso: string, locale: string): string {
  // Una fecha sola (vencimiento de tarea) es un día de calendario, no un instante: sin correrla de zona.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(parseDbUtc(iso));
}

/** Casilla de los ítems de tilde de los menús. */
function Check({ on }: { on: boolean }) {
  return <span className="atl-box" aria-hidden>{on && <CrmIcon name="check" size={12} />}</span>;
}

/** Ahora, como valor de un input datetime-local en la hora de quien mira. */
function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Valor de un datetime-local (hora local) → instante UTC ISO. */
function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Timeline de la ficha, como el de HubSpot: pestañas por tipo con contador (Actividad, Notas, Emails,
 * Llamadas, Tareas, Reuniones y WhatsApp de Lines), filtro de tipos y de personas, búsqueda, actividad de
 * los registros asociados (empresas y deals), agrupado (Fijada, Próximas, Este mes, por mes), expandir o
 * contraer todo, y los botones de HubSpot para crear o registrar cada tipo. Cada tarjeta lleva ícono,
 * autor, fecha relativa (la absoluta al pasar el mouse), registros asociados y un menú con fijar,
 * editar, asociaciones y eliminar. El padre (server) pasa la primera página; tras cada cambio,
 * router.refresh(). "Cargar más" pide las siguientes (GET /api/crm/timeline).
 */
export default function Timeline({
  recordType,
  recordId,
  items,
  emptyLabel,
  locale,
  defaultEmail = '',
  emailTools,
  mentionables = [],
  compose = null,
  currentPersonId,
  hasMore = false,
  changeLabels,
}: TimelineProps) {
  const t = useTranslations('crm');
  const tl = useTranslations('crm.timeline');
  const crmOpts = useCrmOptions();
  const router = useRouter();
  const mounted = useMounted();
  const canEmail = recordType !== 'lead' && recordType !== 'objectRecord';
  const recordKind = recordType === 'contact' || recordType === 'company' || recordType === 'deal' ? recordType : null;
  const hasAssociated = recordType === 'company' || recordType === 'deal';
  // Notas con formato (C1) en contactos, empresas y deals: ahí las personas mencionables traen email.
  const richNotes = recordKind !== null;
  const tabs: TimelineTab[] = ['all', 'note', ...(canEmail ? (['email'] as const) : []), 'call', 'task', 'meeting'];

  // ---------- Lista y filtros ----------
  const [more, setMore] = useState<TimelineItem[]>([]);
  const [moreState, setMoreState] = useState<{ hasMore: boolean; offset: number }>({ hasMore, offset: 100 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  useEffect(() => {
    // La primera página volvió del server (router.refresh): lo cargado aparte sigue, sin repetir.
    setMoreState((s) => (s.offset === 100 ? { hasMore, offset: 100 } : s));
  }, [hasMore]);
  /**
   * Después de un cambio: la primera página vuelve del server y lo cargado con "Cargar más" se descarta
   * (se vuelve a pedir), así nada queda viejo, repetido o salteado por un offset corrido.
   */
  function refresh() {
    setMore([]);
    setMoreState({ hasMore, offset: 100 });
    router.refresh();
  }
  /** Nombre de la propiedad de un cambio; null si la ficha no la nombra (no se muestra). */
  const changeFieldName = (c: NonNullable<TimelineItem['change']>): string | null => {
    if (c.field.startsWith('custom.')) return c.label || null;
    return changeLabels?.fields[c.field] ?? (c.field === 'lifecycle_stage' && c.reason ? c.field : null);
  };
  const all = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    return [...items, ...more.filter((i) => !ids.has(i.id))].filter((i) => i.type !== 'change' || (i.change && changeFieldName(i.change) !== null));
  }, [items, more, changeLabels]); // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = useState<TimelineTab>('all');
  const [types, setTypes] = useState<TimelineType[]>([...TIMELINE_TYPES]);
  const [users, setUsers] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [associated, setAssociated] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  useEffect(() => {
    const ty = readStore(STORE_TYPES);
    if (ty) {
      const list = ty.split(',').filter((x): x is TimelineType => (TIMELINE_TYPES as readonly string[]).includes(x));
      if (list.length) setTypes(list);
    }
    if (readStore(STORE_ASSOC) === '0') setAssociated(false);
    if (readStore(STORE_CHANGES) === '0') setShowChanges(false);
  }, []);
  function chooseTypes(next: TimelineType[]) {
    setTypes(next);
    writeStore(STORE_TYPES, next.join(','));
  }
  function chooseAssociated(v: boolean) {
    setAssociated(v);
    writeStore(STORE_ASSOC, v ? '1' : '0');
  }
  function chooseChanges(v: boolean) {
    setShowChanges(v);
    writeStore(STORE_CHANGES, v ? '1' : '0');
  }

  const showAssociated = hasAssociated ? associated : true;
  const counts = tabCounts(all, showAssociated);
  const hasWhatsapp = all.some((i) => i.type === 'whatsapp');
  const visibleTabs = hasWhatsapp ? [...tabs, 'whatsapp' as const] : tabs;
  const filtered = applyFilters(all, { tab, types, users, query, associated: showAssociated, changes: showChanges });
  const hasChanges = all.some((i) => i.type === 'change');
  const authors = timelineAuthors(all.filter((i) => showAssociated || !i.rollup));
  const typeOptions = TIMELINE_TYPES.filter((v) => (v !== 'email' || canEmail) && (v !== 'whatsapp' || hasWhatsapp));
  // "Seleccionar todo" también prende los cambios de propiedades (si hay).
  const allTypesOn = typeOptions.every((v) => types.includes(v)) && (!hasChanges || showChanges);
  const typesFiltered = tab === 'all' && !allTypesOn;
  const typesOnCount = typeOptions.filter((v) => types.includes(v)).length + (hasChanges && showChanges ? 1 : 0);
  const anyFilter = query.trim() !== '' || users !== null || typesFiltered;
  const now = useMemo(() => new Date(), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = mounted ? groupTimeline(filtered, now) : [{ key: 'all', kind: 'month' as const, items: filtered }];

  // Expandir y contraer: por defecto abiertas; "Contraer todo" invierte el default y cada una alterna.
  const [collapsedAll, setCollapsedAll] = useState(false);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (id: string) => !collapsedAll !== toggled.has(id);
  function toggleOne(id: string) {
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function setAllOpen(open: boolean) {
    setCollapsedAll(!open);
    setToggled(new Set());
  }

  function clearFilters() {
    setQuery('');
    setUsers(null);
    chooseTypes([...TIMELINE_TYPES]);
    if (!showChanges) chooseChanges(true);
  }

  async function loadMore() {
    if (!recordKind || loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    const res = await fetch(`/api/crm/timeline?kind=${recordKind}&id=${encodeURIComponent(recordId)}&offset=${moreState.offset}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { items?: TimelineItem[]; hasMore?: boolean; nextOffset?: number } | null;
    setLoadingMore(false);
    if (!res?.ok || !data?.items) {
      setMoreError(true);
      return;
    }
    setMore((m) => {
      const seen = new Set(m.map((x) => x.id));
      return [...m, ...data.items!.filter((x) => !seen.has(x.id))];
    });
    setMoreState({ hasMore: !!data.hasMore, offset: data.nextOffset ?? moreState.offset + 100 });
  }

  // ---------- Composer ----------
  const [composing, setComposing] = useState<ComposerKind | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [emailTo, setEmailTo] = useState(defaultEmail);
  const [dueAt, setDueAt] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [direction, setDirection] = useState('');
  const [outcome, setOutcome] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [taskKind, setTaskKind] = useState<'' | 'call' | 'email'>('');
  const [priority, setPriority] = useState<'' | 'low' | 'medium' | 'high'>('');
  const [assignee, setAssignee] = useState(currentPersonId ?? '');
  const [posting, setPosting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<EmailThreadView | null>(null);
  const [tracking, setTracking] = useState(emailTools?.trackingDefault ?? true);
  const [missing, setMissing] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const type = composing ? ACTIVITY_OF[composing] : 'note';

  function focusComposer() {
    window.setTimeout(() => {
      const form = wrapRef.current?.querySelector<HTMLFormElement>('.tl-composer');
      if (!form || form.offsetParent === null) return;
      form.scrollIntoView({ block: 'nearest' });
      form.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea, [contenteditable="true"]')?.focus({ preventScroll: true });
    }, 0);
  }

  function openComposer(kind: ComposerKind) {
    if ((kind === 'email' || kind === 'logEmail') && !canEmail) return;
    if (composing !== kind) {
      setOutcome('');
      setDirection(kind === 'email' ? '' : direction);
      if (kind === 'call' || kind === 'meeting' || kind === 'logEmail') setOccurredAt(nowLocalInput());
    }
    setComposing(kind);
    setNotice(null);
    setEmailError(null);
    focusComposer();
  }

  function closeComposer() {
    setComposing(null);
    setReplyTo(null);
    setEmailError(null);
  }

  // Acciones rápidas de la ficha (Nota, Email, Llamada, Tarea, Reunión): abren el composer de ese tipo
  // con el foco adentro. Llegan por `?compose=` o por evento si el timeline ya está a la vista.
  const openRef = useRef(openComposer);
  openRef.current = openComposer;
  useEffect(() => {
    function open(kind: string | null | undefined) {
      if (!kind || !['note', 'email', 'call', 'task', 'meeting'].includes(kind)) return;
      if (kind === 'email' && !canEmail) return;
      // La lista queda como está: la acción elige qué se va a escribir, no esconde el resto.
      openRef.current(kind as ComposerKind);
    }
    open(compose);
    const onCompose = (e: Event) => open((e as CustomEvent<{ type?: string }>).detail?.type);
    window.addEventListener(COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(COMPOSE_EVENT, onCompose);
  }, [compose, canEmail]);

  // Zoom (CRM › Ajustes › Integraciones): botón "Link de Zoom" en las reuniones.
  const hasMeetings = all.some((i) => i.type === 'meeting' && !i.external);
  const [zoomOn, setZoomOn] = useState(false);
  const [zoomBusy, setZoomBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!hasMeetings) return;
    let alive = true;
    fetch('/api/crm/apps')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { apps?: Array<{ key: string; connected: boolean }> } | null) => {
        if (alive) setZoomOn(!!d?.apps?.some((a) => a.key === 'zoom' && a.connected));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasMeetings]);

  async function createZoom(id: string) {
    setZoomBusy(id);
    setNotice(null);
    const res = await fetch(`/api/crm/activities/${id}/zoom`, { method: 'POST' }).catch(() => null);
    setZoomBusy(null);
    if (res?.ok) refresh();
    else setNotice(t('apps.zoom.error'));
  }

  const templates = emailTools?.templates.filter((x) => x.kind === 'template') ?? [];
  const snippets = emailTools?.templates.filter((x) => x.kind === 'snippet') ?? [];

  function errorText(code: string | undefined): string {
    if (!code) return t('errors.generic');
    return t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic');
  }

  /** Render de variables con el contacto/deal del registro (y aviso de faltantes). */
  async function render(subjectTpl: string, bodyTpl: string): Promise<{ subject: string; body: string } | null> {
    const res = await fetch('/api/crm/email-templates/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: subjectTpl, body: bodyTpl, contactId: emailTools?.contactId, dealId: emailTools?.dealId }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json()) as { subject: string; body: string; missing: string[] };
    setMissing(data.missing);
    return { subject: data.subject, body: data.body };
  }

  async function insertTemplate(id: string) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const out = await render(tpl.subject, tpl.body);
    if (!out) return;
    if (!replyTo) setSubject(out.subject);
    setBody(out.body);
  }

  async function insertSnippet(id: string) {
    const sn = snippets.find((x) => x.id === id);
    if (!sn) return;
    const out = await render('', sn.body);
    if (!out) return;
    setBody((b) => (b.trim() ? `${b.replace(/\s+$/, '')}\n\n${out.body}` : out.body));
  }

  async function aiDraft() {
    if (!emailTools?.contactId || aiBusy) return;
    setAiBusy(true);
    setEmailError(null);
    const res = await fetch('/api/crm/emails/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: emailTools.contactId, instructions: aiPrompt.trim() || undefined, subject: subject.trim() || undefined }),
    }).catch(() => null);
    setAiBusy(false);
    const data = (await res?.json().catch(() => null)) as { body?: string; error?: string } | null;
    if (!res?.ok || !data?.body) {
      setEmailError(errorText(data?.error));
      return;
    }
    setBody(data.body);
    setAiOpen(false);
    setAiPrompt('');
  }

  function startReply(thread: EmailThreadView) {
    setReplyTo(thread);
    setTab('email');
    setComposing('email');
    const base = thread.subject || thread.messages[thread.messages.length - 1]?.subject || '';
    setSubject(/^re:/i.test(base) ? base : `Re: ${base}`);
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === 'in');
    const addr = lastIn ? /[^\s<>"]+@[^\s<>"]+/.exec(lastIn.from)?.[0] : null;
    if (addr) setEmailTo(addr);
    focusComposer();
  }

  const canSubmit =
    !posting &&
    (composing === 'note'
      ? body.trim() !== '' && !(richNotes && body.length > NOTE_MD_MAX)
      : composing === 'email'
        ? emailTo.trim() !== '' && (subject.trim() !== '' || body.trim() !== '')
        : subject.trim() !== '' || body.trim() !== '' || (composing === 'call' && outcome !== ''));

  function resetComposer() {
    setSubject('');
    setBody('');
    setDueAt('');
    setDirection('');
    setOutcome('');
    setDurationMin('');
    setTaskKind('');
    setPriority('');
    setAssignee(currentPersonId ?? '');
    setMissing([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!composing || !canSubmit) return;
    setEmailError(null);
    if (composing === 'email') {
      setPosting(true);
      const res = await fetch('/api/crm/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordType, recordId, to: emailTo.trim(), subject: subject.trim(), body: body.trim(), tracking, threadId: replyTo?.threadId }),
      }).catch(() => null);
      setPosting(false);
      const data = (await res?.json().catch(() => ({}))) as { error?: string; via?: 'gmail' | 'outlook' | 'system' } | undefined;
      if (res && res.ok) {
        resetComposer();
        setEmailTo(defaultEmail);
        setReplyTo(null);
        setComposing(null);
        setNotice(data?.via === 'system' ? t('email.sentSystem') : data?.via === 'outlook' ? t('email.sentOutlook') : t('email.sentGmail'));
        refresh();
      } else {
        setEmailError(errorText(data?.error));
      }
      return;
    }

    setPosting(true);
    const payload: Record<string, unknown> = {
      type,
      subject: composing === 'note' ? undefined : subject.trim() || undefined,
      body: body.trim() || undefined,
      [`${recordType}Id`]: recordId,
    };
    if (composing === 'note' && richNotes) payload.bodyFormat = 'md';
    const owner = composing === 'task' ? assignee : currentPersonId;
    if (owner) payload.ownerId = owner;
    if (composing === 'task') {
      if (dueAt) payload.dueAt = dueAt;
      if (taskKind) payload.taskKind = taskKind;
      if (priority) payload.priority = priority;
    }
    if (composing === 'call' || composing === 'meeting' || composing === 'logEmail') {
      const at = localInputToIso(occurredAt);
      if (at) payload.dueAt = at;
    }
    if ((composing === 'call' || composing === 'logEmail') && direction) payload.direction = direction;
    if ((composing === 'call' || composing === 'meeting') && outcome) payload.outcome = outcome;
    if ((composing === 'call' || composing === 'meeting') && durationMin) payload.durationMin = Number(durationMin);
    const res = await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setPosting(false);
    // Sin red: quedó en la cola del service worker; aparece al sincronizar.
    if (isQueuedResponse(res)) {
      resetComposer();
      setNotice(t('offline.savedOffline'));
      announceQueued('/api/crm/activities');
      return;
    }
    // Si no se guardó, lo escrito queda en el composer.
    if (!res || !res.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      setEmailError(errorText(data?.error));
      return;
    }
    const saved = (await res.json().catch(() => null)) as MentionsReply | null;
    resetComposer();
    setComposing(null);
    refresh();
    noticeNotNotified(saved);
  }

  /** Mencionados que no ven el registro: no recibieron nada, y se le dice a quien escribe. */
  function noticeNotNotified(reply: MentionsReply | null) {
    const names = (reply?.mentions_not_notified ?? []).map((m) => m.name).filter(Boolean);
    if (names.length) setNotice(t('mentions.notNotified', { names: names.join(', '), count: names.length }));
  }

  // Cmd/Ctrl+Enter guarda desde cualquier campo del composer (como HubSpot); Esc lo cierra.
  function composerKeys(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      closeComposer();
      return;
    }
    if (!isModEnter(e)) return;
    e.preventDefault();
    if (posting) return;
    e.currentTarget.requestSubmit();
  }

  // ---------- Acciones de cada tarjeta ----------
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [assocId, setAssocId] = useState<string | null>(null);
  const [assoc, setAssoc] = useState<{ contactId: string; companyId: string; dealId: string }>({ contactId: '', companyId: '', dealId: '' });
  const [assocError, setAssocError] = useState<string | null>(null);

  async function patch(id: string, data: Record<string, unknown>): Promise<Response | null> {
    setBusyId(id);
    const res = await fetch(`/api/crm/activities/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    setBusyId(null);
    return res;
  }

  async function toggleDone(item: TimelineItem) {
    await patch(item.id, { done: !item.done });
    refresh();
  }

  async function togglePin(item: TimelineItem) {
    if (recordKind) {
      setBusyId(item.id);
      await fetch('/api/crm/timeline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activityId: item.id, kind: recordKind, id: recordId, pinned: !item.pinned }),
      }).catch(() => null);
      setBusyId(null);
    } else {
      await patch(item.id, { pinned: !item.pinned });
    }
    refresh();
  }

  function startEdit(item: TimelineItem) {
    setAssocId(null);
    setEditingId(item.id);
    setEditSubject(item.subject);
    // Una nota de antes (texto plano) se abre en el editor con formato tal como se leía.
    setEditBody(richNotes && item.type === 'note' && item.body_format !== 'md' ? plainToMarkdown(item.body) : item.body);
  }

  async function saveEdit(item: TimelineItem) {
    const rich = richNotes && item.type === 'note';
    if (rich && editBody.length > NOTE_MD_MAX) return;
    const res = await patch(item.id, { subject: editSubject.trim(), body: editBody.trim(), ...(rich ? { bodyFormat: 'md' } : {}) });
    if (res && res.ok) {
      const saved = (await res.json().catch(() => null)) as MentionsReply | null;
      setEditingId(null);
      refresh();
      noticeNotNotified(saved);
    }
  }

  function startAssoc(item: TimelineItem) {
    setEditingId(null);
    setAssocError(null);
    setAssocId(item.id);
    setAssoc({ contactId: item.contact_id ?? '', companyId: item.company_id ?? '', dealId: item.deal_id ?? '' });
  }

  async function saveAssoc(item: TimelineItem) {
    const res = await patch(item.id, {
      contactId: assoc.contactId || null,
      companyId: assoc.companyId || null,
      dealId: assoc.dealId || null,
    });
    if (res && res.ok) {
      setAssocId(null);
      refresh();
    } else {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      setAssocError(errorText(data?.error));
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/activities/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmId(null);
    refresh();
  }

  async function searchRecords(kind: 'contacts' | 'companies' | 'deals', q: string): Promise<ComboOption[]> {
    return (await searchAssociable(kind, q)).map((h) => ({ value: h.id, label: h.name || h.id }));
  }

  // ---------- Textos ----------
  function typeLabel(item: TimelineItem): string {
    if (item.type === 'whatsapp') return item.wa?.group ? tl('waGroup') : tl('waChat');
    if (item.type === 'call' && item.channel === 'whatsapp') return t('calls.whatsapp');
    if (item.type === 'call' && item.channel === 'browser') return t('voice.timelineType');
    if (item.type === 'task' && item.task_kind) return `${t('enums.activityType.task')} · ${t(`enums.activityType.${item.task_kind}`)}`;
    return t(`enums.activityType.${item.type as 'note'}`);
  }

  function outcomeLabel(item: TimelineItem): string {
    if (!item.outcome) return '';
    if (item.type === 'meeting' && (MEETING_OUTCOMES as readonly string[]).includes(item.outcome)) {
      return tl(`meetingOutcomes.${item.outcome as (typeof MEETING_OUTCOMES)[number]}`);
    }
    return isDefaultOutcome(item.outcome) ? t(`calls.outcomes.${item.outcome}`) : item.outcome;
  }

  function rollupFrom(item: TimelineItem): string {
    const name = item.contact_name || item.deal_name || item.company_name;
    return name ? tl('fromRecord', { name }) : tl('fromAssociated');
  }

  function groupLabel(g: { kind: string; month?: Date }): string {
    if (g.kind === 'pinned') return tl('groups.pinned');
    if (g.kind === 'upcoming') return tl('groups.upcoming');
    if (g.kind === 'thisMonth') return tl('groups.thisMonth');
    return g.month ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(g.month) : '';
  }

  /** Registros de la actividad (sin el de la ficha): links como en las tarjetas de HubSpot. */
  function assocLinks(item: TimelineItem) {
    const out: Array<{ key: string; href: string; label: string }> = [];
    if (item.contact_id && item.contact_name && !(recordType === 'contact' && item.contact_id === recordId)) {
      out.push({ key: 'c', href: `/app/crm/contacts/${item.contact_id}`, label: item.contact_name });
    }
    if (item.company_id && item.company_name && !(recordType === 'company' && item.company_id === recordId)) {
      out.push({ key: 'co', href: `/app/crm/companies/${item.company_id}`, label: item.company_name });
    }
    if (item.deal_id && item.deal_name && !(recordType === 'deal' && item.deal_id === recordId)) {
      out.push({ key: 'd', href: `/app/crm/deals/${item.deal_id}`, label: item.deal_name });
    }
    return out;
  }

  // ---------- Render ----------
  const createKinds = CREATE_BY_TAB[tab].filter((k) => canEmail || (k !== 'email' && k !== 'logEmail'));

  function renderComposer() {
    if (!composing) return null;
    const people = mentionables.length ? mentionables : [];
    return (
      <form
        className="tl-composer atl-composer"
        data-kind={composing}
        data-testid="timeline-composer"
        onSubmit={submit}
        onKeyDown={composerKeys}
        aria-label={tl(`create.${composing}`)}
      >
        <div className="atl-composer-head">
          <strong>{tl(`create.${composing}`)}</strong>
          <button type="button" className="icon-btn" onClick={closeComposer} aria-label={tl('closeComposer')} title={tl('closeComposer')}>
            <CrmIcon name="x" />
          </button>
        </div>
        {composing === 'email' && replyTo && (
          <div className="em-replying">
            <span className="muted">{t('email.replyingTo', { subject: replyTo.subject || '—' })}</span>
            <button type="button" className="link-btn" onClick={() => { setReplyTo(null); setSubject(''); }}>
              {t('email.cancelReply')}
            </button>
          </div>
        )}
        {composing === 'email' && (
          <input className="input" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={t('common.to')} aria-label={t('common.to')} required />
        )}
        {composing !== 'note' && (
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={composing === 'email' || composing === 'logEmail' ? t('common.subject') : tl('title')}
            aria-label={composing === 'email' || composing === 'logEmail' ? t('common.subject') : tl('title')}
            maxLength={500}
          />
        )}
        {composing === 'note' && richNotes ? (
          <NoteEditor
            value={body}
            onChange={setBody}
            people={people}
            placeholder={people.length > 1 ? tl('notePlaceholder') : tl('notePlaceholderSolo')}
            ariaLabel={t('enums.activityType.note')}
            testId="timeline-note-editor"
            onSubmit={() => wrapRef.current?.querySelector<HTMLFormElement>('.tl-composer')?.requestSubmit()}
            onEscape={closeComposer}
            autoFocus
          />
        ) : MENTION_TYPES.has(type) && people.length > 1 ? (
          <MentionTextarea
            className="textarea"
            rows={3}
            value={body}
            onChange={setBody}
            people={people}
            placeholder={composing === 'note' ? tl('notePlaceholder') : t('mentions.placeholder')}
            maxLength={5000}
            aria-label={composing === 'note' ? t('enums.activityType.note') : t('tasks.form.body')}
          />
        ) : (
          <textarea
            className="textarea"
            rows={composing === 'email' ? 6 : 3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={composing === 'email' ? t('common.body') : composing === 'note' ? tl('notePlaceholder') : tl('description')}
            aria-label={composing === 'email' ? t('common.body') : composing === 'note' ? t('enums.activityType.note') : tl('description')}
            maxLength={composing === 'email' ? 20000 : 5000}
          />
        )}
        {composing === 'email' && emailTools && (
          <div className="em-tools">
            {templates.length > 0 && (
              <select className="filter-select" value="" onChange={(e) => insertTemplate(e.target.value)} aria-label={t('email.insertTemplate')}>
                <option value="">{t('email.insertTemplate')}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            )}
            {snippets.length > 0 && (
              <select className="filter-select" value="" onChange={(e) => insertSnippet(e.target.value)} aria-label={t('email.insertSnippet')}>
                <option value="">{t('email.insertSnippet')}</option>
                {snippets.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            )}
            {emailTools.aiEnabled && emailTools.contactId && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen}>
                {t('email.aiDraft')}
              </button>
            )}
            <label className="em-check">
              <input type="checkbox" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />
              {t('email.tracking')}
            </label>
          </div>
        )}
        {composing === 'email' && aiOpen && (
          <div className="em-ai">
            <input
              className="input"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={t('email.aiPrompt')}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  aiDraft();
                }
              }}
            />
            <button type="button" className="btn btn-small" disabled={aiBusy} onClick={aiDraft}>
              {aiBusy ? t('email.aiDrafting') : t('email.aiDraft')}
            </button>
          </div>
        )}
        {composing === 'email' && missing.length > 0 && <p className="em-warn mono">{t('email.missingVars', { vars: missing.join(', ') })}</p>}
        <div className="tl-composer-actions">
          <div className="tl-composer-extras atl-fields">
            {(composing === 'call' || composing === 'meeting' || composing === 'logEmail') && (
              <label className="atl-field">
                <span>{tl('occurredAt')}</span>
                <input className="input" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
              </label>
            )}
            {composing === 'call' && (
              <label className="atl-field">
                <span>{tl('outcome')}</span>
                <select className="filter-select" value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="timeline-outcome">
                  <option value="">{tl('noOutcome')}</option>
                  {DEFAULT_CALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>{t(`calls.outcomes.${o}`)}</option>
                  ))}
                </select>
              </label>
            )}
            {composing === 'meeting' && (
              <label className="atl-field">
                <span>{tl('outcome')}</span>
                <select className="filter-select" value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="timeline-outcome">
                  <option value="">{tl('noOutcome')}</option>
                  {MEETING_OUTCOMES.map((o) => (
                    <option key={o} value={o}>{tl(`meetingOutcomes.${o}`)}</option>
                  ))}
                </select>
              </label>
            )}
            {(composing === 'call' || composing === 'logEmail') && (
              <label className="atl-field">
                <span>{tl('direction')}</span>
                <select className="filter-select" value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="">{tl('noDirection')}</option>
                  <option value="inbound">{t('enums.direction.inbound')}</option>
                  <option value="outbound">{t('enums.direction.outbound')}</option>
                </select>
              </label>
            )}
            {(composing === 'call' || composing === 'meeting') && (
              <label className="atl-field">
                <span>{t('common.durationMin')}</span>
                <input className="input tl-duration" type="number" min={0} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
              </label>
            )}
            {composing === 'task' && (
              <>
                <label className="atl-field">
                  <span>{t('tasks.form.dueAt')}</span>
                  <input className="input" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                </label>
                <label className="atl-field">
                  <span>{tl('taskType')}</span>
                  <select className="filter-select" value={taskKind} onChange={(e) => setTaskKind(e.target.value as '' | 'call' | 'email')}>
                    <option value="">{tl('todo')}</option>
                    <option value="call">{t('enums.activityType.call')}</option>
                    <option value="email">{t('enums.activityType.email')}</option>
                  </select>
                </label>
                <label className="atl-field">
                  <span>{t('tasks.form.priority')}</span>
                  <select className="filter-select" value={priority} onChange={(e) => setPriority(e.target.value as '' | 'low' | 'medium' | 'high')}>
                    <option value="">{t('tasks.priority.none')}</option>
                    <option value="low">{t('tasks.priority.low')}</option>
                    <option value="medium">{t('tasks.priority.medium')}</option>
                    <option value="high">{t('tasks.priority.high')}</option>
                  </select>
                </label>
                {people.length > 0 && (
                  <label className="atl-field">
                    <span>{tl('assignedTo')}</span>
                    <select className="filter-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                      {!people.some((p) => p.id === assignee) && <option value={assignee}>{t('common.none')}</option>}
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>{p.name || p.email}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>
          <button type="submit" aria-keyshortcuts="Meta+Enter Control+Enter" className="btn btn-solid btn-small" disabled={!canSubmit}>
            {posting
              ? t('common.creating')
              : composing === 'note'
                ? tl('saveNote')
                : composing === 'task'
                  ? tl('createTask')
                  : composing === 'email'
                    ? t('common.sendEmail')
                    : tl('logActivity')}
          </button>
        </div>
        {composing === 'note' && richNotes && body.length > NOTE_MD_MAX && <p className="form-error">{tl('noteTooLong')}</p>}
        {emailError && <p className="form-error">{emailError}</p>}
      </form>
    );
  }

  function renderBody(item: TimelineItem) {
    if (item.wa) {
      return (
        <div className="atl-wa">
          <ol className="atl-wa-messages">
            {item.wa.messages.map((m) => (
              <li key={m.id} data-out={m.out ? 'true' : undefined}>
                <strong>{m.out ? tl('team') : m.who}</strong> <span>{m.text}</span>
              </li>
            ))}
          </ol>
          <Link className="atl-link" href={`/app/lines/inbox/${item.wa.chatId}`}>
            {tl('openInLines')}
          </Link>
        </div>
      );
    }
    if (item.thread) return <EmailThread thread={item.thread} locale={locale} onReply={emailTools ? startReply : undefined} />;
    if (editingId === item.id) {
      return (
        <div
          className="tl-edit"
          onKeyDown={(e) => {
            if (isModEnter(e)) {
              e.preventDefault();
              void saveEdit(item);
            } else if (e.key === 'Escape' && !e.defaultPrevented) {
              e.preventDefault();
              setEditingId(null);
            }
          }}
        >
          {(item.type !== 'note' || item.subject) && (
            <input className="input" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder={tl('title')} aria-label={tl('title')} maxLength={500} />
          )}
          {richNotes && item.type === 'note' ? (
            <NoteEditor
              value={editBody}
              onChange={setEditBody}
              people={mentionables}
              ariaLabel={t('enums.activityType.note')}
              testId="timeline-note-edit"
              onSubmit={() => void saveEdit(item)}
              onEscape={() => setEditingId(null)}
              autoFocus
            />
          ) : MENTION_TYPES.has(item.type) && mentionables.length > 1 ? (
            <MentionTextarea className="textarea" rows={3} value={editBody} onChange={setEditBody} people={mentionables} placeholder={t('tasks.form.body')} maxLength={5000} aria-label={t('tasks.form.body')} />
          ) : (
            <textarea className="textarea" rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} placeholder={t('tasks.form.body')} aria-label={t('tasks.form.body')} maxLength={5000} />
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-solid btn-small" disabled={busyId === item.id} onClick={() => saveEdit(item)}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditingId(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      );
    }
    const links = assocLinks(item);
    return (
      <>
        {item.chat_private ? (
          <p className="tl-subject crm-private-task" title={t('tasks.privateChatHint')} data-testid="crm-private-chat-task">
            {item.subject}
          </p>
        ) : (
          item.subject && <p className="tl-subject atl-subject">{item.subject}</p>
        )}
        {item.body && <RichNoteBody body={item.body} format={item.body_format} people={mentionables} testId="timeline-item-body" />}
        {item.voice && <CallDetails voice={item.voice} />}
        <div className="tl-meta">
          {item.type === 'task' && item.due_at && (
            <span>
              {t('tasks.dueLabel')} <LocalText>{formatDay(item.due_at, locale)}</LocalText>
            </span>
          )}
          {item.type === 'task' && item.source && (
            <Link href={item.source.href} className="tl-source">
              {t(`tasks.links.app.${item.source.app}`)}
              {item.source.label ? ` · ${item.source.label}` : ''}
            </Link>
          )}
          {item.direction && item.type !== 'whatsapp' && <span>{t(`enums.direction.${item.direction as 'inbound'}`)}</span>}
          {item.voice?.durationSec != null ? (
            <span>{formatCallDuration(item.voice.durationSec)}</span>
          ) : (
            item.duration_min != null && <span>{item.duration_min} min</span>
          )}
          {item.outcome && <span data-testid="timeline-item-outcome">{outcomeLabel(item)}</span>}
          {item.external && item.from_email && <span className="tl-from">{item.from_email}</span>}
          {!item.external && item.type === 'meeting' && zoomOn && !/zoom\.us\//.test(item.body) && (
            <button type="button" className="icon-btn" onClick={() => createZoom(item.id)} disabled={zoomBusy !== null} aria-busy={zoomBusy === item.id || undefined}>
              {t('apps.zoom.createLink')}
            </button>
          )}
        </div>
        {links.length > 0 && (
          <p className="atl-assoc" data-testid="timeline-item-assoc">
            {links.map((l) => (
              <Link key={l.key} href={l.href} className="atl-link">
                {l.label}
              </Link>
            ))}
          </p>
        )}
        {assocId === item.id && (
          <div className="atl-assoc-edit" data-testid="timeline-assoc-edit">
            <RecordCombobox
              inputClassName="input"
              options={item.contact_id && item.contact_name ? [{ value: item.contact_id, label: item.contact_name }] : []}
              value={assoc.contactId}
              onChange={(v) => setAssoc((a) => ({ ...a, contactId: v }))}
              noneLabel={tl('noRecord')}
              placeholder={tl('searchRecords')}
              ariaLabel={t('tasks.form.contact')}
              search={(q) => searchRecords('contacts', q)}
            />
            <RecordCombobox
              inputClassName="input"
              options={item.company_id && item.company_name ? [{ value: item.company_id, label: item.company_name }] : []}
              value={assoc.companyId}
              onChange={(v) => setAssoc((a) => ({ ...a, companyId: v }))}
              noneLabel={tl('noRecord')}
              placeholder={tl('searchRecords')}
              ariaLabel={t('tasks.form.company')}
              search={(q) => searchRecords('companies', q)}
            />
            <RecordCombobox
              inputClassName="input"
              options={item.deal_id && item.deal_name ? [{ value: item.deal_id, label: item.deal_name }] : []}
              value={assoc.dealId}
              onChange={(v) => setAssoc((a) => ({ ...a, dealId: v }))}
              noneLabel={tl('noRecord')}
              placeholder={tl('searchRecords')}
              ariaLabel={t('tasks.form.deal')}
              search={(q) => searchRecords('deals', q)}
            />
            <div className="form-actions">
              <button type="button" className="btn btn-solid btn-small" disabled={busyId === item.id} onClick={() => saveAssoc(item)}>
                {tl('saveAssociations')}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setAssocId(null)}>
                {t('common.cancel')}
              </button>
            </div>
            {assocError && <p className="form-error">{assocError}</p>}
          </div>
        )}
        {!item.external && (item.type === 'call' || item.type === 'meeting') && (!item.voice?.transcript.length || item.ai_summary) && (
          <CallSummaryBlock
            activityId={item.id}
            locale={locale}
            initial={item.ai_summary ?? null}
            links={{ contactId: item.contact_id, companyId: item.company_id, dealId: item.deal_id }}
          />
        )}
        {!item.external && (item.type === 'call' || item.type === 'meeting') && <CallFollowupBlock activityId={item.id} locale={locale} />}
        {!item.external && <FilesPanel compact endpoint={`/api/crm/activities/${item.id}/files`} files={item.files ?? []} />}
      </>
    );
  }

  /** Valor de un cambio, con el nombre de la opción, del enum, la fecha o el monto; '' si quedó vacío. */
  function changeValue(c: NonNullable<TimelineItem['change']>, v: string): string {
    const field = c.field;
    // Primero el nombre de la ficha: también nombra el vacío ("Automática" en forecast).
    const mapped = changeLabels?.values?.[field]?.[v];
    if (mapped) return mapped;
    if (!v) return '';
    if (field === 'lifecycle_stage') return crmOpts.label('lifecycle', v);
    if (field === 'lead_status') return crmOpts.label('leadStatus', v);
    const kind = c.valueType ?? (field === 'close_date' ? 'date' : field === 'amount' || field === 'employees' ? 'number' : '');
    if (kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDay(v.slice(0, 10), locale);
    if (kind === 'boolean') return v === 'true' ? t('common.yes') : v === 'false' ? t('common.no') : v;
    if ((kind === 'number' || kind === 'currency') && v.trim() !== '' && Number.isFinite(Number(v))) {
      return kind === 'currency' ? formatMoney(Number(v), c.currency || 'USD', locale, true) : new Intl.NumberFormat(locale).format(Number(v));
    }
    return v.length > 80 ? `${v.slice(0, 79)}…` : v;
  }

  /**
   * Cambio de una propiedad: una línea ("Lead status changed from New to Connected · Ana"), como en
   * HubSpot. El automático de lifecycle dice por qué (deal creado o ganado). Un valor que la persona no
   * puede ver nombrado (una empresa que no ve) sale como "—", sin decir que quedó vacío.
   */
  function renderChange(item: TimelineItem & { change: NonNullable<TimelineItem['change']> }) {
    const c = item.change;
    const reason = c.reason && t.has(`propertyOptions.reasons.${c.reason}`) ? t(`propertyOptions.reasons.${c.reason}`) : '';
    const from = c.fromPrivate ? '—' : changeValue(c, c.from);
    const to = c.toPrivate ? '—' : changeValue(c, c.to);
    const field = changeFieldName(c) ?? c.field;
    const text =
      c.field === 'lifecycle_stage' && c.reason
        ? t('propertyOptions.changedTo', { from: from || '—', to: to || '—' })
        : !from
          ? tl('change.set', { field, to })
          : !to
            ? tl('change.cleared', { field, from })
            : tl('change.changed', { field, from, to });
    const by = reason || c.actor || '';
    return (
      <article key={item.id} className="tl-item atl-change" data-testid="crm-timeline-change" data-type="change" data-field={c.field}>
        {/* Un punto, no una flecha: la línea no se despliega ni se toca. */}
        <span className="atl-icon" data-type="change" aria-hidden />
        <p className="atl-change-text">
          {text}
          {by ? <span className="muted"> · {by}</span> : null}
        </p>
        <time className="tl-date atl-when" dateTime={item.created_at} title={mounted ? formatWhen(item.created_at, locale) : undefined}>
          <LocalText>{mounted ? relativeTime(parseDbUtc(item.created_at), now, locale) : formatWhen(item.created_at, locale)}</LocalText>
        </time>
      </article>
    );
  }

  /** Hilo de comentarios (C1): notas, emails, llamadas, reuniones y tareas; no en chats de Lines ni en tareas de un chat que no se ve. */
  function renderComments(item: TimelineItem) {
    if (item.chat_private || item.type === 'whatsapp' || editingId === item.id) return null;
    const target = item.comment_activity_id ?? (item.external ? null : item.id);
    if (!target) return null;
    return <ActivityComments key={target} activityId={target} initialCount={item.comment_count} people={mentionables} locale={locale} />;
  }

  function renderItem(item: TimelineItem) {
    if (item.type === 'change' && item.change) return renderChange(item as TimelineItem & { change: NonNullable<TimelineItem['change']> });
    const open = isOpen(item.id);
    const date = item.due_at ?? item.created_at;
    const plainBody = item.body_format === 'md' ? noteMarkdownToText(item.body) : item.body;
    const preview = item.chat_private ? item.subject : item.subject || plainBody.split('\n')[0] || item.wa?.messages[item.wa.messages.length - 1]?.text || '';
    const canPin = !item.external && !item.rollup;
    return (
      <article
        key={item.id}
        className={`tl-item atl-card${item.done ? ' tl-done' : ''}${item.pinned ? ' tl-pinned' : ''}${busyId === item.id ? ' row-busy' : ''}`}
        data-testid="crm-timeline-item"
        data-type={item.type}
        data-rollup={item.rollup ? 'true' : undefined}
        data-chat-private={item.chat_private ? 'true' : undefined}
      >
        <div className="atl-card-head">
          <span className="atl-icon" data-type={item.type} aria-hidden>
            <CrmIcon name={item.type === 'call' && item.channel === 'whatsapp' ? 'message' : (TYPE_ICON[item.type] ?? 'note')} />
          </span>
          <button
            type="button"
            className="atl-title"
            aria-expanded={open}
            onClick={() => toggleOne(item.id)}
            title={open ? tl('collapse') : tl('expand')}
            data-testid="timeline-item-toggle"
          >
            <span className="tl-type">
              {item.author_name && !item.external ? tl('by', { type: typeLabel(item), name: item.author_name }) : typeLabel(item)}
            </span>
            {!open && preview && <span className="atl-preview">{preview}</span>}
          </button>
          {item.external && item.thread ? <span className="badge">{item.thread.messages[0]?.source === 'outlook' ? 'Outlook' : 'Gmail'}</span> : null}
          {!item.external && item.type === 'email' && item.direction === 'outbound' ? <span className="badge">{t('common.sent')}</span> : null}
          {item.pinned ? <span className="badge" data-testid="timeline-item-pinned">{t('common.pinned')}</span> : null}
          {item.rollup ? <span className="atl-from" data-testid="timeline-item-from">{rollupFrom(item)}</span> : null}
          <time className="tl-date atl-when" dateTime={date} title={mounted ? formatWhen(date, locale) : undefined}>
            <LocalText>{mounted ? relativeTime(parseDbUtc(date), now, locale) : formatWhen(date, locale)}</LocalText>
          </time>
          {!item.external && item.type === 'task' && (
            <button
              type="button"
              className={`icon-btn atl-done${item.done ? ' is-done' : ''}`}
              onClick={() => toggleDone(item)}
              aria-pressed={!!item.done}
              aria-label={item.done ? t('tasks.reopen') : t('tasks.complete')}
              title={item.done ? t('tasks.reopen') : t('tasks.complete')}
            >
              <CrmIcon name="check" />
            </button>
          )}
          {!item.external && (
            <TimelineMenu label={tl('actions')} button={<CrmIcon name="more" />} buttonClassName="icon-btn atl-more" align="end" testId="timeline-item-menu">
              {(close) => (
                <>
                  {(canPin || (!recordKind && !item.external)) && (
                    <button type="button" role="menuitem" className="atl-menu-item" onClick={() => { close(); void togglePin(item); }}>
                      {item.pinned ? t('common.unpin') : t('common.pin')}
                    </button>
                  )}
                  {!item.chat_private && (
                    <button type="button" role="menuitem" className="atl-menu-item" onClick={() => { close(); if (!open) toggleOne(item.id); startEdit(item); }}>
                      {t('common.edit')}
                    </button>
                  )}
                  {canEmail && (
                    <button type="button" role="menuitem" className="atl-menu-item" onClick={() => { close(); if (!open) toggleOne(item.id); startAssoc(item); }}>
                      {tl('associations')}
                    </button>
                  )}
                  <button type="button" role="menuitem" className="atl-menu-item danger" onClick={() => { close(); setConfirmId(item.id); }}>
                    {t('common.delete')}
                  </button>
                </>
              )}
            </TimelineMenu>
          )}
        </div>
        {confirmId === item.id && (
          <div className="atl-confirm" role="alertdialog" aria-label={tl('deleteConfirm')}>
            <span>{tl('deleteConfirm')}</span>
            <button type="button" className="btn btn-danger btn-small" onClick={() => remove(item.id)} autoFocus>
              {t('common.delete')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmId(null)}>
              {t('common.cancel')}
            </button>
          </div>
        )}
        {open && (
          <div className="atl-card-body">
            {renderBody(item)}
            {renderComments(item)}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="timeline-wrap atl" ref={wrapRef}>
      <div className="atl-tabs" role="tablist" aria-label={tl('tabsLabel')}>
        {visibleTabs.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            className="atl-tab"
            data-testid={`timeline-tab-${v}`}
            onClick={() => setTab(v)}
          >
            {tl(`tabs.${v}`)}
            {counts[v] > 0 && <span className="tl-count">{counts[v]}</span>}
          </button>
        ))}
      </div>

      <div className="atl-toolbar">
        <label className="atl-search">
          <CrmIcon name="search" />
          <input type="search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tl('search')} aria-label={tl('search')} data-testid="timeline-search" />
        </label>
        {tab === 'all' || hasAssociated ? (
          <TimelineMenu
            label={tl('filterActivity')}
            button={
              <>
                <CrmIcon name="filter" />
                <span>{typesFiltered ? tl('filterActive', { count: typesOnCount }) : tl('filterActivity')}</span>
              </>
            }
            buttonClassName={`btn btn-secondary btn-sm atl-tool${typesFiltered || (hasAssociated && !associated) ? ' is-active' : ''}`}
            testId="timeline-filter"
          >
            {() => (
              <>
                {tab === 'all' && (
                  <>
                    <p className="atl-menu-label">{tl('types')}</p>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={allTypesOn}
                      className="atl-menu-item atl-check"
                      onClick={() => {
                        chooseTypes(allTypesOn ? [] : [...TIMELINE_TYPES]);
                        if (hasChanges) chooseChanges(!allTypesOn);
                      }}
                    >
                      <Check on={allTypesOn} />
                      {tl('selectAll')}
                    </button>
                    {typeOptions.map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={types.includes(v)}
                        className="atl-menu-item atl-check"
                        data-testid={`timeline-filter-${v}`}
                        onClick={() => chooseTypes(types.includes(v) ? types.filter((x) => x !== v) : [...types, v])}
                      >
                        <Check on={types.includes(v)} />
                        {tl(`tabs.${v}`)}
                      </button>
                    ))}
                    {hasChanges && (
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={showChanges}
                        className="atl-menu-item atl-check"
                        data-testid="timeline-filter-changes"
                        onClick={() => chooseChanges(!showChanges)}
                      >
                        <Check on={showChanges} />
                        {tl('changes')}
                      </button>
                    )}
                  </>
                )}
                {hasAssociated && (
                  <>
                    {tab === 'all' && <hr className="atl-menu-rule" />}
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={associated}
                      className="atl-menu-item atl-check"
                      data-testid="timeline-associated"
                      onClick={() => chooseAssociated(!associated)}
                    >
                      <Check on={associated} />
                      <span>
                        {tl('associated')}
                        <small className="atl-menu-hint">{recordType === 'deal' ? tl('associatedHintDeal') : tl('associatedHint')}</small>
                      </span>
                    </button>
                  </>
                )}
              </>
            )}
          </TimelineMenu>
        ) : null}
        {authors.length > 0 && (
          <TimelineMenu
            label={tl('users')}
            button={
              <>
                <CrmIcon name="user" />
                <span>{users ? tl('usersCount', { count: users.length }) : tl('allUsers')}</span>
              </>
            }
            buttonClassName={`btn btn-secondary btn-sm atl-tool${users ? ' is-active' : ''}`}
            testId="timeline-users"
          >
            {() => (
              <>
                <button type="button" role="menuitemcheckbox" aria-checked={users === null} className="atl-menu-item atl-check" onClick={() => setUsers(null)}>
                  <Check on={users === null} />
                  {tl('allUsers')}
                </button>
                {authors.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={!!users?.includes(a.id)}
                    className="atl-menu-item atl-check"
                    data-testid={`timeline-user-${a.id}`}
                    onClick={() => {
                      const cur = users ?? [];
                      const next = cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id];
                      setUsers(next.length ? next : null);
                    }}
                  >
                    <Check on={!!users?.includes(a.id)} />
                    {a.name || '—'}
                  </button>
                ))}
              </>
            )}
          </TimelineMenu>
        )}
        <button type="button" className="btn btn-ghost btn-sm atl-tool" onClick={() => setAllOpen(collapsedAll)} data-testid="timeline-collapse-all">
          {collapsedAll ? tl('expandAll') : tl('collapseAll')}
        </button>
        <div className="atl-create">
          {tab === 'all' ? (
            <TimelineMenu
              label={tl('createMenu')}
              button={
                <>
                  <CrmIcon name="plus" />
                  <span>{tl('createMenu')}</span>
                </>
              }
              buttonClassName="btn btn-solid btn-sm atl-tool"
              align="end"
              testId="timeline-create"
            >
              {(close) =>
                createKinds.map((k) => (
                  <button key={k} type="button" role="menuitem" className="atl-menu-item" data-testid={`timeline-create-${k}`} onClick={() => { close(); openComposer(k); }}>
                    {tl(`create.${k}`)}
                  </button>
                ))
              }
            </TimelineMenu>
          ) : (
            createKinds.map((k, i) => (
              <button
                key={k}
                type="button"
                className={`btn ${i === 0 ? 'btn-solid' : 'btn-secondary'} btn-sm`}
                data-testid={`timeline-create-${k}`}
                onClick={() => openComposer(k)}
              >
                {tl(`create.${k}`)}
              </button>
            ))
          )}
        </div>
      </div>

      {renderComposer()}
      {notice && !emailError && <p className="muted em-notice">{notice}</p>}

      {all.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : filtered.length === 0 ? (
        <div className="atl-empty" data-testid="timeline-no-match">
          <p className="muted">{tl('noMatch')}</p>
          {anyFilter && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
              {tl('clearFilters')}
            </button>
          )}
        </div>
      ) : (
        <div className="timeline atl-list">
          {groups.map((g) => (
            <section key={g.key} className="atl-group" data-group={g.kind} aria-label={mounted ? groupLabel(g) : undefined}>
              {mounted && g.key !== 'all' && <h3 className="atl-group-title">{groupLabel(g)}</h3>}
              {g.items.map((item) => renderItem(item))}
            </section>
          ))}
        </div>
      )}

      {recordKind && moreState.hasMore && (
        <div className="atl-more-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore} data-testid="timeline-load-more">
            {loadingMore ? tl('loading') : tl('loadMore')}
          </button>
          {moreError && <p className="form-error">{tl('loadError')}</p>}
        </div>
      )}
    </div>
  );
}

