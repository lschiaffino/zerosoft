import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-desktop-offline-start',
  date: '2026-11-15',
  title: {
    en: 'Desktop app 0.3.9: no blank window without a connection',
    es: 'App de escritorio 0.3.9: sin ventana en blanco cuando no hay conexión',
    pt: 'App de desktop 0.3.9: sem janela em branco quando não há conexão',
  },
  items: [
    {
      product: 'platform',
      en: 'If you open the desktop app without a connection before it has saved anything for offline use (the first time, or after deleting local data), the window used to stay blank. It now says you are offline and opens zerosoft by itself when the connection is back. After one session online, the apps that work offline open without a connection like they do in the browser.',
      es: 'Si abrías la app de escritorio sin conexión antes de que guardara algo para usar sin red (la primera vez, o después de borrar los datos locales), la ventana quedaba en blanco. Ahora dice que no hay conexión y abre zerosoft sola cuando vuelve la red. Después de una sesión con red, las apps que andan sin conexión se abren sin red como en el navegador.',
      pt: 'Se você abrisse o app de desktop sem conexão antes de ele guardar algo para usar offline (a primeira vez, ou depois de apagar os dados locais), a janela ficava em branco. Agora ela diz que não há conexão e abre o zerosoft sozinha quando a conexão volta. Depois de uma sessão com conexão, os apps que funcionam offline abrem sem conexão como no navegador.',
    },
  ],
} satisfies ChangelogEntry;
