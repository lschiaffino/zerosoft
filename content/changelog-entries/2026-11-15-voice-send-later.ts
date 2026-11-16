import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-voice-send-later',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: send a voice note later',
    es: 'Inbox y Lines: enviar una nota de voz más tarde',
    pt: 'Inbox e Lines: enviar uma mensagem de voz mais tarde',
  },
  items: [
    {
      product: 'inbox',
      en: 'The recording bar now has the same clock as the message field. It pauses the recording and asks when to send it; if you close that window, the recording is still there, paused. The scheduled voice note shows above the field with its length and a play button, so you can listen to it before it goes out. Edit changes the time, Send now sends it right away and Cancel deletes the audio. It goes out as a real voice note, as a reply if you were replying. The recording bar also gained Pause and Resume.',
      es: 'La barra de grabación ahora tiene el mismo reloj que el campo de mensaje. Pausa la grabación y pregunta cuándo enviarla; si cerrás esa ventana, la grabación sigue ahí, en pausa. La nota de voz programada se ve arriba del campo con su duración y un botón para escucharla antes de que salga. Editar le cambia la hora, Enviar ya la manda en el momento y Cancelar borra el audio. Sale como una nota de voz de verdad, como respuesta si estabas respondiendo. La barra de grabación también suma Pausar y Seguir grabando.',
      pt: 'A barra de gravação agora tem o mesmo relógio do campo de mensagem. Ele pausa a gravação e pergunta quando enviar; se você fechar essa janela, a gravação continua ali, pausada. A mensagem de voz agendada aparece acima do campo com a duração e um botão para ouvir antes do envio. Editar muda o horário, Enviar agora manda na hora e Cancelar apaga o áudio. Ela sai como uma mensagem de voz de verdade, como resposta se você estava respondendo. A barra de gravação também ganhou Pausar e Continuar gravando.',
    },
    {
      product: 'groups',
      en: 'Lines has the same clock in its recording bar. The scheduled voice note stays in the strip of the chat and in the view of all scheduled messages, with its length and a play button. Change time, Send now and Cancel work as with any scheduled message, and Cancel deletes the audio.',
      es: 'Lines tiene el mismo reloj en su barra de grabación. La nota de voz programada queda en la tira del chat y en la vista de todos los programados, con su duración y un botón para escucharla. Cambiar hora, Enviar ahora y Cancelar funcionan como con cualquier programado, y Cancelar borra el audio.',
      pt: 'O Lines tem o mesmo relógio na barra de gravação. A mensagem de voz agendada fica na faixa da conversa e na tela de todas as agendadas, com a duração e um botão para ouvir. Mudar horário, Enviar agora e Cancelar funcionam como em qualquer agendada, e Cancelar apaga o áudio.',
    },
  ],
} satisfies ChangelogEntry;
