import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-notion-webhook-confirm',
  date: '2026-11-15',
  title: {
    en: 'Docs: you confirm the Notion webhook token',
    es: 'Docs: el token del webhook de Notion lo confirmás vos',
    pt: 'Docs: você confirma o token do webhook do Notion',
  },
  items: [
    {
      product: 'docs',
      en: 'When you verify the Notion webhook from Settings, the token Notion sends is shown only to the admin who started the wait, in that workspace. It is used only after you paste it in Notion and confirm it here, and a confirmed token is never replaced on its own. Every Notion event without a valid signature is rejected.',
      es: 'Al verificar el webhook de Notion desde Ajustes, el token que manda Notion se le muestra solo al admin que empezó la espera, en ese workspace. Se usa recién cuando lo pegás en Notion y lo confirmás acá, y un token confirmado nunca se reemplaza solo. Todo evento de Notion sin una firma válida se rechaza.',
      pt: 'Ao verificar o webhook do Notion em Ajustes, o token que o Notion envia aparece só para o admin que começou a espera, nesse workspace. Ele só é usado depois que você o cola no Notion e o confirma aqui, e um token confirmado nunca é substituído sozinho. Todo evento do Notion sem uma assinatura válida é rejeitado.',
    },
  ],
} satisfies ChangelogEntry;
