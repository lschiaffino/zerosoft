import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1009-mac-swift-dictation',
  date: '2026-11-22',
  title: {
    en: 'New Mac app (in testing): dictation in any app',
    es: 'Nueva app de Mac (en pruebas): dictado en cualquier app',
    pt: 'Novo app de Mac (em testes): ditado em qualquer app',
  },
  items: [
    {
      product: 'platform',
      en: 'The native Mac app we are building for the App Store now dictates in any app: hold Option+Space (or tap it once to start and again to finish), speak, and the clean text goes where your cursor is. A bar at the bottom of the screen shows while the microphone is on, and Esc cancels. macOS asks for the microphone only the first time you dictate or press its button, never when the app opens. Pasting for you needs Accessibility, only for the paste keystroke; without it the text is copied and you press Command+V. The menu bar item can start and stop a dictation, paste the last one and send again the ones that could not go out; Settings has a Permissions section and pastes from your history.',
      es: 'La app nativa de Mac que estamos haciendo para la App Store ahora dicta en cualquier app: mantené Opción+Espacio (o tocalo una vez para empezar y otra para terminar), hablá, y el texto limpio va donde está tu cursor. Mientras el micrófono está abierto se ve una barra abajo en la pantalla, y Esc cancela. macOS pide el micrófono solo la primera vez que dictás o tocás su botón, nunca al abrir la app. Para pegar por vos necesita Accesibilidad, solo para la tecla de pegar; sin eso el texto queda copiado y tocás Comando+V. El ícono de la barra de menú puede empezar y terminar un dictado, pegar el último y mandar de nuevo los que no salieron; Ajustes tiene una sección de Permisos y pega desde tu historial.',
      pt: 'O app nativo de Mac que estamos fazendo para a App Store agora dita em qualquer app: segure Opção+Espaço (ou toque uma vez para começar e outra para terminar), fale, e o texto limpo vai onde está o seu cursor. Enquanto o microfone está aberto aparece uma barra na parte de baixo da tela, e Esc cancela. O macOS pede o microfone só na primeira vez que você dita ou toca no botão dele, nunca ao abrir o app. Para colar por você ele precisa de Acessibilidade, só para a tecla de colar; sem isso o texto fica copiado e você aperta Comando+V. O ícone da barra de menus pode começar e terminar um ditado, colar o último e enviar de novo os que não saíram; os Ajustes têm uma seção de Permissões e colam a partir do seu histórico.',
    },
  ],
} satisfies ChangelogEntry;
