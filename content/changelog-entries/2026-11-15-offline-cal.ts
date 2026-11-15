import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-offline-cal',
  date: '2026-11-15',
  title: {
    en: 'Cal opens offline, read only',
    es: 'Cal se abre sin conexión, en solo lectura',
    pt: 'Cal abre sem conexão, somente leitura',
  },
  items: [
    {
      product: 'cal',
      en: 'Bookings, event types and availability you opened now open without a connection, in the browser and in the desktop app, with what was last loaded on your device. While you are offline a notice says Cal is read only and the buttons and fields that change something are turned off. Turn it on or off in Settings › Offline.',
      es: 'Las reservas, tipos de evento y disponibilidad que abriste ahora se abren sin conexión, en el navegador y en la app de escritorio, con lo último que se cargó en tu dispositivo. Mientras no hay red, un aviso dice que Cal está en solo lectura y los botones y campos que cambian algo quedan deshabilitados. Se prende o apaga en Ajustes › Sin conexión.',
      pt: 'As reservas, tipos de evento e disponibilidade que você abriu agora abrem sem conexão, no navegador e no app de desktop, com o que foi carregado por último no seu dispositivo. Sem rede, um aviso diz que o Cal está somente leitura e os botões e campos que mudam algo ficam desativados. Liga ou desliga em Configurações › Sem conexão.',
    },
  ],
} satisfies ChangelogEntry;
