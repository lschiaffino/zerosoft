import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-0719-mac-swift-settings',
  date: '2026-11-22',
  title: {
    en: 'New Mac app (in testing): menu bar item, native Settings and a welcome',
    es: 'Nueva app de Mac (en pruebas): ícono en la barra de menú, Ajustes nativos y bienvenida',
    pt: 'Novo app de Mac (em testes): ícone na barra de menus, Ajustes nativos e boas-vindas',
  },
  items: [
    {
      product: 'platform',
      en: 'The native Mac app we are building for the App Store now has an item in the menu bar (open zerosoft, a new tab or window, Settings, sign in or out) and its own Settings window: open at login, the menu bar item, how tabs sleep and reopen, notifications, your dictation settings, dictionary and history, and your account. The "Open desktop settings" buttons in zerosoft open it. A short welcome explains notifications before macOS asks, and only asks when you press the button; open at login stays off until you turn it on. Settings keep only switches on your Mac, never your messages or searches.',
      es: 'La app nativa de Mac que estamos haciendo para la App Store ahora tiene un ícono en la barra de menú (abrir zerosoft, una pestaña o ventana nueva, Ajustes, iniciar o cerrar sesión) y su propia ventana de Ajustes: abrir al iniciar sesión en la Mac, el ícono de la barra de menú, cómo se pausan y reabren las pestañas, notificaciones, tus ajustes de dictado, el diccionario y el historial, y tu cuenta. Los botones "Abrir los ajustes de la app" de zerosoft la abren. Una bienvenida corta explica las notificaciones antes de que macOS pregunte, y solo pregunta cuando tocás el botón; abrir al iniciar sesión queda apagado hasta que lo prendas. Los ajustes guardan en tu Mac solo interruptores, nunca tus mensajes ni tus búsquedas.',
      pt: 'O app nativo de Mac que estamos fazendo para a App Store agora tem um ícone na barra de menus (abrir o zerosoft, uma nova aba ou janela, Ajustes, entrar ou sair) e sua própria janela de Ajustes: abrir ao iniciar sessão no Mac, o ícone da barra de menus, como as abas pausam e reabrem, notificações, seus ajustes de ditado, o dicionário e o histórico, e sua conta. Os botões "Abrir as configurações do app" do zerosoft abrem essa janela. Umas boas-vindas curtas explicam as notificações antes de o macOS perguntar, e ele só pergunta quando você toca no botão; abrir ao iniciar sessão fica desligado até você ligar. Os ajustes guardam no seu Mac só interruptores, nunca suas mensagens ou buscas.',
    },
  ],
} satisfies ChangelogEntry;
