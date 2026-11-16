import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-social-saved-replies',
  date: '2026-11-16',
  title: {
    en: 'Social: saved replies in the inbox',
    es: 'Social: respuestas guardadas en la bandeja',
    pt: 'Social: respostas salvas na caixa de entrada',
  },
  items: [
    {
      product: 'social',
      en: 'The library has a new type, Saved replies, for the answers you send often in the inbox. Above each reply box, Insert saved reply puts one in the box, with {name} changed to the first name of whoever wrote and {account} to the name of your account. If the network has no name, the variable goes away without leaving a stray comma. Save as saved reply keeps what you just wrote for next time: type a name and press Enter. Saved replies are shared with the whole workspace and stay out of the post composer.',
      es: 'La biblioteca tiene un tipo nuevo, Respuestas guardadas, para lo que contestás seguido en la bandeja. Arriba de cada respuesta, Insertar respuesta guardada la pone en el cuadro, con {name} cambiado por el nombre de quien escribió y {account} por el nombre de tu cuenta. Si la red no trae el nombre, la variable se va sin dejar una coma suelta. Guardar como respuesta se queda con lo que acabás de escribir para la próxima: le ponés un nombre y Enter. Las respuestas guardadas son de todo el workspace y no aparecen en el compositor de publicaciones.',
      pt: 'A biblioteca tem um tipo novo, Respostas salvas, para o que você responde sempre na caixa de entrada. Acima de cada resposta, Inserir resposta salva coloca uma no campo, com {name} trocado pelo primeiro nome de quem escreveu e {account} pelo nome da sua conta. Se a rede não traz o nome, a variável some sem deixar uma vírgula solta. Salvar como resposta guarda o que você acabou de escrever para a próxima vez: dê um nome e aperte Enter. As respostas salvas são de todo o workspace e não aparecem no editor de publicações.',
    },
  ],
} satisfies ChangelogEntry;
