'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { signOut } from 'next-auth/react';
import { clearOfflineData } from '@/lib/offline-queue';
import { useLocale, useTranslations } from 'next-intl';
import Logo from '@/components/brand/Logo';
import ProductGlyph from '@/components/brand/ProductGlyph';
import CopyButton from '@/components/link/CopyButton';
import { Link } from '@/i18n/navigation';
import { APP_SWITCHER_ORDER, isComingSoon, PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { featuredApps, WORKSPACE_SIZES_LIST, type WorkspaceMode } from '@/lib/workspace-mode';

const ROLES = ['founder', 'sales', 'support', 'marketing', 'engineering', 'product', 'operations', 'design', 'other'] as const;
/** Herramientas de origen (lib/onboarding.ts → SOURCE_TOOLS), con la app que la reemplaza. */
const TOOLS: Array<{ key: string; name: string; app: ProductKey; importable: boolean }> = [
  { key: 'hubspot', name: 'HubSpot', app: 'crm', importable: true },
  { key: 'pipedrive', name: 'Pipedrive', app: 'crm', importable: true },
  { key: 'salesforce', name: 'Salesforce', app: 'crm', importable: false },
  { key: 'notion', name: 'Notion', app: 'docs', importable: true },
  { key: 'linear', name: 'Linear', app: 'track', importable: true },
  { key: 'jira', name: 'Jira', app: 'track', importable: true },
  { key: 'github', name: 'GitHub Issues', app: 'track', importable: true },
  { key: 'calendly', name: 'Calendly', app: 'cal', importable: true },
  { key: 'bitly', name: 'Bitly', app: 'link', importable: true },
  { key: 'evernote', name: 'Evernote', app: 'notes', importable: true },
  { key: 'slack', name: 'Slack', app: 'talk', importable: false },
  { key: 'intercom', name: 'Intercom', app: 'chat', importable: false },
  { key: 'miro', name: 'Miro', app: 'board', importable: false },
  { key: 'zapier', name: 'Zapier', app: 'flow', importable: false },
  { key: 'loom', name: 'Loom', app: 'rec', importable: false },
];

type Step = 'use' | 'team' | 'you' | 'invite' | 'start';

interface InviteResult {
  email: string;
  status: string;
  url?: string;
}

function timeZones(current: string): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

/**
 * La cuenta con la que se entró y cómo salir, en cada paso. Sale igual que desde
 * el sidebar. Si ya aceptó una invitación, primero lo dice: esa cuenta quedó en el
 * workspace, y salir de la sesión no la saca.
 */
function SignedInAs({ email, joined }: { email: string; joined?: { id: string; name: string; guest: boolean } | null }) {
  const t = useTranslations('settings.welcome');
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const signOutNow = () => void clearOfflineData().finally(() => signOut({ callbackUrl: `/${locale}/auth/signin` }));

  async function leaveAndSignOut() {
    if (!joined) return;
    setBusy(true);
    const res = joined.guest
      ? await fetch('/api/teams/guest-of', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: joined.id }) }).catch(() => null)
      : await fetch('/api/teams/members/self', { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) setBusy(false);
    else signOutNow();
  }

  if (asking && joined) {
    return (
      <div className="wl-notice" role="status" data-testid="welcome-not-you">
        <p>{t('notYouJoined', { workspace: joined.name, email })}</p>
        <div className="wl-notyou-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void leaveAndSignOut()} disabled={busy}>
            {t('notYouLeave', { workspace: joined.name })}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOutNow} disabled={busy}>
            {t('notYouStay')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className="wl-foot">
      {t('signedInAs', { email })}{' '}
      <button type="button" className="wl-signout" onClick={() => (joined ? setAsking(true) : signOutNow())}>
        {t('notYou')}
      </button>
    </p>
  );
}

/** Mini onboarding de quien entra por una invitación: nombre, idioma y zona. */
function InvitedWelcome({ workspaceId, workspaceName, name: initialName, email, timeZone, guest }: { workspaceId: string; workspaceName: string; name: string; email: string; timeZone: string; guest: boolean }) {
  const t = useTranslations('settings.welcome');
  const locale = useLocale();
  const [name, setName] = useState(initialName);
  const [lang, setLang] = useState(locale);
  const [tz, setTz] = useState(timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(tz), [tz]);

  useEffect(() => {
    try {
      const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browser && timeZone === 'UTC') setTz(browser);
    } catch {
      /* sin Intl */
    }
  }, [timeZone]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'invited', name, locale: lang, timeZone: tz }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(t('error'));
      return;
    }
    // Un guest no entra al workspace: lo compartido se abre desde Docs de su cuenta.
    window.location.assign(`/${lang}/app${guest ? '/docs' : ''}`);
  }

  return (
    <form className="wl-card" onSubmit={submit} aria-labelledby="wl-title">
      <Logo variant="symbol" tone="current" height={28} title="" />
      <h1 id="wl-title" className="wl-title">
        {!workspaceName ? t('invited.titleNoName') : guest ? t('invited.guestTitle', { workspace: workspaceName }) : t('invited.title', { workspace: workspaceName })}
      </h1>
      <p className="wl-sub">{guest && workspaceName ? t('invited.guestSub', { workspace: workspaceName }) : t('invited.sub')}</p>
      <div className="ui-field">
        <label className="label" htmlFor="wl-name">
          {t('yourName')}
        </label>
        <input id="wl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required autoFocus />
      </div>
      <div className="ui-fields ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="wl-lang">
            {t('language')}
          </label>
          <select id="wl-lang" className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="wl-tz">
            {t('timeZone')}
          </label>
          <select id="wl-tz" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim() || busy} aria-busy={busy || undefined}>
        {workspaceName && !guest ? t('invited.go', { workspace: workspaceName }) : t('continue')}
      </button>
      <SignedInAs email={email} joined={workspaceId ? { id: workspaceId, name: workspaceName, guest } : null} />
    </form>
  );
}

/**
 * Onboarding de una cuenta nueva en pasos: uso (personal o equipo), equipo
 * (nombre y tamaño), vos (nombre y rol), invitar (solo equipo) y por dónde
 * empezar (herramienta de origen y app de entrada). Enter avanza, Atrás vuelve.
 */
export default function WelcomeFlow(props: {
  kind: 'full' | 'invited';
  workspaceName: string;
  /** El workspace que lo invitó (para "No sos vos"). */
  workspaceId?: string;
  /** Entró como guest: no usa las apps del workspace, solo lo que le comparten. */
  guest?: boolean;
  name: string;
  email: string;
  timeZone: string;
  suggestedTeam: string;
  pendingInvites: Array<{ token: string; team: string; inviter: string }>;
  domainWorkspaces: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('settings.welcome');
  const locale = useLocale();
  const [mode, setMode] = useState<WorkspaceMode | null>(null);
  const [step, setStep] = useState<Step>('use');
  const [teamName, setTeamName] = useState(props.suggestedTeam);
  const [size, setSize] = useState<string>('2-10');
  const [name, setName] = useState(props.name);
  const [role, setRole] = useState<string>('');
  const [invites, setInvites] = useState('');
  const [tool, setTool] = useState<string>('');
  const [entry, setEntry] = useState<ProductKey | ''>('');
  const [sample, setSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ next: string; invites: InviteResult[]; invalid: string[]; limited: boolean } | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [waitlist, setWaitlist] = useState<ProductKey[]>([]);

  const steps: Step[] = mode === 'team' ? ['use', 'team', 'you', 'invite', 'start'] : ['use', 'you', 'start'];
  const index = steps.indexOf(step);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  if (props.kind === 'invited') return <InvitedWelcome workspaceId={props.workspaceId ?? ''} workspaceName={props.workspaceName} name={props.name} email={props.email} timeZone={props.timeZone} guest={Boolean(props.guest)} />;

  const chosenTool = TOOLS.find((x) => x.key === tool);
  const apps: ProductKey[] = (() => {
    const featured = featuredApps({ mode: mode ?? 'team', entryApp: chosenTool?.app ?? null });
    return [...featured, ...APP_SWITCHER_ORDER.filter((k) => !featured.includes(k))].filter((k) => !isComingSoon(k));
  })();
  // Las "Próximamente" no se abren: se puede sumar a su lista de espera desde acá.
  const soonApps = APP_SWITCHER_ORDER.filter((k) => isComingSoon(k));

  function next() {
    setError(null);
    if (step === 'use' && !mode) return;
    if (step === 'team' && !teamName.trim()) return;
    const i = steps.indexOf(step);
    if (i < steps.length - 1) setStep(steps[i + 1]);
    else void finish(false);
  }

  function back() {
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]);
  }

  async function finish(importNow: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    let tz = props.timeZone;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
    } catch {
      /* sin Intl */
    }
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'full',
        mode: mode ?? 'personal',
        teamName: mode === 'team' ? teamName.trim() : undefined,
        size: mode === 'team' ? size : '1',
        role: role || undefined,
        name: name.trim() || undefined,
        invites: mode === 'team' && invites.trim() ? invites : undefined,
        sourceTool: tool || undefined,
        entryApp: entry || undefined,
        sampleData: sample,
        waitlist: waitlist.length ? waitlist : undefined,
        importNow,
        locale,
        timeZone: tz,
      }),
    }).catch(() => null);
    const data = res
      ? ((await res.json().catch(() => ({}))) as { next?: string; invites?: InviteResult[]; invalid?: string[]; invitesLimited?: boolean })
      : {};
    if (!res?.ok) {
      setBusy(false);
      setError(t('error'));
      return;
    }
    const failed = (data.invites ?? []).filter((r) => r.status !== 'sent' && r.status !== 'member');
    if (failed.length || data.invalid?.length || data.invitesLimited) {
      // Algún email no salió (o no era un email): se muestra antes de seguir, con los links para copiar.
      setBusy(false);
      setResults({ next: data.next ?? '/app', invites: data.invites ?? [], invalid: data.invalid ?? [], limited: Boolean(data.invitesLimited) });
      return;
    }
    window.location.assign(`/${locale}${data.next ?? '/app'}`);
  }

  async function joinDomain(id: string) {
    setBusy(true);
    const res = await fetch('/api/teams/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: id }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { next?: string; pending?: boolean; team?: { name: string } }) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(t('error'));
      return;
    }
    if (data.pending) {
      // El workspace pide aprobación: queda pedido y la persona sigue con su onboarding.
      setBusy(false);
      setRequested(data.team?.name ?? '');
      return;
    }
    window.location.assign(`/${locale}${data.next ?? '/app'}`);
  }

  if (results) {
    return (
      <div className="wl-card" aria-labelledby="wl-title">
        <Logo variant="symbol" tone="current" height={28} title="" />
        <h1 id="wl-title" className="wl-title" tabIndex={-1}>
          {t('results.title')}
        </h1>
        <p className="wl-sub">{t('results.sub')}</p>
        <div className="ws-results" role="status">
          {results.invalid.length > 0 && <p className="ui-error">{t('results.invalid', { list: results.invalid.join(', ') })}</p>}
          {results.limited && <p className="ui-error">{t('results.limited')}</p>}
          {results.invites.map((r) => (
            <div key={r.email} className={`ws-result ws-result-${r.status}`}>
              <span className="data ws-result-email">{r.email}</span>
              <span className="ws-result-status">
                {t(`results.status.${r.status === 'sent' || r.status === 'member' || r.status === 'skipped' ? r.status : 'notSent'}`)}
              </span>
              {r.url && r.status !== 'sent' && <CopyButton text={r.url} label={t('results.copy')} className="btn btn-secondary btn-sm" />}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.assign(`/${locale}${results.next}`)}>
          {t('continue')}
        </button>
      </div>
    );
  }

  return (
    <form
      className="wl-card"
      aria-labelledby="wl-title"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <div className="wl-top">
        <Logo variant="symbol" tone="current" height={28} title="" />
        <p className="wl-progress" aria-live="polite">
          {step === 'use' ? t('stepFirst') : t('stepOf', { step: index + 1, total: steps.length })}
        </p>
      </div>
      <div className="wl-bar" aria-hidden="true">
        <span style={{ width: step === 'use' ? '20%' : `${((index + 1) / steps.length) * 100}%` }} />
      </div>

      {step === 'use' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('use.title')}
          </h1>
          <p className="wl-sub">{t('use.sub')}</p>
          {props.pendingInvites.map((i) => (
            <div key={i.token} className="wl-notice" data-testid="welcome-invite">
              <p>{t('use.pending', { team: i.team, inviter: i.inviter })}</p>
              <Link href={`/invite/${i.token}`} className="btn btn-secondary btn-sm">
                {t('use.openInvite')}
              </Link>
            </div>
          ))}
          {requested !== null && (
            <p className="wl-notice" role="status">
              {t('use.requested', { team: requested })}
            </p>
          )}
          {requested === null && props.domainWorkspaces.map((d) => (
            <div key={d.id} className="wl-notice">
              <p>{t('use.domain', { team: d.name })}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void joinDomain(d.id)} disabled={busy}>
                {t('use.join', { team: d.name })}
              </button>
            </div>
          ))}
          <div className="wl-options" role="radiogroup" aria-label={t('use.title')}>
            {(['team', 'personal'] as const).map((m) => (
              <label key={m} className={`wl-option${mode === m ? ' is-on' : ''}`}>
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                <span className="st-strong">{t(`use.${m}.title`)}</span>
                <span className="ui-help">{t(`use.${m}.desc`)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {step === 'team' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('team.title')}
          </h1>
          <p className="wl-sub">{t('team.sub')}</p>
          <div className="ui-field">
            <label className="label" htmlFor="wl-team">
              {t('team.name')}
            </label>
            <input
              id="wl-team"
              className="input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder={t('team.namePlaceholder')}
              maxLength={80}
              required
              autoFocus
            />
          </div>
          <fieldset className="st-fieldset">
            <legend className="label">{t('team.size')}</legend>
            <div className="wl-tiles wl-tiles-sizes">
              {WORKSPACE_SIZES_LIST.filter((s) => s !== '1').map((s) => (
                <label key={s} className={`wl-tile${size === s ? ' is-on' : ''}`}>
                  <input type="radio" name="size" value={s} checked={size === s} onChange={() => setSize(s)} />
                  <span>{t(`team.sizes.${s}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {step === 'you' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('you.title')}
          </h1>
          <p className="wl-sub">{t('you.sub')}</p>
          <div className="ui-field">
            <label className="label" htmlFor="wl-you-name">
              {t('yourName')}
            </label>
            <input id="wl-you-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
          </div>
          <fieldset className="st-fieldset">
            <legend className="label">{t('you.role')}</legend>
            <div className="wl-tiles">
              {ROLES.map((r) => (
                <label key={r} className={`wl-tile${role === r ? ' is-on' : ''}`}>
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                  <span>{t(`roles.${r}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {step === 'invite' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('invite.title', { team: teamName.trim() })}
          </h1>
          <p className="wl-sub">{t('invite.sub')}</p>
          <div className="ui-field">
            <label className="label" htmlFor="wl-invites">
              {t('invite.emails')}
            </label>
            <textarea
              id="wl-invites"
              className="input wl-emails"
              rows={4}
              value={invites}
              onChange={(e) => setInvites(e.target.value)}
              placeholder={t('invite.placeholder')}
              spellCheck={false}
              autoFocus
            />
            <p className="ui-help">{t('invite.help')}</p>
          </div>
        </>
      )}

      {step === 'start' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('start.title')}
          </h1>
          <p className="wl-sub">{t('start.sub')}</p>
          <fieldset className="st-fieldset">
            <legend className="label">{t('start.tool')}</legend>
            <div className="wl-tiles">
              <label className={`wl-tile${tool === '' ? ' is-on' : ''}`}>
                <input type="radio" name="tool" value="" checked={tool === ''} onChange={() => setTool('')} />
                <span>{t('start.noTool')}</span>
              </label>
              {TOOLS.map((x) => (
                <label key={x.key} className={`wl-tile${tool === x.key ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name="tool"
                    value={x.key}
                    checked={tool === x.key}
                    onChange={() => {
                      setTool(x.key);
                      if (!entry && !isComingSoon(x.app)) setEntry(x.app);
                    }}
                  />
                  <span>{x.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="st-fieldset">
            <legend className="label">{t('start.app')}</legend>
            <div className="wl-apps">
              {apps.map((k) => (
                <label key={k} className={`wl-app${entry === k ? ' is-on' : ''}`}>
                  <input type="radio" name="entry" value={k} checked={entry === k} onChange={() => setEntry(k)} />
                  <ProductGlyph product={k} size={16} />
                  <span>{PRODUCT_CONFIG[k].name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {soonApps.length > 0 && (
            <fieldset className="st-fieldset">
              <legend className="label">{t('start.soon')}</legend>
              <p className="ui-help">{t('start.soonHelp')}</p>
              <div className="wl-apps" data-testid="welcome-soon">
                {soonApps.map((k) => (
                  <label key={k} className={`wl-app${waitlist.includes(k) ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      name="waitlist"
                      value={k}
                      checked={waitlist.includes(k)}
                      onChange={(e) => setWaitlist((w) => (e.target.checked ? [...w, k] : w.filter((x) => x !== k)))}
                    />
                    <ProductGlyph product={k} size={16} />
                    <span>{PRODUCT_CONFIG[k].name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="ui-check wl-sample">
            <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
            <span>{t('start.sample')}</span>
          </label>
        </>
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <div className="wl-actions">
        {index > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={back} disabled={busy}>
            {t('back')}
          </button>
        ) : (
          <span />
        )}
        <div className="wl-actions-main">
          {step === 'invite' && !invites.trim() && (
            <button type="button" className="btn btn-ghost" onClick={next} disabled={busy}>
              {t('invite.skip')}
            </button>
          )}
          {step === 'start' && chosenTool?.importable && (
            <button type="button" className="btn btn-secondary" onClick={() => void finish(true)} disabled={busy}>
              {t('start.importFrom', { tool: chosenTool.name })}
            </button>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || (step === 'use' && !mode) || (step === 'team' && !teamName.trim())}
            aria-busy={busy || undefined}
          >
            {step === 'start'
              ? entry
                ? t('start.go', { app: PRODUCT_CONFIG[entry].name })
                : t('start.finish')
              : step === 'invite' && invites.trim()
                ? t('invite.send')
                : t('continue')}
          </button>
        </div>
      </div>
      <SignedInAs email={props.email} />
    </form>
  );
}
