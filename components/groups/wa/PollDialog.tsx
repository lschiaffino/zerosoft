'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, useErrorText } from '../dialog-kit';
import { PollFields } from './PollFields';

export interface PollDraft {
  question: string;
  options: string[];
  multi: boolean;
}

const EMPTY: PollDraft = { question: '', options: ['', ''], multi: false };

/**
 * "Encuesta" del menú +, en Lines y en Inbox: pregunta, opciones y si se
 * puede elegir más de una. `onSend` la manda y devuelve '' si salió o el
 * código de error (se muestra acá y el diálogo queda abierto).
 */
export default function PollDialog({ open, supported = true, onClose, onSend }: { open: boolean; supported?: boolean; onClose: () => void; onSend: (poll: PollDraft) => Promise<string> }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [poll, setPoll] = useState<PollDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  async function send() {
    const options = poll.options.map((o) => o.trim()).filter(Boolean);
    if (!poll.question.trim()) return setError(errText('poll_question'));
    if (options.length < 2) return setError(errText('poll_options'));
    setBusy(true);
    setError('');
    const err = await onSend({ question: poll.question.trim(), options, multi: poll.multi });
    setBusy(false);
    if (err) return setError(errText(err));
    setPoll(EMPTY);
  }

  return (
    <Modal
      open={open}
      title={t('polls.title')}
      onClose={onClose}
      onSubmit={() => void send()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} disabled={!supported}>
            {t('polls.send')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {!supported && (
          <p className="gr-banner is-bad" role="alert">
            {t('polls.unsupported')}
          </p>
        )}
        <PollFields question={poll.question} options={poll.options} multi={poll.multi} onChange={setPoll} idPrefix="chat" />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
