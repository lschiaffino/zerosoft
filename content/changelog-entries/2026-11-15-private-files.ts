import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-private-files',
  date: '2026-11-15',
  title: {
    en: 'Your files now open only for people signed in with access to them',
    es: 'Tus archivos ahora se abren solo para quien entró y tiene acceso',
    pt: 'Seus arquivos agora abrem só para quem entrou e tem acesso',
  },
  items: [
    {
      product: 'groups',
      en: 'Photos, audio, videos and documents in Lines chats open through zerosoft, and only for teammates who can see that chat. A link to a file copied out of a chat does not open in a browser without your session.',
      es: 'Fotos, audios, videos y documentos de los chats de Lines se abren por zerosoft, y solo para quien del equipo puede ver ese chat. El link de un archivo copiado de un chat no abre en un navegador sin tu sesión.',
      pt: 'Fotos, áudios, vídeos e documentos dos chats do Lines abrem pelo zerosoft, e só para quem da equipe pode ver esse chat. O link de um arquivo copiado de um chat não abre num navegador sem a sua sessão.',
    },
    {
      product: 'chat',
      en: 'Attachments in Chat conversations open for the people on the team who can see that widget. Visitors still see the files of their own conversation.',
      es: 'Los adjuntos de las conversaciones de Chat se abren para quien del equipo puede ver ese widget. Los visitantes siguen viendo los archivos de su propia conversación.',
      pt: 'Os anexos das conversas do Chat abrem para quem da equipe pode ver esse widget. Os visitantes continuam vendo os arquivos da própria conversa.',
    },
    {
      product: 'docs',
      en: 'New files in Docs, Notes, CRM, Board, Design, People and the other apps are stored encrypted and open only through each app, with the same permissions as the page or record they belong to.',
      es: 'Los archivos nuevos de Docs, Notes, CRM, Board, Design, People y las demás apps se guardan cifrados y se abren solo desde cada app, con los mismos permisos que la página o el registro al que pertenecen.',
      pt: 'Os arquivos novos de Docs, Notes, CRM, Board, Design, People e dos outros apps ficam guardados criptografados e abrem só por cada app, com as mesmas permissões da página ou do registro a que pertencem.',
    },
  ],
} satisfies ChangelogEntry;
