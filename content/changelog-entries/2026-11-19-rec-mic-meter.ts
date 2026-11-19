import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-rec-mic-meter',
  date: '2026-11-19',
  title: {
    en: 'Rec: a microphone meter you can read, and screen sharing that starts in the Mac app',
    es: 'Rec: un medidor de micrófono que se entiende, y compartir pantalla arranca en la app de Mac',
    pt: 'Rec: um medidor de microfone legível, e o compartilhamento de tela começa no app de Mac',
  },
  items: [
    {
      product: 'rec',
      en: 'The microphone level looked almost empty even when the microphone was fine, because the bar measured volume on a linear scale. It now uses decibels, like your computer’s sound settings: a normal voice fills about half. The thin line became 15 bars that rise at once and fall gently.',
      es: 'El nivel del micrófono se veía casi vacío aunque el micrófono estuviera bien, porque la barra medía el volumen en escala lineal. Ahora usa decibeles, como los ajustes de sonido de tu computadora: una voz normal llena cerca de la mitad. La línea finita pasó a ser 15 barras que suben al instante y bajan de a poco.',
      pt: 'O nível do microfone parecia quase vazio mesmo com o microfone funcionando, porque a barra media o volume em escala linear. Agora usa decibéis, como os ajustes de som do seu computador: uma voz normal preenche cerca da metade. A linha fina virou 15 barras que sobem na hora e descem aos poucos.',
    },
    {
      product: 'rec',
      en: 'In the Mac app, recording the screen with Computer audio turned on could fail with "Screen sharing was cancelled or blocked" before anything appeared to choose from. The app waited for the audio capture before asking for the screen, and macOS then refused the request. It now asks for both at once. If it still fails, the message says how to allow screen recording for zerosoft in System Settings.',
      es: 'En la app de Mac, grabar la pantalla con Audio de la computadora activado podía fallar con "Se canceló o se bloqueó compartir la pantalla" antes de que apareciera algo para elegir. La app esperaba a la captura de audio antes de pedir la pantalla, y macOS entonces rechazaba el pedido. Ahora pide las dos cosas a la vez. Si igual falla, el mensaje dice cómo permitirle a zerosoft grabar la pantalla en Ajustes del Sistema.',
      pt: 'No app de Mac, gravar a tela com Áudio do computador ativado podia falhar com "O compartilhamento de tela foi cancelado ou bloqueado" antes de aparecer algo para escolher. O app esperava a captura de áudio antes de pedir a tela, e o macOS então recusava o pedido. Agora pede as duas coisas ao mesmo tempo. Se ainda falhar, a mensagem diz como permitir que o zerosoft grave a tela nos Ajustes do Sistema.',
    },
  ],
} satisfies ChangelogEntry;
