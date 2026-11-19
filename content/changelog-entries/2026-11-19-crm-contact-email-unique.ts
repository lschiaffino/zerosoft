import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-crm-contact-email-unique',
  date: '2026-11-19',
  title: {
    en: 'CRM: one contact per email',
    es: 'CRM: un contacto por email',
    pt: 'CRM: um contato por email',
  },
  items: [
    {
      product: 'crm',
      en: 'Two contacts could end up with the same email, so the history of one person was split in two. Now the email identifies the contact: when you create or edit a contact with an email that another one has, the save is stopped and you get a link to the existing contact. If that contact belongs to a teammate and you cannot see it, you are only told that it exists. Capital letters and spaces around the email do not count as a difference.',
      es: 'Dos contactos podían quedar con el mismo email, y la historia de una persona se partía en dos. Ahora el email identifica al contacto: si creás o editás un contacto con un email que ya tiene otro, no se guarda y aparece un enlace al contacto que ya existe. Si ese contacto es de otra persona del equipo y no lo podés ver, solo se te avisa que existe. Las mayúsculas y los espacios alrededor del email no cuentan como diferencia.',
      pt: 'Dois contatos podiam ficar com o mesmo email, e a história de uma pessoa se dividia em duas. Agora o email identifica o contato: se você cria ou edita um contato com um email que outro já tem, ele não é salvo e aparece um link para o contato que já existe. Se esse contato é de outra pessoa da equipe e você não pode vê-lo, você só é avisado de que ele existe. Maiúsculas e espaços ao redor do email não contam como diferença.',
    },
    {
      product: 'crm',
      en: 'Bookings, chats, imports, robots and flows no longer add a second contact when the email already exists: they use that contact and leave their entry in its timeline. Imports and robots fill in or replace fields the way each one is set up. A CRM form updates the existing contact only when it is set to do so; otherwise the submission is saved and the contact is left as it is. The API answers 409 with the code contact_email_taken.',
      es: 'Las reservas, los chats, los imports, los robots y los flows ya no suman un segundo contacto cuando el email existe: usan ese contacto y dejan su entrada en el timeline. Los imports y los robots completan o reemplazan campos según como esté configurado cada uno. Un formulario del CRM actualiza el contacto existente solo si está configurado para eso; si no, el envío se guarda y el contacto queda como está. La API responde 409 con el código contact_email_taken.',
      pt: 'Reservas, chats, imports, robôs e flows não adicionam mais um segundo contato quando o email já existe: usam esse contato e deixam sua entrada no timeline. Imports e robôs preenchem ou substituem campos conforme cada um está configurado. Um formulário do CRM atualiza o contato existente só quando está configurado para isso; caso contrário, o envio é salvo e o contato fica como está. A API responde 409 com o código contact_email_taken.',
    },
    {
      product: 'crm',
      en: 'Contacts that already shared an email are not touched. The new Duplicates page, next to the contact list, shows them in groups: pick the one to keep and merge the rest into it. A contact in the recycle bin does not block its email; if another contact takes that email in the meantime, the one in the bin cannot be restored until the email is free again.',
      es: 'Los contactos que ya compartían un email no se tocan. La página nueva Duplicados, junto a la lista de contactos, los muestra en grupos: elegís cuál queda y fusionás el resto en él. Un contacto en la papelera no bloquea su email; si mientras tanto otro contacto toma ese email, el de la papelera no se puede restaurar hasta que el email vuelva a quedar libre.',
      pt: 'Os contatos que já compartilhavam um email não são alterados. A nova página Duplicados, ao lado da lista de contatos, mostra-os em grupos: você escolhe qual fica e mescla os demais nele. Um contato na lixeira não bloqueia seu email; se enquanto isso outro contato fica com esse email, o da lixeira não pode ser restaurado até o email ficar livre de novo.',
    },
  ],
} satisfies ChangelogEntry;
