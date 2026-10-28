'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import Icon from './icons';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';

export interface SwitcherEntry {
  teamId: string | null;
  name: string;
  logoUrl: string | null;
  own: boolean;
  role: 'owner' | 'admin' | 'member' | 'guest';
  mode: 'personal' | 'team';
  personal: boolean;
  current: boolean;
}

function Mark({ name, logoUrl, small = false }: { name: string; logoUrl: string | null; small?: boolean }) {
  const size = small ? 18 : 22;
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" width={size} height={size} className="ws-mark" />
  ) : (
    <span className={`ws-mark ws-mark-initial${small ? ' ws-mark-sm' : ''}`} aria-hidden="true">
      {(name.trim().charAt(0) || 'W').toUpperCase()}
    </span>
  );
}

/** Raíz de la app del path (/app/crm/deals/1 → /app/crm): al cambiar de workspace se queda en la misma app. */
function appRoot(pathname: string): string {
  for (const key of Object.keys(PRODUCT_CONFIG) as ProductKey[]) {
    const launch = PRODUCT_CONFIG[key].launch;
    if (pathname === launch || pathname.startsWith(`${launch}/`)) return launch;
  }
  return '/app';
}

/**
 * Switcher de workspace del sidebar: el propio y los equipos donde estoy.
 * Cambiar de workspace cambia todas las apps (los datos son del owner del
 * workspace elegido). Desde acá también se crea el equipo, se invita y se
 * llega a los ajustes del workspace.
 */
export default function WorkspaceSwitcher({
  entries,
  collapsed,
  person,
  email,
}: {
  entries: SwitcherEntry[];
  collapsed: boolean;
  person: string;
  email: string;
}) {
  const t = useTranslations('settings.switcher');
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const current = entries.find((e) => e.current) ?? entries[0];
  const label = (e: SwitcherEntry) => (e.personal && !e.name ? t('personal') : e.name);
  const admin = current ? current.role === 'owner' || current.role === 'admin' : false;
  const canCreateTeam = current?.own && current.mode === 'personal';

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  }

  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);

  async function switchTo(entry: SwitcherEntry) {
    if (entry.current || busy) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/teams/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: entry.teamId }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(t('switchError'));
      return;
    }
    // Recarga completa: todas las apps (y sus cachés del navegador) pasan al workspace nuevo.
    window.location.assign(`/${locale}${appRoot(pathname)}`);
  }

  async function createTeam() {
    if (!teamName.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: teamName.trim() }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(t('createError'));
      return;
    }
    window.location.assign(`/${locale}/app/settings/members`);
  }

  if (!current) return null;

  return (
    <div className="ws-switcher side-user-meta side-label" ref={ref}>
      <button
        ref={btn}
        type="button"
        className="ws-switcher-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('label', { name: label(current) })}
        title={collapsed ? label(current) : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="workspace-switcher"
      >
        <span className="ws-switcher-lines">
          <span className="side-user-name ws-switcher-name">
            {current.logoUrl && <Mark name={label(current)} logoUrl={current.logoUrl} small />}
            {label(current)}
          </span>
          {/* Si el workspace se llama como la persona, abajo va el email (no "Pablo / Pablo"). */}
          <span className="side-user-mail">{person.trim().toLowerCase() === label(current).trim().toLowerCase() ? email : person}</span>
        </span>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="side-menu ws-switcher-menu" role="menu" aria-label={t('menu')} onKeyDown={onMenuKey}>
          <p className="side-menu-note ws-switcher-heading">{t('workspaces')}</p>
          {entries.map((e) => (
            <button
              key={e.teamId ?? 'own'}
              type="button"
              role="menuitemradio"
              aria-checked={e.current}
              className={`side-menu-item ws-switcher-item${e.current ? ' is-current' : ''}`}
              onClick={() => void switchTo(e)}
              disabled={busy}
              data-testid="workspace-entry"
            >
              <Mark name={label(e)} logoUrl={e.logoUrl} small />
              <span className="ws-switcher-item-name">{label(e)}</span>
              <span className="ws-switcher-item-meta">{e.own ? t('yours') : t(`roles.${e.role}`)}</span>
              {e.current && (
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="ws-check">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </button>
          ))}
          <div className="ws-switcher-sep" role="separator" />
          {canCreateTeam && (
            <button
              type="button"
              role="menuitem"
              className="side-menu-item"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <Icon name="plus" size={14} />
              {t('createTeam')}
            </button>
          )}
          {admin && !canCreateTeam && (
            <Link href="/app/settings/members" role="menuitem" className="side-menu-item" onClick={() => setOpen(false)}>
              <Icon name="plus" size={14} />
              {t('invite')}
            </Link>
          )}
          <Link href="/app/settings/workspace" role="menuitem" className="side-menu-item" onClick={() => setOpen(false)}>
            <Icon name="settings" size={14} />
            {t('settings')}
          </Link>
          {error && (
            <p className="ui-error ws-switcher-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <QuickModal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('createTitle')}
        onSubmit={() => void createTeam()}
        submitLabel={t('createSubmit')}
        cancelLabel={t('cancel')}
        submitDisabled={!teamName.trim()}
        busy={busy}
        error={creating ? error : null}
        width={440}
      >
        <div className="ui-field">
          <label className="label" htmlFor="ws-create-name">
            {t('teamName')}
          </label>
          <input
            id="ws-create-name"
            className="input"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder={t('teamNamePlaceholder')}
            maxLength={80}
            autoFocus
          />
          <p className="ui-help">{t('createHelp')}</p>
        </div>
      </QuickModal>
    </div>
  );
}
