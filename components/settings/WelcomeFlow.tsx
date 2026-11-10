'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { signOut } from 'next-auth/react';
import { clearOfflineData } from '@/lib/offline-queue';
import { useLocale, useTranslations } from 'next-intl';
import Logo from '@/components/brand/Logo';
import ProductGlyph from '@/components/brand/ProductGlyph';
import CopyButton from '@/components/link/CopyButton';
import Icon from '@/components/app/icons';
import DesktopDownload, { DesktopFeatures, type DesktopRelease } from '@/components/desktop/DesktopDownload';
import { Link } from '@/i18n/navigation';
import { inDesktopApp } from '@/lib/desktop-detect';
import { cleanApps, ONBOARDING_ROLES, SOURCE_TOOL_KEYS, SOURCE_TOOLS, suggestedApps, type OnboardingDraft } from '@/lib/onboarding-shared';
import { APP_SWITCHER_ORDER, isComingSoon, PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { WORKSPACE_SIZES_LIST, type WorkspaceMode } from '@/lib/workspace-mode';

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

export interface SetupConnection {
  key: 'calendar' | 'email' | 'whatsapp';
  relevant: boolean;
  done: boolean;
  /** Inicio del OAuth (se le suma ?return=) o null si este servidor no lo tiene configurado. */
  href: string | null;
  /** Dónde se configura a mano (la app correspondiente). */
  settings: string;
}

export interface SetupProps {
  step: string;
  connections: SetupConnection[];
  sourceTool: string | null;
  imported: boolean;
  admin: boolean;
  release: DesktopRelease | null;
  desktopSeen: boolean;
  result: { connected: string; result: string } | null;
}

type ProfileStep = 'use' | 'team' | 'you' | 'apps' | 'invite';

function post(body: unknown, keepalive = false) {
  return fetch('/api/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  }).catch(() => null);
}

/** Barra y "Paso n de m" arriba de cada tarjeta. */
function Progress({ label, value }: { label: string; value: number }) {
  return (
    <>
      <div className="wl-top">
        <Logo variant="symbol" tone="current" height={28} title="" />
        <p className="wl-progress" aria-live="polite">
          {label}
        </p>
      </div>
      <div className="wl-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </>
  );
}

/**
 * Onboarding de una cuenta nueva, en dos tramos. El primero (este) arma el
 * workspace: uso, equipo, vos, apps e invitaciones; guarda un borrador en cada
 * paso (se retoma al volver) y al final todo junto. El segundo es SetupFlow.
 */
export default function WelcomeFlow(props: {
  kind: 'full' | 'invited' | 'setup';
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
  draft?: OnboardingDraft;
  setup?: SetupProps;
}) {
  if (props.kind === 'invited') return <InvitedWelcome workspaceId={props.workspaceId ?? ''} workspaceName={props.workspaceName} name={props.name} email={props.email} timeZone={props.timeZone} guest={Boolean(props.guest)} />;
  if (props.kind === 'setup' && props.setup) return <SetupFlow {...props.setup} email={props.email} />;
  return <ProfileFlow {...props} />;
}

function ProfileFlow(props: Parameters<typeof WelcomeFlow>[0]) {
  const t = useTranslations('settings.welcome');
  const tProducts = useTranslations('common.products');
  const locale = useLocale();
  const d = props.draft ?? {};
  const resumed = Boolean(d.step && d.step !== 'use');
  const [mode, setMode] = useState<WorkspaceMode | null>(d.mode ?? null);
  const [step, setStep] = useState<ProfileStep>(d.step ?? 'use');
  const [teamName, setTeamName] = useState(d.teamName ?? props.suggestedTeam);
  const [size, setSize] = useState<string>(d.size ?? '2-10');
  const [name, setName] = useState(d.name ?? props.name);
  const [role, setRole] = useState<string>(d.role ?? '');
  const [apps, setApps] = useState<ProductKey[] | null>(d.apps ? cleanApps(d.apps) : null);
  // Las "Próximamente" no se abren: se puede sumar a su lista de espera desde el paso de apps.
  const [waitlist, setWaitlist] = useState<ProductKey[]>([]);
  const soonApps = APP_SWITCHER_ORDER.filter((k) => isComingSoon(k));
  const [invites, setInvites] = useState(d.invites ?? '');
  const [sample, setSample] = useState(Boolean(d.sampleData));
  // Las apps se tocaron a mano: cambiar de rol ya no las vuelve a sugerir.
  const [touched, setTouched] = useState(Boolean(d.apps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ invites: InviteResult[]; invalid: string[]; limited: boolean } | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // El aviso de "guardamos tus respuestas" vale hasta el primer cambio de paso.
  const [moved, setMoved] = useState(false);

  const steps: ProfileStep[] = mode === 'team' ? ['use', 'team', 'you', 'apps', 'invite'] : ['use', 'you', 'apps'];
  const index = Math.max(0, steps.indexOf(step));
  // Sin elegir todavía: las sugeridas para el rol (se ven marcadas al llegar al paso).
  const picked = apps ?? suggestedApps(role || null, mode ?? 'team');

  useEffect(() => {
    // Al cargar no se roba el foco (puede venir de un borrador); al cambiar de paso, sí.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  function draft(nextStep: ProfileStep) {
    setMoved(true);
    void post({ kind: 'draft', draft: { step: nextStep, mode: mode ?? undefined, teamName, size, name, role: role || undefined, apps: apps ?? undefined, sampleData: sample, invites } });
  }

  function next() {
    setError(null);
    if (step === 'use' && !mode) return;
    if (step === 'team' && !teamName.trim()) return;
    if (step === 'apps' && apps === null) setApps(picked);
    const i = steps.indexOf(step);
    if (i < steps.length - 1) {
      const n = steps[i + 1];
      setStep(n);
      draft(n);
    } else void finish();
  }

  function back() {
    const i = steps.indexOf(step);
    if (i > 0) {
      setStep(steps[i - 1]);
      draft(steps[i - 1]);
    }
  }

  function toggleApp(k: ProductKey) {
    setTouched(true);
    // Sacar deja el resto en su orden; sumar la pone al final.
    setApps(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let tz = props.timeZone;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
    } catch {
      /* sin Intl */
    }
    const res = await post({
      kind: 'full',
      mode: mode ?? 'personal',
      teamName: mode === 'team' ? teamName.trim() : undefined,
      size: mode === 'team' ? size : '1',
      role: role || undefined,
      name: name.trim() || undefined,
      invites: mode === 'team' && invites.trim() ? invites : undefined,
      apps: picked,
      waitlist: waitlist.length ? waitlist : undefined,
      sampleData: sample,
      locale,
      timeZone: tz,
    });
    const data = res ? ((await res.json().catch(() => ({}))) as { invites?: InviteResult[]; invalid?: string[]; invitesLimited?: boolean }) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(t('error'));
      return;
    }
    const failed = (data.invites ?? []).filter((r) => r.status !== 'sent' && r.status !== 'member');
    if (failed.length || data.invalid?.length || data.invitesLimited) {
      // Algún email no salió (o no era un email): se muestra antes de seguir, con los links para copiar.
      setBusy(false);
      setResults({ invites: data.invites ?? [], invalid: data.invalid ?? [], limited: Boolean(data.invitesLimited) });
      return;
    }
    // Segundo tramo (conectar, importar, escritorio): lo arma el servidor con lo que ya está hecho.
    window.location.assign(`/${locale}/app/welcome`);
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
        <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.assign(`/${locale}/app/welcome`)}>
          {t('continue')}
        </button>
      </div>
    );
  }

  return (
    <form
      className={`wl-card${step === 'apps' ? ' wl-card-wide' : ''}`}
      aria-labelledby="wl-title"
      data-step={step}
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <Progress
        label={step === 'use' ? t('stepFirst') : t('stepOf', { step: index + 1, total: steps.length })}
        value={step === 'use' ? 0.12 : (index + 1) / steps.length}
      />

      {resumed && !moved && (
        <p className="wl-resumed" role="status">
          {t('resumed')}
        </p>
      )}

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
          {requested === null && props.domainWorkspaces.map((dw) => (
            <div key={dw.id} className="wl-notice">
              <p>{t('use.domain', { team: dw.name })}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void joinDomain(dw.id)} disabled={busy}>
                {t('use.join', { team: dw.name })}
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
              {ONBOARDING_ROLES.map((r) => (
                <label key={r} className={`wl-tile${role === r ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => {
                      setRole(r);
                      // Cambiar de rol vuelve a sugerir apps mientras no se tocaron a mano.
                      if (!touched) setApps(null);
                    }}
                  />
                  <span>{t(`roles.${r}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {step === 'apps' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('apps.title')}
          </h1>
          <p className="wl-sub">{t('apps.sub')}</p>
          <fieldset className="st-fieldset">
            <legend className="wl-apps-legend">
              <span>{picked.length === 0 ? '' : role ? t('apps.suggested', { role: t(`roles.${role}`).toLowerCase() }) : t('apps.suggestedNoRole')}</span>
              <span className="data wl-apps-count" aria-live="polite">
                {t('apps.count', { n: picked.length })}
              </span>
            </legend>
            <div className="wl-appgrid">
              {APP_SWITCHER_ORDER.filter((k) => !isComingSoon(k)).map((k) => {
                const on = picked.includes(k);
                return (
                  <label key={k} className={`wl-appcard${on ? ' is-on' : ''}`} data-testid="wl-app" data-app={k}>
                    <input type="checkbox" name="apps" value={k} checked={on} onChange={() => toggleApp(k)} />
                    <span className="wl-appcard-head">
                      <ProductGlyph product={k} size={16} />
                      <span className="wl-appcard-name">{PRODUCT_CONFIG[k].name}</span>
                      <span className="wl-appcard-check" aria-hidden="true">
                        {on && <Icon name="check" size={12} />}
                      </span>
                    </span>
                    <span className="wl-appcard-desc">{tProducts(`${k}.desc`)}</span>
                  </label>
                );
              })}
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
            <span>{t('apps.sample')}</span>
          </label>
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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || (step === 'use' && !mode) || (step === 'team' && !teamName.trim())}
            aria-busy={busy || undefined}
            data-testid="wl-next"
          >
            {step === 'invite' && invites.trim() ? t('invite.send') : t('continue')}
          </button>
        </div>
      </div>
      <SignedInAs email={props.email} />
    </form>
  );
}

const CONNECT_NAMES: Record<SetupConnection['key'], string> = { calendar: 'Google Calendar', email: 'Gmail', whatsapp: 'WhatsApp' };

/**
 * Segundo tramo: conectar cuentas (según las apps elegidas), traer los datos de
 * la herramienta anterior y la app de escritorio. Cada paso se saltea; "Saltear
 * el resto" lo termina. Lo que está hecho lo dice la base (vuelve del OAuth con
 * ?connected=…), y lo que quede pendiente sigue en "Primeros pasos" del inicio.
 */
function SetupFlow(props: SetupProps & { email: string }) {
  const t = useTranslations('settings.welcome');
  const locale = useLocale();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(inDesktopApp()), []);
  const relevantConnections = props.connections.filter((c) => c.relevant);
  const steps = (['connect', 'import', 'desktop'] as const).filter(
    (s) => (s === 'connect' ? relevantConnections.length > 0 : s === 'import' ? props.admin : !desktop),
  );
  const initial = (steps as readonly string[]).includes(props.step) ? (props.step as (typeof steps)[number]) : steps[0];
  const [step, setStep] = useState(initial);
  const [tool, setTool] = useState<string>(props.sourceTool ?? '');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const index = Math.max(0, steps.indexOf(step ?? 'desktop'));

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      // Vuelta del OAuth: la URL limpia (sin ?connected=) para que recargar no repita el aviso.
      if (props.result) window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    heading.current?.focus();
  }, [step, props.result]);

  // Sin pasos (p. ej. miembro sin apps conectables, dentro de la app de escritorio): directo al inicio.
  useEffect(() => {
    if (desktop && steps.length === 0) void done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, steps.length]);

  async function done() {
    if (busy) return;
    setBusy(true);
    await post({ kind: 'setup', done: true });
    window.location.assign(`/${locale}/app`);
  }

  function go(n: number) {
    const target = steps[n];
    if (!target) {
      void done();
      return;
    }
    setStep(target);
    void post({ kind: 'setup', step: target });
  }

  function pickTool(k: string) {
    setTool(k);
    void post({ kind: 'setup', sourceTool: k || null });
  }

  const last = index >= steps.length - 1;
  const chosen = tool ? SOURCE_TOOLS[tool] : undefined;
  const ret = encodeURIComponent(`/${locale}/app/welcome`);
  const resultConn = props.result ? props.connections.find((c) => c.key === props.result!.connected) : undefined;

  if (!step) return null;

  return (
    <div className={`wl-card${step === 'desktop' ? ' wl-card-wide' : ''}`} aria-labelledby="wl-title" data-step={step}>
      <Progress label={t('setup.stepOf', { step: index + 1, total: steps.length })} value={(index + 1) / steps.length} />
      {index === 0 && (
        <p className="wl-saved">
          <Icon name="check" size={14} />
          {t('setup.savedTitle')}
        </p>
      )}

      {step === 'connect' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('connect.title')}
          </h1>
          <p className="wl-sub">{t('connect.sub')}</p>
          {props.result && resultConn && (
            <p className={props.result.result === 'connected' ? 'wl-notice' : 'ui-error'} role="status" data-testid="wl-connect-result">
              {t(`connect.result.${['connected', 'denied', 'scopes'].includes(props.result.result) ? props.result.result : 'error'}`, { name: CONNECT_NAMES[resultConn.key] })}
            </p>
          )}
          <ul className="wl-connect">
            {relevantConnections.map((c) => (
              <li key={c.key} className={`wl-connect-row${c.done ? ' is-done' : ''}`} data-testid={`wl-connect-${c.key}`}>
                <span className="wl-connect-icon" aria-hidden="true">
                  <Icon name={c.key === 'calendar' ? 'calendar' : c.key === 'email' ? 'inbox' : 'groups'} size={16} />
                </span>
                <span className="wl-connect-text">
                  <span className="wl-connect-name">{t(`connect.${c.key}.name`)}</span>
                  <span className="wl-connect-body">{t(`connect.${c.key}.body`)}</span>
                </span>
                {c.done ? (
                  <span className="wl-connect-done">
                    <Icon name="check" size={14} />
                    {t('connect.connected')}
                  </span>
                ) : c.href ? (
                  <a className="btn btn-secondary btn-sm" href={`${c.href}?return=${ret}`}>
                    {t('connect.connect')}
                  </a>
                ) : (
                  // Navegación completa: el onboarding va sin el chrome de la app y una navegación del cliente lo dejaría así.
                  <a className="btn btn-secondary btn-sm" href={`/${locale}${c.settings}`}>
                    {t('connect.openSettings')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {step === 'import' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('import.title')}
          </h1>
          <p className="wl-sub">{t('import.sub')}</p>
          <div className="wl-tiles" role="radiogroup" aria-label={t('import.title')}>
            <label className={`wl-tile${tool === '' ? ' is-on' : ''}`}>
              <input type="radio" name="tool" value="" checked={tool === ''} onChange={() => pickTool('')} />
              <span>{t('import.none')}</span>
            </label>
            {SOURCE_TOOL_KEYS.map((k) => (
              <label key={k} className={`wl-tile${tool === k ? ' is-on' : ''}`}>
                <input type="radio" name="tool" value={k} checked={tool === k} onChange={() => pickTool(k)} />
                <ProductGlyph product={SOURCE_TOOLS[k].app} size={12} />
                <span>{SOURCE_TOOLS[k].name}</span>
              </label>
            ))}
          </div>
          {chosen && !chosen.importHref && <p className="ui-help">{t('import.soon', { tool: chosen.name })}</p>}
          {chosen?.importHref && (
            <div className="wl-import-go">
              <a
                className="btn btn-primary"
                href={`/${locale}${chosen.importHref}`}
                onClick={() => void post({ kind: 'setup', step: steps[index + 1] ?? 'desktop' }, true)}
                data-testid="wl-import-go"
              >
                {t('import.go', { tool: chosen.name })}
              </a>
            </div>
          )}
        </>
      )}

      {step === 'desktop' && (
        <>
          <h1 id="wl-title" className="wl-title" tabIndex={-1} ref={heading}>
            {t('desktop.title')}
          </h1>
          <p className="wl-sub">{t('desktop.sub')}</p>
          <DesktopDownload release={props.release} variant="step" from="onboarding" track watch seen={props.desktopSeen} headingLevel={2} />
          <DesktopFeatures />
        </>
      )}

      <div className="wl-actions">
        {index > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => go(index - 1)} disabled={busy}>
            {t('back')}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => void done()} disabled={busy} data-testid="wl-skip-all">
            {t('skipAll')}
          </button>
        )}
        <div className="wl-actions-main">
          <button
            type="button"
            className={`btn ${(step === 'import' && chosen?.importHref) || (step === 'desktop' && props.release && !props.desktopSeen) ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => go(index + 1)}
            disabled={busy}
            aria-busy={busy || undefined}
            data-testid="wl-next"
          >
            {last ? t('setup.finish') : step === 'import' && chosen?.importHref ? t('import.later') : t('setup.next')}
          </button>
        </div>
      </div>
      <p className="wl-foot">{t('signedInAs', { email: props.email })}</p>
    </div>
  );
}
