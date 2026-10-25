'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { SETTINGS_SECTION_KEYS, settingsSectionHref } from '@/lib/settings-nav';
import { PRODUCT_CONFIG, PRODUCT_KEYS, productSettingsHref } from '@/lib/products';
import { RIVALS } from '@/components/site/catalog';

interface ResultItem {
  group: string;
  label: string;
  meta: string;
  href: string;
  /** Acción en página (evento de window) en vez de navegar. */
  event?: string;
  /** Otras palabras con las que se encuentra (sinónimos, otros idiomas). */
  keywords?: string;
}

/** Minúsculas y sin tildes: "Facturación" encuentra "facturacion". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

interface SearchResponse {
  q: string;
  items: ResultItem[];
}

function useGroupOrder() {
  return useMemo(() => [
        'apps',
        'track',
        'actions',
        'settings',
        'projects',
        'issues',
        'contacts',
        'companies',
        'leads',
        'deals',
        'crmAgentRuns',
        'records',
        'crmDocuments',
        'crmVideos',
        'links',
        'docs',
        'notes',
        'boards',
        'tasks',
        'playbooks',
        'crmForms',
        'crmQuotes',
        'crmApprovals',
        'crmScores',
        'reports',
        'eventTypes',
        'bookings',
        'widgets',
        'flows',
        'agents',
        'robots',
        'groupsChats',
        'groupsTickets',
        'groupsMessages',
        'groupsLists',
        'groupsTemplates',
        'groupsRecurring',
        'voiceSessions',
      ], []);
}

function useGroupLabel(t: (key: string) => string) {
  return useCallback(
    (group: string) => {
      if (group === 'actions') return t('actions');
      if (group === 'track') return 'Track';
      const key = `group${group.charAt(0).toUpperCase()}${group.slice(1)}`;
      return t(key);
    },
    [t],
  );
}

/**
 * Búsqueda global estilo ⌘K (Twenty/Linear). Se abre con ⌘K / Ctrl+K o con el
 * evento 'zs:open-search' (botón de la sidebar). Busca en todos los productos
 * usando la API unificada /api/search.
 */
export default function CommandSearch() {
  const t = useTranslations('common.sidebar');
  const locale = useLocale();
  const tNotes = useTranslations('notes');
  const tBoard = useTranslations('board');
  const tTrack = useTranslations('track');
  const tVoice = useTranslations('voice.cmdk');
  const tSections = useTranslations('settings.sections');
  const tSettingsCmdk = useTranslations('settings.cmdk');
  const tCategories = useTranslations('common.categories');
  const router = useRouter();
  const pathname = usePathname();
  const inTrack = pathname.startsWith('/app/track');
  const inCrm = pathname.startsWith('/app/crm');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const groupOrder = useGroupOrder();
  const groupLabel = useGroupLabel(t);

  // Acciones rápidas globales: se muestran cuando no hay query.
  const actionItems = useMemo<ResultItem[]>(() => {
    const group = 'actions';
    // Acciones de Track: dentro de Track van primero y actúan en contexto
    // (el quick-create del proyecto/issue abierto); fuera, llevan a Track.
    const track: ResultItem[] = [
      {
        group: 'track',
        label: tTrack('cmdk.newIssue'),
        meta: 'C',
        href: '/app/track?newIssue=1',
        event: inTrack ? 'zs:track-new-issue' : undefined,
      },
      { group: 'track', label: tTrack('cmdk.newProject'), meta: '', href: '/app/track?newProject=1' },
      { group: 'track', label: tTrack('cmdk.myTasks'), meta: '', href: '/app/track/my-tasks' },
      { group: 'track', label: tTrack('cmdk.allIssues'), meta: '', href: '/app/track/issues' },
      { group: 'track', label: tTrack('cmdk.inbox'), meta: '', href: '/app/track/inbox' },
    ];
    const rest: ResultItem[] = [
      { group, label: t('newContact'), meta: '', href: '/app/crm/contacts/new' },
      { group, label: t('newCompany'), meta: '', href: '/app/crm/companies/new' },
      { group, label: t('newDeal'), meta: '', href: '/app/crm/deals/new' },
      { group, label: t('newTask'), meta: '', href: '/app/crm/tasks' },
      { group, label: t('startQueue'), meta: '', href: '/app/crm/tasks/queue' },
      { group, label: t('openForecast'), meta: '', href: '/app/crm/forecast' },
      { group, label: t('openApprovals'), meta: '', href: '/app/crm/approvals' },
      { group, label: t('openForms'), meta: '', href: '/app/crm/forms' },
      { group, label: t('openQuotes'), meta: '', href: '/app/crm/quotes' },
      { group, label: t('openScoring'), meta: '', href: '/app/crm/settings?tab=automation' },
      { group, label: t('openPlaybooks'), meta: '', href: '/app/crm/playbooks' },
      { group, label: t('importFromHubspot'), meta: '', href: '/app/crm/settings?tab=import&from=hubspot' },
      { group, label: t('importFromPipedrive'), meta: '', href: '/app/crm/settings?tab=import&from=pipedrive' },
      {
        group,
        label: t('askCrmAssistant'),
        meta: '',
        href: '/app/crm?assistant=1',
        event: inCrm ? 'zs:crm-assistant' : undefined,
      },
      { group, label: t('newCrmAgentRun'), meta: '', href: '/app/crm/agents?new=1' },
      { group, label: t('installGmailExtension'), meta: '', href: '/app/crm/settings?tab=integrations#chrome-extension' },
      { group, label: t('installCrmApp'), meta: '', href: '/app/crm?install=1' },
      { group, label: t('newLink'), meta: '', href: '/app/links/new' },
      { group, label: t('newDocPage'), meta: '', href: '/app/docs' },
      { group, label: t('newEventType'), meta: '', href: '/app/calendar/event-types/new' },
      { group, label: t('newFlow'), meta: '', href: '/app/flow' },
      { group, label: tNotes('actions.newNote'), meta: '', href: '/app/notes?new=1' },
      { group, label: tBoard('list.new'), meta: '', href: '/app/board?new=1' },
      { group, label: t('newAgent'), meta: '', href: '/app/agents' },
      { group, label: t('newRobot'), meta: '', href: '/app/robots?new=1' },
      { group, label: t('newGroup'), meta: '', href: '/app/groups/list?new=1' },
      { group, label: t('newGroupTemplate'), meta: '', href: '/app/groups/templates?new=1' },
      { group, label: tVoice('newMeeting'), meta: '', href: '/app/voice?new=1' },
      { group, label: tVoice('dictate'), meta: '', href: '/app/voice/dictation', event: 'zs:voice-dictate' },
      { group, label: tVoice('dictation'), meta: '', href: '/app/voice/dictation' },
    ];
    return inTrack ? [...track, ...rest] : [...rest, ...track];
  }, [t, tNotes, tBoard, tTrack, tVoice, inTrack, inCrm]);

  // Las apps (y el inicio): "crm", "hubspot" o "vender" llevan a la app. Solo al buscar.
  const appItems = useMemo<ResultItem[]>(
    () => [
      { group: 'apps', label: t('goHome'), meta: '', href: '/app', keywords: `home,inicio,início,dashboard,${t('platformHome')}` },
      ...PRODUCT_KEYS.map((key) => ({
        group: 'apps',
        label: t('openApp', { name: PRODUCT_CONFIG[key].name }),
        meta: tCategories(`${PRODUCT_CONFIG[key].category}.title`),
        href: PRODUCT_CONFIG[key].launch,
        keywords: `${PRODUCT_CONFIG[key].name},${RIVALS[key]},${tCategories(`${PRODUCT_CONFIG[key].category}.title`)}`,
      })),
      { group: 'apps', label: t('linkOverview'), meta: 'Link', href: '/app/links/overview', keywords: 'link,overview,resumen,resumo' },
    ],
    [t, tCategories],
  );

  // Secciones de Ajustes (plataforma y cada app): solo aparecen al buscar.
  const settingsItems = useMemo<ResultItem[]>(
    () => [
      ...SETTINGS_SECTION_KEYS.map((key) => ({
        group: 'settings',
        label: tSettingsCmdk('section', { section: tSections(key) }),
        meta: '',
        href: settingsSectionHref(key),
        keywords: key === 'billing' ? tSettingsCmdk('keywords.billing') : undefined,
      })),
      {
        group: 'settings',
        label: tSettingsCmdk('section', { section: tSettingsCmdk('domains') }),
        meta: '',
        href: '/app/links/settings?tab=domains',
        keywords: tSettingsCmdk('keywords.domains'),
      },
      ...PRODUCT_KEYS.map((key) => ({
        group: 'settings',
        label: tSettingsCmdk('product', { app: PRODUCT_CONFIG[key].name }),
        meta: '',
        href: productSettingsHref(key),
      })),
    ],
    [tSections, tSettingsCmdk],
  );

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Un <dialog> modal abierto queda en la capa superior y taparía la
        // paleta: se le pide cerrar (su Esc) y la paleta abre si cerró.
        const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
        if (modals.length) {
          for (const d of modals) d.dispatchEvent(new Event('cancel', { cancelable: true }));
          // El modal cierra con su estado de React (un render después): se espera hasta ~300 ms.
          let tries = 0;
          const wait = () => {
            if (!document.querySelector('dialog[open]')) setOpen(true);
            else if (++tries < 18) requestAnimationFrame(wait);
          };
          requestAnimationFrame(wait);
          return;
        }
        setOpen((v) => !v);
      }
    }
    window.addEventListener('zs:open-search', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('zs:open-search', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      // Remember the trigger to restore focus when the palette closes.
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setQ('');
      setItems(actionItems);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      // Esc cierra aunque el foco todavía no llegó al input (p. ej. abierta desde el switcher, cuyo ítem se desmontó).
      const onEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          setOpen(false);
        }
      };
      window.addEventListener('keydown', onEsc);
      return () => window.removeEventListener('keydown', onEsc);
    } else {
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    }
  }, [open, actionItems]);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setItems(actionItems);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&locale=${locale}`);
        const data = (await res.json()) as SearchResponse;
        const needle = fold(query.trim());
        // Las acciones cuyo texto empieza (o una palabra empieza) con lo buscado van
        // primero: "Ask" pone "Ask the CRM assistant" arriba de "New task".
        // Las palabras clave ("Facturación", "Billing") cuentan como una palabra más.
        const rankText = (label: string) => {
          const l = fold(label);
          if (l.startsWith(needle)) return 0;
          if (l.split(/[\s(,]+/).some((w) => w.startsWith(needle))) return 1;
          return l.includes(needle) ? 2 : -1;
        };
        const rankItem = (a: ResultItem) => {
          const own = rankText(a.label);
          if (own >= 0 || !a.keywords) return own;
          return a.keywords.split(',').some((k) => fold(k.trim()).startsWith(needle)) ? 1 : -1;
        };
        const byGroup = (a: ResultItem, b: ResultItem) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);
        const matchingActions = [...appItems, ...actionItems, ...settingsItems].filter((a) => rankItem(a) >= 0);
        const results = [...(data.items ?? [])].sort(byGroup);
        setItems(
          matchingActions.some((a) => rankItem(a) < 2)
            ? [...matchingActions.sort((a, b) => rankItem(a) - rankItem(b) || byGroup(a, b)), ...results]
            : [...matchingActions, ...results].sort(byGroup),
        );
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
        setSel(0);
      }
    },
    [appItems, actionItems, settingsItems, groupOrder, locale],
  );

  useEffect(() => {
    const id = setTimeout(() => search(q), 200);
    return () => clearTimeout(id);
  }, [q, search]);

  function go(item: ResultItem) {
    setOpen(false);
    if (item.event) {
      const name = item.event;
      // Después de cerrar la paleta (el modal toma el foco).
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(name, { cancelable: true })), 0);
      return;
    }
    router.push(item.href);
  }

  // Attached to the dialog container so Esc/arrows work wherever focus sits
  // inside the palette (input or a result button).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && items[sel]) {
      e.preventDefault();
      go(items[sel]);
    } else if (e.key === 'Tab') {
      // Focus trap: the input is the only tabbable element while open.
      e.preventDefault();
      inputRef.current?.focus();
    }
  }

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label={t('search')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-listbox"
          aria-activedescendant={items[sel] ? `cmdk-option-${sel}` : undefined}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
        />
        <div className="cmdk-results" role="listbox" id="cmdk-listbox" aria-label={t('search')}>
          {loading && <p className="cmdk-state">{t('searchLoading')}</p>}
          {!loading && q.trim() && items.length === 0 && (
            <p className="cmdk-state">{t('searchEmpty')}</p>
          )}
          {!loading &&
            items.map((item, i) => {
              const header =
                item.group !== lastGroup ? (
                  <p className="cmdk-group" key={`g-${item.group}`} role="presentation">
                    {groupLabel(item.group)}
                  </p>
                ) : null;
              lastGroup = item.group;
              return (
                <div key={`${item.href}-${i}`} role="presentation">
                  {header}
                  <button
                    type="button"
                    role="option"
                    id={`cmdk-option-${i}`}
                    aria-selected={i === sel}
                    tabIndex={-1}
                    className={`cmdk-item${i === sel ? ' sel' : ''}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(item)}
                  >
                    <span>{item.label}</span>
                    <span className="cmdk-meta">{item.meta}</span>
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
