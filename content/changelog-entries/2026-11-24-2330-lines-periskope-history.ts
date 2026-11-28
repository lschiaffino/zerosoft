import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-24-lines-periskope-history',
  date: '2026-11-24',
  title: {
    en: 'Bring your whole Periskope message history into Lines',
    es: 'Traé todo el historial de mensajes de Periskope a Lines',
    pt: 'Traga todo o histórico de mensagens do Periskope para o Lines',
  },
  items: [
    {
      product: 'groups',
      en: 'In Lines settings › Move from Periskope there is a new "Bring over the message history" section. With your Periskope API key it brings every message of your chats and groups from the first one: text, photos, audio, video and documents, quoted replies, reactions, who wrote each message, the original date and each chat\'s private notes. It runs in the background and resumes if it stops, you can follow chats and messages on screen, and messages that already arrived through WhatsApp are not duplicated. Files are saved in your private storage, never as a public link, and the key is stored encrypted only until the import ends.',
      es: 'En los ajustes de Lines › Migrar de Periskope hay una sección nueva, "Traer el historial de mensajes". Con la clave de la API de Periskope trae todos los mensajes de tus chats y grupos desde el primero: texto, fotos, audios, videos y documentos, respuestas citadas, reacciones, quién escribió cada mensaje, la fecha original y las notas privadas de cada chat. Corre en segundo plano y retoma si se corta, ves los chats y mensajes en pantalla, y lo que ya llegó por WhatsApp no se duplica. Los archivos se guardan en tu almacenamiento privado, nunca como link público, y la clave queda cifrada solo hasta que termina la importación.',
      pt: 'Nos ajustes do Lines › Migrar do Periskope há uma seção nova, "Trazer o histórico de mensagens". Com a chave da API do Periskope ela traz todas as mensagens dos seus chats e grupos desde a primeira: texto, fotos, áudios, vídeos e documentos, respostas citadas, reações, quem escreveu cada mensagem, a data original e as notas privadas de cada chat. Roda em segundo plano e retoma se parar, você acompanha chats e mensagens na tela, e o que já chegou pelo WhatsApp não é duplicado. Os arquivos ficam no seu armazenamento privado, nunca como link público, e a chave fica criptografada só até a importação terminar.',
    },
  ],
} satisfies ChangelogEntry;
