import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-wa-webhook-header',
  date: '2026-11-17',
  title: {
    en: 'The WhatsApp line key no longer travels in the address',
    es: 'La clave de la línea de WhatsApp ya no viaja en la dirección',
    pt: 'A chave da linha do WhatsApp não viaja mais no endereço',
  },
  items: [
    {
      product: 'inbox',
      en: 'When you link WhatsApp, the server sends us messages with the line key in a header instead of in the address, so it no longer shows up in request logs. Lines linked before keep working.',
      es: 'Al vincular WhatsApp, el servidor nos manda los mensajes con la clave de la línea en un encabezado y no en la dirección, así que ya no aparece en los registros de pedidos. Las líneas vinculadas antes siguen andando.',
      pt: 'Ao vincular o WhatsApp, o servidor nos envia as mensagens com a chave da linha num cabeçalho e não no endereço, então ela não aparece mais nos registros de requisições. As linhas vinculadas antes continuam funcionando.',
    },
    {
      product: 'groups',
      en: 'Lines numbers on the QR code or Evolution work the same way. Numbers on the WhatsApp Cloud API keep their address, because Meta cannot send our header and signs each message instead.',
      es: 'Los números de Lines por QR o Evolution funcionan igual. Los de la Cloud API de WhatsApp mantienen su dirección, porque Meta no puede mandar nuestro encabezado y en cambio firma cada mensaje.',
      pt: 'Os números do Lines por QR ou Evolution funcionam igual. Os da Cloud API do WhatsApp mantêm o endereço, porque a Meta não consegue enviar nosso cabeçalho e assina cada mensagem.',
    },
  ],
} satisfies ChangelogEntry;
