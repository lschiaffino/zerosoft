/**
 * Sign: textos de los emails y avisos que arma el servidor, en el idioma del
 * sobre (el de quien lo envió). Las páginas usan messages/<locale>/sign.json.
 */
export type SignLocale = 'en' | 'es' | 'pt';

export function signLocale(raw: string | null | undefined): SignLocale {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

const COPY = {
  en: {
    eyebrow: 'zerosoft · sign',
    inviteSubject: '{sender} sent you "{title}" to sign',
    approveSubject: '{sender} sent you "{title}" to approve',
    inviteHeading: 'Please review and sign',
    approveHeading: 'Please review and approve',
    inviteLine: '{sender} ({senderEmail}) sent you a document to sign: {title}.',
    approveLine: '{sender} ({senderEmail}) sent you a document to approve: {title}.',
    open: 'Review the document',
    expires: 'The link expires on {date}. It is personal: do not forward this email.',
    reminderSubject: 'Reminder: "{title}" is waiting for you',
    reminderLine: 'This is a reminder from {sender}: {title} is still waiting for you.',
    otpSubject: 'Your code to open "{title}"',
    otpLine: 'Your verification code is {code}. It works for 10 minutes. If you did not ask for it, ignore this email.',
    completedSubject: 'Completed: "{title}"',
    completedLine: 'Everyone signed {title}. The signed PDF, with its certificate of completion, is attached.',
    completedNoAttach: 'Everyone signed {title}. The file is too large to attach; the sender can share it from Sign.',
    finalHash: 'SHA-256 of the signed file: {hash}',
    declinedSubject: 'Declined: "{title}"',
    declinedLine: '{name} declined to sign {title}.',
    reason: 'Reason: {reason}',
    voidedSubject: 'Voided: "{title}"',
    voidedLine: '{sender} voided {title}. The link no longer works.',
    expiredSubject: 'Expired: "{title}"',
    expiredLine: '{title} expired before everyone signed it.',
    legal: 'Electronic signature with an audit trail (simple electronic signature).',
    notifySigned: '{name} signed',
    notifyCompleted: 'Everyone signed',
    notifyDeclined: '{name} declined',
    notifyExpired: 'Expired before everyone signed',
  },
  es: {
    eyebrow: 'zerosoft · sign',
    inviteSubject: '{sender} te envió "{title}" para firmar',
    approveSubject: '{sender} te envió "{title}" para aprobar',
    inviteHeading: 'Revisá y firmá',
    approveHeading: 'Revisá y aprobá',
    inviteLine: '{sender} ({senderEmail}) te envió un documento para firmar: {title}.',
    approveLine: '{sender} ({senderEmail}) te envió un documento para aprobar: {title}.',
    open: 'Revisar el documento',
    expires: 'El link vence el {date}. Es personal: no reenvíes este email.',
    reminderSubject: 'Recordatorio: "{title}" te está esperando',
    reminderLine: 'Recordatorio de {sender}: {title} todavía te está esperando.',
    otpSubject: 'Tu código para abrir "{title}"',
    otpLine: 'Tu código de verificación es {code}. Sirve por 10 minutos. Si no lo pediste, ignorá este email.',
    completedSubject: 'Completado: "{title}"',
    completedLine: 'Firmaron todos {title}. Adjuntamos el PDF firmado con su certificado de finalización.',
    completedNoAttach: 'Firmaron todos {title}. El archivo es muy grande para adjuntarlo; quien lo envió lo puede compartir desde Sign.',
    finalHash: 'SHA-256 del archivo firmado: {hash}',
    declinedSubject: 'Rechazado: "{title}"',
    declinedLine: '{name} rechazó firmar {title}.',
    reason: 'Motivo: {reason}',
    voidedSubject: 'Anulado: "{title}"',
    voidedLine: '{sender} anuló {title}. El link ya no funciona.',
    expiredSubject: 'Vencido: "{title}"',
    expiredLine: '{title} venció antes de que firmaran todos.',
    legal: 'Firma electrónica con registro de auditoría (firma electrónica simple).',
    notifySigned: '{name} firmó',
    notifyCompleted: 'Firmaron todos',
    notifyDeclined: '{name} rechazó',
    notifyExpired: 'Venció antes de que firmaran todos',
  },
  pt: {
    eyebrow: 'zerosoft · sign',
    inviteSubject: '{sender} enviou "{title}" para você assinar',
    approveSubject: '{sender} enviou "{title}" para você aprovar',
    inviteHeading: 'Revise e assine',
    approveHeading: 'Revise e aprove',
    inviteLine: '{sender} ({senderEmail}) enviou um documento para você assinar: {title}.',
    approveLine: '{sender} ({senderEmail}) enviou um documento para você aprovar: {title}.',
    open: 'Revisar o documento',
    expires: 'O link vence em {date}. É pessoal: não encaminhe este email.',
    reminderSubject: 'Lembrete: "{title}" está esperando você',
    reminderLine: 'Lembrete de {sender}: {title} ainda está esperando você.',
    otpSubject: 'Seu código para abrir "{title}"',
    otpLine: 'Seu código de verificação é {code}. Vale por 10 minutos. Se você não pediu, ignore este email.',
    completedSubject: 'Concluído: "{title}"',
    completedLine: 'Todos assinaram {title}. O PDF assinado, com o certificado de conclusão, está anexado.',
    completedNoAttach: 'Todos assinaram {title}. O arquivo é grande demais para anexar; quem enviou pode compartilhar pelo Sign.',
    finalHash: 'SHA-256 do arquivo assinado: {hash}',
    declinedSubject: 'Recusado: "{title}"',
    declinedLine: '{name} recusou assinar {title}.',
    reason: 'Motivo: {reason}',
    voidedSubject: 'Anulado: "{title}"',
    voidedLine: '{sender} anulou {title}. O link não funciona mais.',
    expiredSubject: 'Vencido: "{title}"',
    expiredLine: '{title} venceu antes de todos assinarem.',
    legal: 'Assinatura eletrônica com trilha de auditoria (assinatura eletrônica simples).',
    notifySigned: '{name} assinou',
    notifyCompleted: 'Todos assinaram',
    notifyDeclined: '{name} recusou',
    notifyExpired: 'Venceu antes de todos assinarem',
  },
} as const;

export type SignCopyKey = keyof (typeof COPY)['en'];

export function signCopy(locale: SignLocale, key: SignCopyKey, vars: Record<string, string> = {}): string {
  return COPY[locale][key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function formatDate(iso: string, locale: SignLocale): string {
  const tag = locale === 'es' ? 'es-AR' : locale === 'pt' ? 'pt-BR' : 'en-US';
  try {
    return new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
