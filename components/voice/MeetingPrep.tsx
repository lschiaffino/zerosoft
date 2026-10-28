'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { VoiceBrief, VoiceCalendarEvent, VoiceFollowup, VoiceShareAccess, VoiceShareInfo } from '@/lib/voice-types';
import VoiceModal from './VoiceModal';
import { copyText } from './insert';
import { composeLinks } from '@/lib/voice-compose';
import { voiceErrorKey } from './voice-ui';

/** Lo que dice un brief: resumen, pendientes y de qué reuniones salió. */
function BriefBody({ brief }: { brief: VoiceBrief }) {
  const t = useTranslations('voice.brief');
  const format = useFormatter();
  if (!brief.meetings.length) return <p className="vc-muted">{t('empty')}</p>;
  return (
    <div className="vc-brief-body" data-testid="voice-brief">
      {brief.summary && <p>{brief.summary}</p>}
      {brief.openItems.length > 0 && (
        <>
          <h3 className="vc-h3">{t('openItems')}</h3>
          <ul className="vc-points">
            {brief.openItems.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
      <p className="vc-muted">
        {t('from')}{' '}
        {brief.meetings.map((m, i) => (
          <span key={m.id}>
            {i > 0 && ', '}
            <Link href={`/app/voice/meetings/${m.id}`}>{m.title || t('untitled')}</Link>{' '}
            <span suppressHydrationWarning>({format.dateTime(new Date(m.startedAt), { dateStyle: 'medium' })})</span>
          </span>
        ))}
      </p>
    </div>
  );
}

/** Brief de un evento del calendario (desde la lista de próximas). */
export function BriefModal({ event, onClose }: { event: VoiceCalendarEvent; onClose: () => void }) {
  const t = useTranslations('voice.brief');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [brief, setBrief] = useState<VoiceBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch('/api/voice/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventKey: event.key, locale }) })
      .then(async (r) => {
        const data = (await r.json().catch(() => null)) as (VoiceBrief & { error?: string }) | null;
        if (!alive) return;
        if (!r.ok || !data) setError(data?.error ?? 'network');
        else setBrief(data);
      })
      .catch(() => alive && setError('network'));
    return () => {
      alive = false;
    };
  }, [event.key, locale]);
  return (
    <VoiceModal title={t('titleFor', { title: event.title || t('untitled') })} onClose={onClose} closeLabel={t('close')}>
      <p className="vc-muted">{event.attendees.map((a) => a.name || a.email).join(', ')}</p>
      {error ? (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      ) : brief ? (
        <BriefBody brief={brief} />
      ) : (
        <p className="vc-muted" role="status">
          {t('loading')}
        </p>
      )}
    </VoiceModal>
  );
}

/** Brief dentro de la reunión (queda guardado): antes de grabar, con quién te vas a reunir. */
export function BriefPanel({ sessionId, initial, canBrief }: { sessionId: string; initial: VoiceBrief | null; canBrief: boolean }) {
  const t = useTranslations('voice.brief');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [brief, setBrief] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/assist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'brief', locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { brief?: VoiceBrief; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.brief) {
      setError(data?.error ?? 'network');
      return;
    }
    setBrief(data.brief);
  }
  if (!canBrief && !brief) return null;
  return (
    <section className="vc-brief" aria-labelledby="vc-brief-title">
      <div className="vc-notes-head">
        <h2 id="vc-brief-title" className="ui-section-title">
          {t('title')}
        </h2>
        {canBrief && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void generate()}>
            {busy ? t('loading') : brief ? t('refresh') : t('generate')}
          </button>
        )}
      </div>
      {brief ? <BriefBody brief={brief} /> : <p className="vc-muted">{t('help')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
    </section>
  );
}

/** Email de seguimiento: la IA lo redacta, se edita y se abre en Gmail, Outlook o el correo. */
export function FollowupModal({
  sessionId,
  initial,
  defaultTo,
  onClose,
  onSaved,
}: {
  sessionId: string;
  initial: VoiceFollowup | null;
  defaultTo: string[];
  onClose: () => void;
  onSaved: (f: VoiceFollowup) => void;
}) {
  const t = useTranslations('voice.followup');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string } | null>(
    initial ? { to: initial.to.join(', '), subject: initial.subject, body: initial.body } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function generate() {
    setBusy('generate');
    setError(null);
    setFlash(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/assist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'followup', locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { followup?: VoiceFollowup; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.followup) {
      setError(data?.error ?? 'network');
      return;
    }
    const to = data.followup.to.length ? data.followup.to : defaultTo;
    setDraft({ to: to.join(', '), subject: data.followup.subject, body: data.followup.body });
    onSaved(data.followup);
  }

  const parsed = draft ? { to: draft.to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean), subject: draft.subject, body: draft.body } : null;
  const badTo = parsed ? parsed.to.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) : false;

  async function save() {
    if (!parsed || badTo) return;
    setBusy('save');
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/assist`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ followup: parsed }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { followup?: VoiceFollowup; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.followup) {
      setError(data?.error ?? 'network');
      return;
    }
    onSaved(data.followup);
    setFlash(t('saved'));
  }

  const links = parsed ? composeLinks(parsed) : null;
  return (
    <VoiceModal
      wide
      title={t('title')}
      onClose={onClose}
      closeLabel={t('close')}
      testId="voice-followup"
      footer={
        draft && links ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || badTo} onClick={() => void save()}>
              {t('save')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => setFlash((await copyText(`${parsed!.subject}\n\n${parsed!.body}`)) ? t('copied') : t('copyFailed'))}
            >
              {t('copy')}
            </button>
            <a className="btn btn-sm" href={links.mailto}>
              {t('mail')}
            </a>
            <a className="btn btn-sm" href={links.outlook} target="_blank" rel="noreferrer">
              {t('outlook')}
            </a>
            <a className="btn btn-primary btn-sm" href={links.gmail} target="_blank" rel="noreferrer">
              {t('gmail')}
            </a>
          </>
        ) : undefined
      }
    >
      {!draft ? (
        <div className="vc-followup-start">
          <p className="vc-muted">{t('help')}</p>
          <button type="button" className="btn btn-primary" disabled={busy !== null} aria-busy={busy === 'generate' || undefined} onClick={() => void generate()}>
            {busy === 'generate' ? t('writing') : t('generate')}
          </button>
        </div>
      ) : (
        <div className="vc-followup-form">
          <div className="ui-field">
            <label className="label" htmlFor="vc-fu-to">
              {t('to')}
            </label>
            <input id="vc-fu-to" className="input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-invalid={badTo || undefined} />
            <p className="ui-help">{badTo ? t('toInvalid') : t('toHelp')}</p>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="vc-fu-subject">
              {t('subject')}
            </label>
            <input id="vc-fu-subject" className="input" maxLength={200} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} data-voice-context="email" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="vc-fu-body">
              {t('body')}
            </label>
            <textarea id="vc-fu-body" className="textarea" rows={12} maxLength={10_000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} data-voice-context="email" />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-busy={busy === 'generate' || undefined} onClick={() => void generate()}>
            {busy === 'generate' ? t('writing') : t('regenerate')}
          </button>
        </div>
      )}
      {flash && (
        <p className="vc-ok" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
    </VoiceModal>
  );
}

interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Compartir por link (como Granola): acceso workspace, personas o cualquiera; revocable. */
export function ShareModal({ sessionId, onClose, onChange }: { sessionId: string; onClose: () => void; onChange: (share: VoiceShareInfo | null) => void }) {
  const t = useTranslations('voice.share');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [loaded, setLoaded] = useState(false);
  const [share, setShare] = useState<VoiceShareInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [access, setAccess] = useState<VoiceShareAccess>('workspace');
  const [people, setPeople] = useState<string[]>([]);
  const [transcript, setTranscript] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/voice/sessions/${sessionId}/share`)
      .then((r) => (r.ok ? (r.json() as Promise<{ share: VoiceShareInfo | null; members: Member[] }>) : Promise.reject(new Error('load'))))
      .then((d) => {
        if (!alive) return;
        setShare(d.share);
        setMembers(d.members);
        if (d.share) {
          setAccess(d.share.access);
          setPeople(d.share.people.map((p) => p.id));
          setTranscript(d.share.includeTranscript);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setError('network');
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const url = share ? `${typeof window === 'undefined' ? '' : window.location.origin}/${locale}/m/${share.token}` : '';

  async function save(opts: { regenerate?: boolean } = {}) {
    setBusy(opts.regenerate ? 'regenerate' : 'save');
    setError(null);
    setFlash(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/share`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access, includeTranscript: transcript, people, regenerate: opts.regenerate }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { share?: VoiceShareInfo; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.share) {
      setError(data?.error ?? 'network');
      return;
    }
    setShare(data.share);
    onChange(data.share);
    setFlash(opts.regenerate ? t('regenerated') : share ? t('saved') : t('created'));
  }

  async function revoke() {
    setBusy('revoke');
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/share`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError('generic');
      return;
    }
    setShare(null);
    onChange(null);
    setFlash(t('revoked'));
  }

  return (
    <VoiceModal
      title={t('title')}
      onClose={onClose}
      closeLabel={t('close')}
      testId="voice-share"
      footer={
        <>
          {share && (
            <button type="button" className="btn btn-ghost btn-sm vc-foot-left" disabled={busy !== null} onClick={() => void revoke()}>
              {t('revoke')}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={!loaded || busy !== null || (access === 'people' && people.length === 0)} aria-busy={busy === 'save' || undefined} onClick={() => void save()}>
            {share ? t('save') : t('create')}
          </button>
        </>
      }
    >
      {!loaded ? (
        <p className="vc-muted" role="status">
          {t('loading')}
        </p>
      ) : (
        <div className="vc-share">
          <fieldset className="vc-share-access">
            <legend className="label">{t('access')}</legend>
            {(['workspace', 'people', 'anyone'] as const).map((a) => (
              <label key={a} className="ui-check">
                <input type="radio" name="vc-share-access" checked={access === a} onChange={() => setAccess(a)} />
                <span>
                  {t(`accessKinds.${a}`)}
                  <span className="vc-muted"> · {t(`accessHelp.${a}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {access === 'people' && (
            <fieldset className="vc-share-people">
              <legend className="label">{t('people')}</legend>
              {members.length === 0 ? (
                <p className="vc-muted">{t('peopleEmpty')}</p>
              ) : (
                members.map((m) => (
                  <label key={m.id} className="ui-check">
                    <input type="checkbox" checked={people.includes(m.id)} onChange={(e) => setPeople((list) => (e.target.checked ? [...list, m.id] : list.filter((x) => x !== m.id)))} />
                    <span>
                      {m.name || m.email}
                      {m.name && <span className="vc-muted"> · {m.email}</span>}
                    </span>
                  </label>
                ))
              )}
            </fieldset>
          )}
          <label className="ui-switch">
            <input type="checkbox" checked={transcript} onChange={(e) => setTranscript(e.target.checked)} />
            <span>{t('includeTranscript')}</span>
          </label>
          <p className="vc-muted">{t('privacy')}</p>
          {share && (
            <div className="vc-share-link">
              <input className="input data" readOnly value={url} aria-label={t('link')} onFocus={(e) => e.currentTarget.select()} />
              <div className="vc-send-row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={async () => setFlash((await copyText(url)) ? t('copied') : t('copyFailed'))}>
                  {t('copy')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void save({ regenerate: true })}>
                  {t('regenerate')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {flash && (
        <p className="vc-ok" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
    </VoiceModal>
  );
}

interface Targets {
  slack: { connected: boolean; channels: Array<{ id: string; name: string }> };
  notion: Array<{ id: string; name: string }>;
  last: { slackChannel: string; notionParent: string; notionCredentialId: string };
}

/** Mandar la nota a Slack (canal público) o a Notion (página hija) con las conexiones del workspace. */
export function SendModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const t = useTranslations('voice.send');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [targets, setTargets] = useState<Targets | null>(null);
  const [channel, setChannel] = useState('');
  const [credential, setCredential] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; url?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch('/api/voice/send-targets')
      .then((r) => (r.ok ? (r.json() as Promise<Targets>) : Promise.reject(new Error('load'))))
      .then((d) => {
        if (!alive) return;
        setTargets(d);
        setChannel(d.slack.channels.some((c) => c.id === d.last.slackChannel) ? d.last.slackChannel : (d.slack.channels[0]?.id ?? ''));
        setCredential(d.notion.some((c) => c.id === d.last.notionCredentialId) ? d.last.notionCredentialId : (d.notion[0]?.id ?? ''));
        setParent(d.last.notionParent);
      })
      .catch(() => alive && setError('network'));
    return () => {
      alive = false;
    };
  }, []);

  async function send(target: 'slack' | 'notion') {
    setBusy(target);
    setError(null);
    setFlash(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(target === 'slack' ? { target, locale, channelId: channel } : { target, locale, credentialId: credential, parent }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { url?: string | null; error?: string } | null;
    setBusy(null);
    if (!res?.ok) {
      setError(data?.error ?? 'network');
      return;
    }
    const name = targets?.slack.channels.find((c) => c.id === channel)?.name ?? '';
    setFlash(target === 'slack' ? { text: t('slackSent', { channel: name }) } : { text: t('notionSent'), url: data?.url ?? undefined });
  }

  return (
    <VoiceModal title={t('title')} onClose={onClose} closeLabel={t('close')} testId="voice-send">
      {!targets && !error ? (
        <p className="vc-muted" role="status">
          {t('loading')}
        </p>
      ) : targets ? (
        <div className="vc-send">
          <section>
            <h3 className="vc-h3">Slack</h3>
            {!targets.slack.connected ? (
              <p className="vc-muted">
                {t('slackMissing')} <Link href="/app/track/settings?tab=integrations">{t('slackLink')}</Link>
              </p>
            ) : (
              <div className="vc-send-row">
                <select className="select" value={channel} aria-label={t('slackChannel')} onChange={(e) => setChannel(e.target.value)}>
                  {targets.slack.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!channel || busy !== null} aria-busy={busy === 'slack' || undefined} onClick={() => void send('slack')}>
                  {t('slackSend')}
                </button>
              </div>
            )}
          </section>
          <section>
            <h3 className="vc-h3">Notion</h3>
            {targets.notion.length === 0 ? (
              <p className="vc-muted">
                {t('notionMissing')} <Link href="/app/flow/credentials">{t('notionLink')}</Link>
              </p>
            ) : (
              <div className="vc-send-notion">
                {targets.notion.length > 1 && (
                  <label className="vc-inline-field">
                    <span className="label">{t('notionCredential')}</span>
                    <select className="select" value={credential} onChange={(e) => setCredential(e.target.value)}>
                      {targets.notion.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="vc-inline-field">
                  <span className="label">{t('notionParent')}</span>
                  <input className="input" value={parent} maxLength={400} placeholder="https://www.notion.so/…" onChange={(e) => setParent(e.target.value)} />
                </label>
                <p className="ui-help">{t('notionHelp')}</p>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!credential || !parent.trim() || busy !== null} aria-busy={busy === 'notion' || undefined} onClick={() => void send('notion')}>
                  {t('notionSend')}
                </button>
              </div>
            )}
          </section>
          <p className="vc-muted">{t('noTranscript')}</p>
        </div>
      ) : null}
      {flash && (
        <p className="vc-ok" role="status">
          {flash.text}{' '}
          {flash.url && (
            <a href={flash.url} target="_blank" rel="noreferrer">
              {t('openNotion')}
            </a>
          )}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
    </VoiceModal>
  );
}
