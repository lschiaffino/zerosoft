import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-offline-board',
  date: '2026-11-15',
  title: {
    en: 'Board works offline',
    es: 'Board anda sin conexión',
    pt: 'Board funciona sem conexão',
  },
  items: [
    {
      product: 'board',
      en: 'Boards you opened, and the list of boards, now open without a connection, in the browser and in the desktop app. What you draw offline is saved on your device right away. The top bar counts it as a change waiting to be sent, and it survives a reload. When the connection is back it is sent and merged element by element with what others changed in the meantime. Turn it on or off in Settings › Offline.',
      es: 'Las pizarras que abriste y la lista de pizarras ahora se abren sin conexión, en el navegador y en la app de escritorio. Lo que dibujás sin red queda en tu dispositivo enseguida. La banda de arriba lo cuenta como un cambio por enviar y no se pierde al recargar. Cuando vuelve la conexión se manda y se combina elemento por elemento con lo que otros cambiaron mientras tanto. Se prende o apaga en Ajustes › Sin conexión.',
      pt: 'Os quadros que você abriu e a lista de quadros agora abrem sem conexão, no navegador e no app de desktop. O que você desenha sem rede fica salvo no seu dispositivo na hora. A barra de cima conta isso como uma alteração a enviar, e nada se perde ao recarregar. Quando a conexão volta, é enviado e combinado elemento por elemento com o que outras pessoas mudaram nesse meio-tempo. Liga ou desliga em Configurações › Sem conexão.',
    },
  ],
} satisfies ChangelogEntry;
