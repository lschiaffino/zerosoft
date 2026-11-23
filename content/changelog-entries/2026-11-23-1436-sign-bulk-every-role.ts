import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-1436-sign-bulk-every-role',
  date: '2026-11-23',
  title: {
    en: 'Sign: bulk send fills every role from the CSV',
    es: 'Sign: el envío masivo completa todos los roles desde el CSV',
    pt: 'Sign: o envio em massa preenche todos os papéis pelo CSV',
  },
  items: [
    {
      product: 'sign',
      en: 'Bulk send from a template can now take a name and an email column for each role, such as "Manager name" and "Manager email", so every envelope can go to a different client and a different manager. Optional title and message columns change the title and message of each envelope. "Start a list with every role" writes the header for you, and roles without columns are filled once and are the same for every envelope. Lists with only name and email work as before.',
      es: 'El envío masivo desde una plantilla ahora acepta una columna de nombre y una de email para cada rol, como "Manager name" y "Manager email", así cada sobre puede ir a otro cliente y a otro manager. Las columnas opcionales title y message cambian el título y el mensaje de cada sobre. "Empezar una lista con todos los roles" arma el encabezado, y los roles sin columnas se completan una vez y van iguales para todos los sobres. Las listas con solo name y email funcionan como antes.',
      pt: 'O envio em massa a partir de um modelo agora aceita uma coluna de nome e uma de email para cada papel, como "Manager name" e "Manager email", então cada envelope pode ir para outro cliente e outro gerente. As colunas opcionais title e message mudam o título e a mensagem de cada envelope. "Começar uma lista com todos os papéis" monta o cabeçalho, e os papéis sem colunas são preenchidos uma vez e ficam iguais para todos os envelopes. Listas só com name e email funcionam como antes.',
    },
  ],
} satisfies ChangelogEntry;
