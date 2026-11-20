import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1922-hiring-candidate-edit',
  date: '2026-11-20',
  title: {
    en: 'Hiring: edit a candidate, and add one with only a name or an email',
    es: 'Hiring: editar un candidato, y cargarlo solo con nombre o email',
    pt: 'Hiring: editar um candidato, e adicioná-lo só com nome ou email',
  },
  items: [
    {
      product: 'hiring',
      en: 'The candidate profile has an Edit button for the recruiter, the hiring manager and admins: name, email, phone, location, headline and links. Adding a candidate by hand or by CSV now needs only a name or an email. A candidate without an email gets nothing sent: the profile says so, and emails, scheduling links and offers by email wait until someone adds one.',
      es: 'El perfil del candidato tiene un botón Editar para el recruiter, el hiring manager y los admins: nombre, email, teléfono, ubicación, título y links. Para cargar un candidato a mano o por CSV ahora alcanza con un nombre o un email. A un candidato sin email no le sale nada: el perfil lo avisa, y los emails, links de agenda y ofertas por email esperan a que alguien agregue uno.',
      pt: 'O perfil do candidato tem um botão Editar para o recrutador, o hiring manager e os admins: nome, email, telefone, localização, título e links. Para adicionar um candidato à mão ou por CSV agora basta um nome ou um email. Um candidato sem email não recebe nada: o perfil avisa, e emails, links de agenda e ofertas por email esperam até alguém adicionar um.',
    },
  ],
} satisfies ChangelogEntry;
