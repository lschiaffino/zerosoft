import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-offline-shell',
  date: '2026-11-15',
  title: {
    en: 'Offline: open the app and move between Docs, Notes, Track and CRM without a connection',
    es: 'Sin conexión: abrir la app y pasar entre Docs, Notes, Track y CRM sin red',
    pt: 'Sem conexão: abrir o app e passar entre Docs, Notes, Track e CRM sem rede',
  },
  items: [
    {
      product: 'platform',
      en: 'While you are online, the app now saves the home page and the start of Docs, Notes, Track and CRM on your device, even if you have not opened them there yet. Without a connection you can open the app, in the browser or in the desktop app, and move between them. Apps that need a connection, like Lines, Talk or Voice, are marked "Needs connection" in the app switcher and on the home page. Opening one shows a page that says so and links to the apps that work offline, instead of a browser error or a blank window. That page reloads by itself when the connection is back.',
      es: 'Con red, la app ahora guarda en tu dispositivo el inicio y la entrada de Docs, Notes, Track y CRM, aunque todavía no los hayas abierto ahí. Sin conexión podés abrir la app, en el navegador o en la app de escritorio, y moverte entre ellas. Las apps que necesitan red, como Lines, Talk o Voice, aparecen con "Necesita conexión" en el selector de apps y en el inicio. Si abrís una, ves una página que lo explica y lleva a las apps que andan sin red, en vez del error del navegador o una ventana en blanco. Esa página se recarga sola cuando vuelve la conexión.',
      pt: 'Com conexão, o app agora guarda no seu dispositivo o início e a entrada do Docs, Notes, Track e CRM, mesmo que você ainda não os tenha aberto ali. Sem conexão você pode abrir o app, no navegador ou no app de desktop, e passar entre eles. Os apps que precisam de rede, como Lines, Talk ou Voice, aparecem com "Precisa de conexão" no seletor de apps e no início. Ao abrir um, você vê uma página que explica isso e leva aos apps que funcionam sem conexão, em vez do erro do navegador ou de uma janela em branco. Essa página recarrega sozinha quando a conexão volta.',
    },
  ],
} satisfies ChangelogEntry;
