import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-media-heal',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: press play on a missing audio and it goes to fetch it',
    es: 'Inbox y Lines: tocar reproducir en un audio que falta lo va a buscar',
    pt: 'Inbox e Lines: tocar em reproduzir num áudio que falta vai buscá-lo',
  },
  items: [
    {
      product: 'inbox',
      en: 'A voice note, audio, video or document that could not be loaded no longer leaves a dead button. Pressing play (or the document card) fetches it from WhatsApp, asking the phone to send it again when needed, and plays or downloads it when it arrives. The bubble says what is going on: downloading, the line is disconnected, or WhatsApp no longer has it, and you can always ask again. The transcription is made once the audio is back. Audio and video can also be skipped forward, and play in Safari.',
      es: 'Una nota de voz, un audio, un video o un documento que no se pudo cargar ya no deja un botón apagado. Tocar reproducir (o la tarjeta del documento) lo va a buscar a WhatsApp, pidiéndole al teléfono que lo mande de nuevo si hace falta, y lo reproduce o lo baja cuando llega. La burbuja dice qué pasa: bajando, la línea está desconectada o WhatsApp ya no lo tiene, y siempre se puede volver a pedir. La transcripción se hace cuando el audio vuelve. Además, el audio y el video se pueden adelantar y se reproducen en Safari.',
      pt: 'Uma nota de voz, um áudio, um vídeo ou um documento que não carregou não deixa mais um botão apagado. Tocar em reproduzir (ou no cartão do documento) vai buscá-lo no WhatsApp, pedindo ao celular que o envie de novo se for preciso, e o reproduz ou baixa quando chega. O balão diz o que acontece: baixando, a linha está desconectada ou o WhatsApp não o tem mais, e sempre dá para pedir de novo. A transcrição é feita quando o áudio volta. Além disso, áudio e vídeo podem ser adiantados e tocam no Safari.',
    },
    {
      product: 'groups',
      en: 'The same in Lines. A file is no longer marked as lost while the line is disconnected, and linking the line again completes what is needed to download older files.',
      es: 'Lo mismo en Lines. Un archivo ya no queda marcado como perdido mientras la línea está desconectada, y al volver a vincular la línea se completa lo necesario para bajar los archivos anteriores.',
      pt: 'O mesmo no Lines. Um arquivo não fica mais marcado como perdido enquanto a linha está desconectada, e vincular a linha de novo completa o necessário para baixar os arquivos anteriores.',
    },
    {
      product: 'inbox',
      en: 'Linking a line again no longer drops part of the chat history: large history batches from WhatsApp were being rejected.',
      es: 'Volver a vincular una línea ya no pierde parte del historial: las tandas grandes del historial de WhatsApp se rechazaban.',
      pt: 'Vincular uma linha de novo não perde mais parte do histórico: os lotes grandes do histórico do WhatsApp eram rejeitados.',
    },
  ],
} satisfies ChangelogEntry;
