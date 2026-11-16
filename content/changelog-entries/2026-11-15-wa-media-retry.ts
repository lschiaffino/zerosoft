import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-media-retry',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: download a photo again when it did not arrive',
    es: 'Inbox y Lines: bajar de nuevo una foto que no llegó',
    pt: 'Inbox e Lines: baixar de novo uma foto que não chegou',
  },
  items: [
    {
      product: 'inbox',
      en: 'Photos and videos that came in while the line was being linked again (WhatsApp history sync) showed "Not available" because the WhatsApp server did not keep them. They are now downloaded straight from WhatsApp with the file key that comes with the message, and the phone is asked to send the file again when the link expired. A missing photo retries once on its own and shows "Download again"; when WhatsApp no longer has it, it says so.',
      es: 'Las fotos y los videos que llegaron mientras la línea se volvía a vincular (la sincronización del historial de WhatsApp) salían "No disponible" porque el servidor de WhatsApp no los guardaba. Ahora se bajan directo de WhatsApp con la clave del archivo que viene con el mensaje, y si el enlace venció se le pide al teléfono que lo vuelva a mandar. Una foto que falta se reintenta sola una vez y muestra "Bajar de nuevo"; si WhatsApp ya no la tiene, lo dice.',
      pt: 'Fotos e vídeos que chegaram enquanto a linha era vinculada de novo (a sincronização do histórico do WhatsApp) apareciam "Indisponível" porque o servidor do WhatsApp não os guardava. Agora são baixados direto do WhatsApp com a chave do arquivo que vem com a mensagem, e se o link venceu o celular é chamado a reenviar o arquivo. Uma foto que falta tenta de novo uma vez sozinha e mostra "Baixar de novo"; se o WhatsApp não a tem mais, avisa.',
    },
    {
      product: 'groups',
      en: 'The same in Lines, which also remembers when a photo is no longer on WhatsApp.',
      es: 'Lo mismo en Lines, que además recuerda cuando una foto ya no está en WhatsApp.',
      pt: 'O mesmo no Lines, que também lembra quando uma foto não está mais no WhatsApp.',
    },
  ],
} satisfies ChangelogEntry;
