import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1051-crm-workflows-w3',
  date: '2026-11-22',
  title: {
    en: 'CRM: workflows that enroll records by criteria, with an action log',
    es: 'CRM: workflows que inscriben registros por criterios, con registro de acciones',
    pt: 'CRM: workflows que inscrevem registros por critérios, com log de ações',
  },
  items: [
    {
      product: 'crm',
      en: 'A workflow can now start when a contact, company or deal meets criteria you set, checked each time the record is created or changes. With re-enrollment on, a record enters again only after a property in the criteria changes. Owners and admins can also enroll the records that already meet the criteria, up to 500 at a time; they start within a few minutes. Each enrollment has an action log for owners and admins with the result of every action and the branch it took, and a record can be removed from a workflow from the workflow page or the record. Members only see enrollments of records they can see, never the action log.',
      es: 'Un workflow ahora puede arrancar cuando un contacto, una empresa o un deal cumple los criterios que elijas, revisados cada vez que el registro se crea o cambia. Con la reinscripción prendida, un registro vuelve a entrar solo después de que cambia una propiedad de los criterios. Owners y admins también pueden inscribir los registros que ya cumplen los criterios, hasta 500 por vez; arrancan en unos minutos. Cada inscripción tiene un registro de acciones para owners y admins con el resultado de cada acción y la rama que tomó, y podés sacar un registro de un workflow desde la página del workflow o desde la ficha. Los miembros solo ven las inscripciones de registros que pueden ver, nunca el registro de acciones.',
      pt: 'Um workflow agora pode começar quando um contato, uma empresa ou um negócio cumpre os critérios que você escolher, verificados cada vez que o registro é criado ou muda. Com a reinscrição ligada, um registro volta a entrar só depois que muda uma propriedade dos critérios. Owners e admins também podem inscrever os registros que já cumprem os critérios, até 500 por vez; eles começam em alguns minutos. Cada inscrição tem um log de ações para owners e admins com o resultado de cada ação e o ramo que seguiu, e você pode remover um registro de um workflow pela página do workflow ou pela página do registro. Os membros só veem as inscrições de registros que podem ver, nunca o log de ações.',
    },
  ],
} satisfies ChangelogEntry;
