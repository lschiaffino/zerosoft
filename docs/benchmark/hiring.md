# Benchmark de Hiring: Workable

Fecha: 2026-11-02. Producto de referencia: Workable. Describe solo a Workable, sin juzgar nuestro producto.

## Cómo se leyó

- Páginas leídas: `workable.com/features`, `workable.com/pricing`, la portada de `help.workable.com`, tres categorías y las secciones de formulario, pipeline, entrevistas, screening, comunicación, ofertas, privacidad, página de empleos y alta de candidatos.
- Las lecturas pasaron por un modelo que resume cada página. "page read" significa que la página nombra la capacidad. Las páginas de marketing dan poco detalle.
- "page read (índice, solo título)" significa que se leyó el índice de la sección y se tomó el título del artículo, sin abrirlo. Prueba que el tema está documentado; cómo funciona queda sin leer. Cuando el título es una pregunta, la fila lo aclara, porque la respuesta podría ser negativa.
- "search snippet only" viene de WebSearch filtrado por dominio, con extractos resumidos. Algunos son viejos, de 2 a 7 años según los resultados.
- Se hicieron 42 lecturas de página entre los dos benchmarks. Una dio 404 y tres devolvieron una página vacía.

## Qué no se pudo leer

- La ayuda de Workable es pública, sin muro de login. El límite fue de cantidad: la mayoría de los artículos no se abrió, y varias listas se cortaban en "See all".
- `workable.com/recent-updates` cargó solo el título y el formulario de suscripción, sin novedades, y el artículo de release notes solo apunta ahí. Lo reciente sale de los nombres en Features y Pricing, como Workable Agent. Pueden faltar lanzamientos de 2026.
- `workable.readme.io` solo se vio por búsqueda.
- Secciones sin abrir: Job creation, Hiring team, Workflows, Jobs page, Job boards, Automated actions, Templates, Candidate surveys, Language kit y las de herramientas premium.
- Buscado sin resultado: plantillas de vacante, rango salarial, Google for Jobs, reCAPTCHA, fusión de duplicados. La búsqueda vacía no prueba que falten en el producto, y varias pueden estar en esas secciones sin abrir.

## Cómo leer las tablas

- id: el de `rows.txt` si la capacidad coincide, o uno nuevo en kebab-case. Las filas de `rows.txt` que juntaban varias capacidades conservan su id para la principal, y el resto sale como fila nueva.
- core: criterio de este documento, ajustable. yes si es función principal del ATS y la opera Workable, aunque sea adicional en algún plan. no si la da un socio, es legal de un país, consume créditos o es un detalle secundario. Toda fila unverified va como no, para que no entre al denominador sin prueba.
- Las filas con core yes y evidencia de solo título merecen una segunda pasada antes de fijar el puntaje.

## Totales

- Filas: 189 (106 core, 83 no core).
- Filas de `rows.txt` cubiertas: 73 de 73. Filas nuevas: 116.
- Evidencia: unverified 7, search snippet only 42, page read 71, page read (índice, solo título) 69.

## Vacantes (jobs)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| job-templates | Vacantes desde plantillas | Sin evidencia de plantillas de vacante en lo leído; la búsqueda solo devolvió plantillas de comunicación. Sección Job creation no leída | no | https://help.workable.com/hc/en-us/sections/35354946008599-Job-creation | unverified |
| job-duplicate | Duplicar vacante | Crea un borrador "Copy of"; los candidatos no se copian | yes | https://help.workable.com/hc/en-us/articles/115012169068-Duplicating-jobs | search snippet only |
| job-details | Departamento, ubicación, modalidad, tipo y salario | Sin artículo leído sobre estos campos; la búsqueda de rango salarial no devolvió nada | no | sin fuente | unverified |
| departments | Jerarquía de departamentos | Organizar vacantes y herramientas por departamento | yes | https://www.workable.com/features | page read |
| hiring-team | Equipo por vacante | Roles Recruiter, Hiring manager, Hiring contributor y Candidate reviewer | yes | https://help.workable.com/hc/en-us/articles/115012253648-Setting-up-a-hiring-team | search snippet only |
| custom-stages | Etapas propias | Pipelines a medida por tipo de puesto | yes | https://www.workable.com/features | page read |
| job-states | Borrador, publicada, cerrada y archivada | Publicar pasa por revisión; despublicar sigue contando como activa; archivar deja solo lectura | yes | https://help.workable.com/hc/en-us/articles/115011883727-Managing-job-statuses-draft-published-internal-confidential-archived | search snippet only |
| job-on-hold | Poner una vacante en pausa | Existe el artículo How do I close a job or put it on hold? | no | https://help.workable.com/hc/en-us/articles/115012024508-How-do-I-close-a-job-or-put-it-on-hold | search snippet only |
| internal-jobs | Vacantes internas | Estado internal en el título del artículo de estados | yes | https://help.workable.com/hc/en-us/articles/115011883727-Managing-job-statuses-draft-published-internal-confidential-archived | search snippet only |
| confidential-jobs | Vacantes confidenciales | Estado confidential en el título del artículo de estados | yes | https://help.workable.com/hc/en-us/articles/115011883727-Managing-job-statuses-draft-published-internal-confidential-archived | search snippet only |
| confidential-zone | Zona confidencial | Área de candidatos con acceso restringido (solo título) | no | https://help.workable.com/hc/en-us/articles/360007596434-Setting-the-Confidential-Zone | page read (índice, solo título) |
| job-requisitions | Requisiciones | Requisición obligatoria y aprobada antes de abrir, dentro de Hiring Plan | yes | https://help.workable.com/hc/en-us/articles/360043318294-Creating-and-managing-requisitions | search snippet only |
| requisition-approval-routing | Aprobación de requisiciones por área | Flujo por departamento y ubicación, con uno por defecto | yes | https://help.workable.com/hc/en-us/articles/360013097254-Managing-Hiring-Plan-settings-requisition-fields-approvals | search snippet only |
| requisition-reapproval | Reaprobación al editar | Campos marcados, como presupuesto, reinician la aprobación | no | https://help.workable.com/hc/en-us/articles/360034516774-How-do-I-edit-a-requisition | search snippet only |
| requisition-fields | Campos propios de requisición | Tipos como lista, número o archivo, obligatorios o no | no | https://help.workable.com/hc/en-us/articles/11722468745751-How-do-I-create-new-requisition-fields | search snippet only |
| requisition-bulk | Requisiciones masivas | Crear y gestionar en lote por headcount (solo título) | no | https://help.workable.com/hc/en-us/articles/360047210554-Creating-and-managing-requisitions-in-bulk-headcount | page read (índice, solo título) |
| requisition-statuses | Estados de requisición | Pending, approved, open, reserved y filled (solo título) | yes | https://help.workable.com/hc/en-us/articles/9470641768343-Requisition-statuses-pending-approved-open-reserved-filled | page read (índice, solo título) |
| hiring-plan-dashboard | Tablero del plan de contratación | Existe el artículo Using the Hiring Plan dashboard; cuerpo no leído | no | https://help.workable.com/hc/en-us/articles/360013340153-Using-the-Hiring-Plan-dashboard | search snippet only |
| multiposting | Publicar en portales | Una vacante a más de 200 portales gratuitos y pagos a la vez | yes | https://www.workable.com/features | page read |
| multi-language-jobs | Vacantes en varios idiomas | Traduce avisos, formularios y ofertas a nueve idiomas | yes | https://www.workable.com/features | page read |
| ai-job-content | Descripciones de vacante con AI | Genera descripciones por rol | yes | https://www.workable.com/features | page read |
| ai-interview-questions | Preguntas de entrevista con AI | Genera preguntas por rol | no | https://www.workable.com/features | page read |
| job-brief-agent | Job Brief Agent | Agente incluido en todos los planes (detalle no leído) | no | https://www.workable.com/pricing | page read |
| salary-estimator | Estimador salarial | Datos de mercado en tiempo real; costo adicional | no | https://www.workable.com/features | page read |
| inclusive-job-tools | Descripciones inclusivas | Listadas entre las herramientas de contratación inclusiva | no | https://www.workable.com/features | page read |

## Página de empleos (careers)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| careers-page | Página de empleos con marca | Constructor sin código, móvil, con búsqueda y filtros | yes | https://www.workable.com/features | page read |
| careers-editors | Editores invitados | Dar acceso al constructor (solo título) | no | https://help.workable.com/hc/en-us/articles/360060236373-Inviting-editors-to-the-Careers-Page-site-builder | page read (índice, solo título) |
| careers-custom-domain | Dominio propio | Existe la pregunta en la ayuda; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/4405165933591-Can-I-have-my-careers-page-hosted-on-my-own-website-custom-domain | page read (índice, solo título) |
| careers-widget | Listado incrustable | Lista de vacantes de marca que se actualiza sola en tu sitio | yes | https://www.workable.com/features | page read |
| careers-api | Página de empleos por API | Armar la página con la API (solo título) | no | https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page | page read (índice, solo título) |
| careers-pixel | Píxel de conversión | Medir postulaciones (solo título) | no | https://help.workable.com/hc/en-us/articles/360044592774-Adding-an-applicant-conversion-tracking-pixel | page read (índice, solo título) |
| careers-analytics | Google Analytics | Conectar Google Analytics (solo título) | no | https://help.workable.com/hc/en-us/articles/360053410833-Connecting-and-using-Google-Analytics | page read (índice, solo título) |
| job-seo | Datos estructurados y sitemap | Sin evidencia en lo leído; la búsqueda de Google for Jobs no devolvió nada | no | sin fuente | unverified |
| application-form | Formulario con preguntas propias | Formularios a medida en todos los planes | yes | https://www.workable.com/pricing | page read |
| application-reorder | Reordenar campos del formulario | Cambiar y ordenar campos (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012236908-How-can-I-change-reorder-application-form-fields | page read (índice, solo título) |
| application-reuse | Reutilizar un formulario | Guardarlo para otras vacantes (solo título) | no | https://help.workable.com/hc/en-us/articles/115012238008-How-do-I-save-my-application-form-to-use-on-other-jobs | page read (índice, solo título) |
| resume-upload | Subida de CV | Tipos de archivo admitidos; cuerpo no leído | yes | https://help.workable.com/hc/en-us/articles/115012238108-What-types-of-files-can-be-uploaded-on-the-application-form | page read (índice, solo título) |
| resume-autofill | Autocompletar con CV | Formularios que se llenan desde el CV | yes | https://www.workable.com/pricing | page read |
| one-click-apply | Postulación en un clic | Listada en formularios móviles | no | https://www.workable.com/features | page read |
| apply-linkedin | Apply with LinkedIn | Postular con LinkedIn | no | https://www.workable.com/pricing | page read |
| indeed-easy-apply | Indeed Easy Apply | Postulación desde Indeed | no | https://www.workable.com/pricing | page read |
| knockout | Preguntas eliminatorias | Descalificar automáticamente según respuestas (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012238688-Auto-disqualify-candidates-using-application-form-questions | page read (índice, solo título) |
| anti-spam | Protección contra spam | Sin evidencia en lo leído; la búsqueda de reCAPTCHA no devolvió nada | no | sin fuente | unverified |
| jobs-by-workable | Jobs by Workable | Portal propio con recomendaciones a candidatos | no | https://www.workable.com/features | page read |
| social-promotion | Promoción en redes | Muestra avisos a pasivos con segmentación AI | no | https://www.workable.com/features | page read |
| linkedin-rsc | LinkedIn Recruiter System Connect | Integración con Recruiter | no | https://www.workable.com/features | page read |

## Candidatos (candidates)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| candidate-profile | Perfil de candidato | Perfil que se comparte con el equipo para feedback y preparar entrevistas | yes | https://www.workable.com/features | page read |
| candidate-edit | Editar el perfil | Editar datos del candidato (solo título) | yes | https://help.workable.com/hc/en-us/articles/115013254788-Editing-candidate-profiles-and-information | page read (índice, solo título) |
| tags-sources | Etiquetas y orígenes | Etiquetar y categorizar candidatos; orígenes en reportes | yes | https://www.workable.com/features | page read |
| utm-sources | Orígenes propios con UTM | Link con UTM para origen a medida (solo título) | no | https://help.workable.com/hc/en-us/articles/4402389819671-Tracking-custom-candidate-sources-with-a-UTM-link | page read (índice, solo título) |
| duplicates | Detección de duplicados | Sin evidencia de detección o fusión; solo un artículo para ver si alguien postuló a varios puestos | no | https://help.workable.com/hc/en-us/articles/115012479067-How-do-I-see-if-a-candidate-has-applied-to-multiple-roles | unverified |
| timeline | Línea de tiempo | Sin artículo leído que la describa | no | sin fuente | unverified |
| bulk-actions | Acciones masivas | En la página de candidatos (solo título) | yes | https://help.workable.com/hc/en-us/articles/7698460669463-Performing-bulk-actions-on-the-Candidates-page | page read (índice, solo título) |
| sourcing | Búsqueda de pasivos | Más de 400 millones de perfiles para buscar y filtrar | yes | https://www.workable.com/features | page read |
| ai-recommendations | Candidatos sugeridos por AI | Sugerencias según el aviso, en todos los planes | yes | https://www.workable.com/features | page read |
| talent-pool | Talent Pool | Usar el Talent Pool (solo título); F lista construir pools de talento | yes | https://help.workable.com/hc/en-us/articles/360040251993-Using-the-Talent-Pool | page read (índice, solo título) |
| candidate-search | Buscar en todas las vacantes | Base única y buscable de postulantes | yes | https://www.workable.com/features | page read |
| boolean-search | Búsqueda booleana | Búsqueda avanzada (solo título) | yes | https://help.workable.com/hc/en-us/articles/6058530293015-How-do-I-run-an-advanced-boolean-search-for-candidates | page read (índice, solo título) |
| candidate-import | Importar candidatos | Migración de notas, feedback y CV | yes | https://www.workable.com/features | page read |
| resume-bulk-upload | Subir CV en lote | Uno o varios (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012661408-Uploading-candidate-resumes-CVs-Individual-and-bulk-options | page read (índice, solo título) |
| add-candidate-minimal | Alta con nombre o email | Crear con datos mínimos (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012662368-Add-a-candidate-with-just-a-name-or-email-address | page read (índice, solo título) |
| job-mailbox | Casilla de la vacante | Agregar candidatos por email (solo título) | no | https://help.workable.com/hc/en-us/articles/115012660088-Using-the-job-mailbox-to-add-candidates-via-email | page read (índice, solo título) |
| candidate-custom-fields | Campos propios | Campos propios y restricción de datos sensibles como salario | yes | https://www.workable.com/features | page read |
| candidate-attachments | Adjuntos en el perfil | Existe la pregunta en la ayuda; respuesta no leída | yes | https://help.workable.com/hc/en-us/articles/115013034447-How-do-I-attach-files-to-a-candidate-s-profile | page read (índice, solo título) |
| candidate-external-share | Compartir fuera de Workable | Enviar el perfil a externos (solo título) | no | https://help.workable.com/hc/en-us/articles/115013251668-Sharing-candidate-profiles-outside-of-Workable | page read (índice, solo título) |
| candidate-snooze | Posponer con recordatorio | Snooze y recordatorio de seguimiento (solo título) | no | https://help.workable.com/hc/en-us/articles/115013251248-Snoozing-candidates-setting-follow-up-reminders | page read (índice, solo título) |
| reference-checks | Referencias | Existe la pregunta de cómo registrarlas; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/4402322566167-What-is-the-best-way-to-record-reference-check-details | page read (índice, solo título) |
| resurface-candidates | AI resurge candidatos anteriores | Identifica candidatos pasados al abrir vacantes | yes | https://www.workable.com/features | page read |
| referrals-portal | Portal de referidos | Bolsa interna con avisos, herramientas para compartir y recompensas; incluido en Premier | yes | https://www.workable.com/features | page read |
| referrals-dashboard | Tablero de referidos | Estado, bonos y reportes | no | https://www.workable.com/features | page read |
| referrals-auto-join | Alta automática a referidos | Auto-join (solo título) | no | https://help.workable.com/hc/en-us/articles/9238348287767-Using-referrals-auto-join | page read (índice, solo título) |
| linkedin-extension | Extensión de Chrome | Sumar perfiles de LinkedIn con un clic | yes | https://www.workable.com/features | page read |

## Pipeline (pipeline)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| kanban | Pipeline por vacante | Mover candidatos por etapas (solo título). Arrastrar y soltar no confirmado | yes | https://help.workable.com/hc/en-us/articles/8495289154839-Moving-candidates-through-the-pipeline | page read (índice, solo título) |
| list-filters | Lista con filtros | Página de candidatos (solo título) | yes | https://help.workable.com/hc/en-us/articles/4981424570135-Candidates-page-overview | page read (índice, solo título) |
| copy-move-candidate | Copiar o mover a otra vacante | Copiar o mover entre vacantes (solo título) | yes | https://help.workable.com/hc/en-us/articles/115013190208-Copying-moving-candidates-to-other-jobs | page read (índice, solo título) |
| disqualify | Descalificar candidatos | Descalificar y rechazar (solo título) | yes | https://help.workable.com/hc/en-us/articles/115004710893-Disqualifying-rejecting-candidates | page read (índice, solo título) |
| disqualification-reasons | Motivos de rechazo | Motivos propios de la cuenta, usados también en automatizaciones y por el agente | yes | https://help.workable.com/hc/en-us/articles/1500007691921-Setting-up-automated-actions | search snippet only |
| reporting-pipeline | Pipeline de reportes | Pipeline de reportes distinto del de reclutamiento (solo título) | no | https://help.workable.com/hc/en-us/articles/4403965887255-Reporting-pipeline-overview | page read (índice, solo título) |

## Evaluación (evaluation)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| scorecards | Scorecards | Kits con secciones por habilidad y preguntas; puntaje por ítem o sección | yes | https://help.workable.com/hc/en-us/articles/115012304987-Creating-and-using-an-interview-kit-scorecard | search snippet only |
| rating-scale | Escala de evaluación | Existe la pregunta de si se puede cambiar; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/115012315527-Can-I-change-the-rating-scale-for-candidate-evaluations | page read (índice, solo título) |
| blind-scores | Puntajes ocultos hasta enviar | Si estás invitado al evento no ves los de colegas antes del tuyo; Super admin y recruiter exentos | yes | https://help.workable.com/hc/en-us/articles/360007696353-Why-can-t-I-see-other-interviewers-evaluations | search snippet only |
| interviewer-scope | Entrevistadores ven solo lo asignado | Sin evidencia directa. Hay rol Candidate reviewer; alcance no leído | no | https://help.workable.com/hc/en-us/articles/115005022314-Comparing-Recruiting-access-levels | unverified |
| feedback-reminders | Recordatorios de feedback | Existe la pregunta sobre recordatorios tras la entrevista; respuesta no leída | yes | https://help.workable.com/hc/en-us/articles/22754611280663-Will-interviewers-receive-a-reminder-to-evaluate-candidates-after-an-interview | page read (índice, solo título) |
| interview-kits | Guías de entrevista | Kits personalizables para evaluar de forma consistente | yes | https://www.workable.com/features | page read |
| interview-kit-sources | Crear kit desde varias fuentes | Desde cero, plantilla, otra vacante o requisitos del puesto | yes | https://help.workable.com/hc/en-us/articles/115012304987-Creating-and-using-an-interview-kit-scorecard | search snippet only |
| interview-kit-templates | Plantillas de kits | Gestionar plantillas de kits en la cuenta | yes | https://help.workable.com/hc/en-us/articles/115011834367-Managing-interview-kit-templates | search snippet only |
| interview-kit-print | Imprimir kit | Existe la pregunta en la ayuda; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/1500001546062-How-do-I-print-an-interview-kit-scorecard | search snippet only |
| anonymized-screening | Revisión anónima | Oculta datos identificatorios en la revisión inicial | yes | https://www.workable.com/features | page read |
| ai-screening | Screening con AI | Análisis semántico contra requisitos | yes | https://www.workable.com/features | page read |
| ai-match-score | Puntaje de ajuste explicable | Motivo por puntaje, excluye características protegidas y registra acciones | no | https://www.workable.com/features | page read |
| assessments | Evaluaciones y tests | Cognitivos y de personalidad; adicional en Standard | yes | https://www.workable.com/features | page read |
| assessment-stage | Test por etapa | Asociar a una etapa, envío manual o automático | yes | https://help.workable.com/hc/en-us/articles/115013399068-Adding-an-assessment-test-to-a-stage | search snippet only |
| background-checks | Verificación de antecedentes | Integración en todos los planes; proveedor no leído | no | https://www.workable.com/pricing | page read |
| internal-comments | Comentarios internos | Dejar comentarios internos (solo título) | yes | https://help.workable.com/hc/en-us/articles/115013184728-Leaving-an-internal-comment | page read (índice, solo título) |
| comment-visibility | Restringir visibilidad de comentarios | Limitar quién ve comentarios y emails (solo título) | no | https://help.workable.com/hc/en-us/articles/8125638525847-Restricting-comment-email-visibility | page read (índice, solo título) |
| draft-autosave | Guardado de borradores | Existe la pregunta; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/8046246213911-Does-Workable-autosave-draft-comments-evaluations-emails | page read (índice, solo título) |

## Entrevistas (interviews)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| self-scheduling | Autoagenda del candidato | Reserva de horario, sincronización y zona horaria | yes | https://www.workable.com/features | page read |
| scheduling-buffers | Márgenes en autoagenda | Tiempo entre eventos (solo título) | no | https://help.workable.com/hc/en-us/articles/21292472408983-Setting-buffers-for-self-scheduled-events | page read (índice, solo título) |
| interviewer-availability | Disponibilidad del entrevistador | Definir horarios (solo título) | yes | https://help.workable.com/hc/en-us/articles/9005411652503-Setting-your-interview-availability | page read (índice, solo título) |
| calendar-invites | Invitaciones de calendario | Sincronización bidireccional con Google y Outlook | yes | https://www.workable.com/features | page read |
| candidate-event-reminders | Recordatorios al candidato | Existe la pregunta sobre recordatorios por email; respuesta no leída | yes | https://help.workable.com/hc/en-us/articles/32871072712855-Do-candidates-receive-reminder-emails-for-scheduled-events | page read (índice, solo título) |
| event-templates | Plantillas de eventos | Descripciones reutilizables (solo título) | no | https://help.workable.com/hc/en-us/articles/6438144258967-Using-event-description-templates | page read (índice, solo título) |
| video-conferencing | Videollamadas | Zoom, Google Meet y Microsoft Teams | yes | https://www.workable.com/features | page read |
| upcoming-interviews | Ver próximas entrevistas | Existe la pregunta en la ayuda; respuesta no leída | yes | https://help.workable.com/hc/en-us/articles/115012983167-How-do-I-see-my-upcoming-interviews | page read (índice, solo título) |
| video-interviews | Entrevistas en video de una vía | Respuestas grabadas; adicional en Standard | yes | https://www.workable.com/features | page read |
| video-interview-stage | Video por etapa | Asociar a etapa con envío automático | no | https://help.workable.com/hc/en-us/articles/115015744248-Adding-a-video-interview-to-a-stage | search snippet only |
| multi-part-interviews | Entrevistas de varias partes | Planificar con detalles, mapas y calendario | yes | https://www.workable.com/features | page read |

## Comunicación (communication)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| email-templates | Plantillas de email | Plantillas de comunicación reutilizables (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012937167-Using-communication-templates | page read (índice, solo título) |
| send-email | Enviar email desde la app | Vista general de emails a candidatos (solo título) | yes | https://help.workable.com/hc/en-us/articles/115013397388-Emailing-candidates-overview | page read (índice, solo título) |
| email-replies | Respuestas en el candidato | Email de dos vías con Google y Outlook | yes | https://www.workable.com/features | page read |
| bulk-email | Email masivo | Enviar a varios (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012938067-Sending-bulk-emails-to-candidates | page read (índice, solo título) |
| scheduled-send | Envío programado | Existe la pregunta sobre programar email o SMS; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/14520461575191-How-do-I-schedule-an-email-or-sms-to-be-sent-at-a-later-date-time | page read (índice, solo título) |
| private-email | Email o texto privado | Existe la pregunta en la ayuda; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/115013241067-How-do-I-keep-an-email-text-private | page read (índice, solo título) |
| email-signature | Firma de email | Crear firma propia (solo título) | no | https://help.workable.com/hc/en-us/articles/115012023428-Creating-an-email-signature | page read (índice, solo título) |
| ai-email | Emails redactados con AI | Referencian calificaciones y requisitos | no | https://www.workable.com/features | page read |
| sms | SMS | Mensajes al candidato; adicional en Standard | yes | https://www.workable.com/features | page read |
| candidate-surveys | Encuestas de experiencia | Feedback en varias etapas | yes | https://www.workable.com/features | page read |

## Ofertas (offers)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| offer-letters | Cartas de oferta desde plantillas | Plantillas de oferta, flujos de aprobación y firma | yes | https://www.workable.com/features | page read |
| offer-variables | Variables propias en ofertas | Variables personalizadas (solo título) | no | https://help.workable.com/hc/en-us/articles/360006374854-Custom-e-signature-document-variables | page read (índice, solo título) |
| offer-approval | Aprobación de ofertas | Grupos de aprobación; no se contacta al candidato hasta terminar | yes | https://help.workable.com/hc/en-us/articles/360039944593-Setting-up-offer-and-e-signature-templates | search snippet only |
| offer-accept | Aceptación online | Firma sin login por Dropbox Sign. Rechazo explícito por parte del candidato no confirmado | yes | https://help.workable.com/hc/en-us/articles/360039944893-Sending-offer-and-e-signature-documents | search snippet only |
| offer-expiration | Vencimiento de oferta | Pasada la fecha no se firma y hay que enviar otra | yes | https://help.workable.com/hc/en-us/articles/360039944893-Sending-offer-and-e-signature-documents | search snippet only |
| e-signature | Firma electrónica | Firma nativa e integraciones | yes | https://www.workable.com/pricing | page read |
| company-signatory | Firmante de la empresa | Existe la pregunta en la ayuda; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/9187045071255-How-can-I-add-a-company-signatory-to-offers | page read (índice, solo título) |
| simple-esign-templates | Plantillas simples de firma | Tipo simple además de oferta (solo título) | no | https://help.workable.com/hc/en-us/articles/360052445154-What-s-the-difference-between-simple-and-offer-e-signature-templates | page read (índice, solo título) |
| offer-template-access | Limitar acceso a plantillas | Restringir plantillas de oferta (solo título) | no | https://help.workable.com/hc/en-us/articles/360001181814-Limiting-access-to-offer-and-e-signature-templates | page read (índice, solo título) |
| offer-details-access | Acceso a detalles de oferta | Existe la pregunta de quién accede; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/7078744037527-Who-has-access-to-the-offer-letter-details | page read (índice, solo título) |

## Reportes (reports)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| time-to-hire | Tiempo de contratación | Time to fill y time to hire, con mediana y promedio | yes | https://help.workable.com/hc/en-us/articles/115012756907-Using-the-Time-to-hire-report | search snippet only |
| hiring-velocity | Velocidad de contratación | Tiempo promedio por etapa | yes | https://help.workable.com/hc/en-us/articles/115012751307-Using-the-Hiring-velocity-report | search snippet only |
| conversion | Conversión por etapa | Hiring funnel: total, avanzados, descalificados y en curso | yes | https://help.workable.com/hc/en-us/articles/115012095048-Which-report-should-I-use | search snippet only |
| source-report | Efectividad de orígenes | Candidate sources por categoría | yes | https://help.workable.com/hc/en-us/articles/115012095048-Which-report-should-I-use | search snippet only |
| open-jobs-report | Vacantes abiertas | Job pipeline: candidatos en cada etapa de cada vacante activa | yes | https://help.workable.com/hc/en-us/articles/115012095048-Which-report-should-I-use | search snippet only |
| job-details-report | Detalle de vacantes | Reporte Job details (solo título) | yes | https://help.workable.com/hc/en-us/articles/39417531158551-Using-the-Job-details-report | page read (índice, solo título) |
| offers-hires-report | Ofertas y contrataciones | Reporte Offers and Hires (solo título) | yes | https://help.workable.com/hc/en-us/articles/40273646790935-Using-the-Offers-and-Hires-report | page read (índice, solo título) |
| offer-details-report | Detalle de ofertas | Reporte Offer details (solo título) | no | https://help.workable.com/hc/en-us/articles/40273393971351-Using-the-Offer-details-report | page read (índice, solo título) |
| team-productivity | Productividad del equipo | Existe el reporte; cuerpo no leído | no | https://help.workable.com/hc/en-us/articles/115012756687-Using-the-Team-productivity-report | search snippet only |
| hiring-plan-report | Reporte del plan de contratación | Requisiciones, presupuesto contra salario ofrecido y tiempo de llenado | no | https://help.workable.com/hc/en-us/articles/360013529953-Using-the-Hiring-plan-report | search snippet only |
| ai-credit-report | Uso de créditos AI | Reporte de consumo (solo título) | no | https://help.workable.com/hc/en-us/articles/42455649899287-Using-the-AI-credit-usage-report | page read (índice, solo título) |
| eeo-reports | Reportes EEO | Compliance details (EEO) (solo título) | no | https://help.workable.com/hc/en-us/articles/38852897808151-Using-the-Compliance-details-EEO-report | page read (índice, solo título) |
| custom-reports | Reportes a medida | Cualquier campo, con tablas, gráficos y KPI | yes | https://www.workable.com/features | page read |
| report-filters | Filtros por dimensión | Por equipo, departamento, ubicación, tipo u origen | yes | https://www.workable.com/features | page read |
| saved-reports | Reportes guardados | Guardar y reutilizar | yes | https://www.workable.com/features | page read |
| custom-dashboards | Dashboards a medida | Ordenar reportes guardados en tableros | yes | https://www.workable.com/features | page read |
| report-exports | Exportar reportes | Excel, CSV o PDF | yes | https://www.workable.com/features | page read |
| report-sharing | Compartir reportes | Con otros miembros (solo título) | yes | https://help.workable.com/hc/en-us/articles/41691866600343-Sharing-reports-with-other-members | page read (índice, solo título) |
| governed-sharing | Compartir gobernado | Visibilidad por rol en reportes compartidos; plan Enterprise | no | https://www.workable.com/features | page read |
| scheduled-reports | Reportes programados por email | Diario, semanal o mensual | yes | https://www.workable.com/features | page read |
| bi-link | Enlace a BI | Conectar datos a herramientas de BI (solo título) | no | https://help.workable.com/hc/en-us/articles/115012758707-Business-Intelligence-data-link | page read (índice, solo título) |
| monthly-spotlight | Email mensual Spotlight | Existe; cuerpo no leído | no | https://help.workable.com/hc/en-us/articles/360051270534-How-is-the-data-in-my-Monthly-Spotlight-email-calculated | page read (índice, solo título) |

## Privacidad (privacy)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| team-visibility | Datos solo para el equipo | Permisos por rol, y publicar acotado a departamento o ubicación del recruiter. Detalle por candidato no leído | yes | https://help.workable.com/hc/en-us/articles/115005022314-Comparing-Recruiting-access-levels | search snippet only |
| consent | Consentimiento en el formulario | Casilla por defecto en los formularios de Workable | yes | https://help.workable.com/hc/en-us/articles/115011942227-Workable-security-and-data-privacy | search snippet only |
| retention | Retención de datos | Periodo a elección, contado desde el alta, con condición de inactividad | yes | https://help.workable.com/hc/en-us/articles/360041472254-Setting-up-GDPR-automation-features | search snippet only |
| gdpr-automation | Automatización GDPR | Herramientas automáticas en todos los planes | yes | https://www.workable.com/pricing | page read |
| sourced-auto-delete | Borrado de candidatos buscados sin contacto | Elimina a los 30 días si no recibieron aviso ni contacto | no | https://help.workable.com/hc/en-us/articles/360041472254-Setting-up-GDPR-automation-features | search snippet only |
| sourced-privacy-notice | Aviso de privacidad a buscados | Existe la pregunta de cómo notificarlos; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/4412039713943-How-do-I-notify-sourced-candidates-about-my-Privacy-Notice | page read (índice, solo título) |
| deletion-requests | Borrado de datos | Borrado definitivo manual, sin aviso al candidato. Autoservicio para el candidato no confirmado | yes | https://help.workable.com/hc/en-us/articles/115013260288-Deleting-candidates | search snippet only |
| ccpa | Funciones CCPA | Activar cumplimiento CCPA (solo título) | no | https://help.workable.com/hc/en-us/articles/360041120973-Enabling-CCPA-compliance-features | page read (índice, solo título) |
| eeo-ofccp | Opciones EEO y OFCCP | Activar opciones (solo título) | no | https://help.workable.com/hc/en-us/articles/115011841267-Enabling-EEO-OFCCP-options | page read (índice, solo título) |
| eeo-survey | Encuesta EEO | Existe la pregunta de cómo la completa el candidato; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/360056592054-EEO-survey-how-will-candidates-complete-it | page read (índice, solo título) |
| candidate-photos | Fotos y redes del candidato | Gestionar fotos y perfiles sociales (solo título) | no | https://help.workable.com/hc/en-us/articles/115011872207-Managing-candidate-photos-and-social-media-profiles | page read (índice, solo título) |
| hide-hired | Ocultar datos de contratados | Ocultar detalles (solo título) | no | https://help.workable.com/hc/en-us/articles/115011999988-Hiding-hired-candidate-details | page read (índice, solo título) |
| certifications | Certificaciones | ISO 27001, 27017, SOC 2 Type II y SOC 3 | no | https://www.workable.com/features | page read |

## Plataforma (platform)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| ai-assist | Resúmenes de candidatos con AI | Resúmenes, puntaje y checklist de requisitos | yes | https://www.workable.com/features | page read |
| resume-parsing | Lectura automática de CV | Extrae y anonimiza para llenar campos | yes | https://www.workable.com/features | page read |
| ai-toggle | Activar o desactivar AI | Control de funciones AI (solo título) | no | https://help.workable.com/hc/en-us/articles/23685011706775-Enabling-and-disabling-AI-features | page read (índice, solo título) |
| automations | Automatizaciones | Plantillas con disparadores por postulación y etapa, tiempo configurable y condiciones | yes | https://help.workable.com/hc/en-us/articles/1500007691921-Setting-up-automated-actions | search snippet only |
| automation-sms | Texto automático | Solo si el candidato dio teléfono o consentimiento | no | https://help.workable.com/hc/en-us/articles/1500007691921-Setting-up-automated-actions | search snippet only |
| zapier | Zapier | Recetas de automatización | no | https://help.workable.com/hc/en-us/articles/360008107373-Zapier-automation-recipes | search snippet only |
| api | API | REST v3, tokens por admin con alcances y expiración | yes | https://help.workable.com/hc/en-us/articles/115015785428-Generating-revoking-access-tokens-for-Workable-s-API | search snippet only |
| api-webhooks | Webhooks | Eventos de candidatos y empleados, filtrables, firmados con HMAC SHA256 | yes | https://workable.readme.io/reference/webhook-subscriptions-candidates-employees | search snippet only |
| api-oauth | OAuth para socios | Tokens con vigencia y renovación | no | https://workable.readme.io/page/oauth | search snippet only |
| integrations | Integraciones | Más de 270 socios y herramientas | yes | https://www.workable.com/features | page read |
| hris-handoff | Traspaso a RR. HH. | Integraciones de RR. HH., por ejemplo Namely. Mecánica del traspaso no leída | yes | https://help.workable.com/hc/en-us/articles/115013350668-Integrating-with-Namely | search snippet only |
| assistant | Asistente AI | Workable Assistant de guía de RR. HH. Alcance sobre el pipeline no confirmado; artículo What can Ask Workable do? sin abrir | no | https://www.workable.com/features | page read |
| agent | Workable Agent | Corre búsqueda, contacto, screening e interacción en secuencia, con shortlist | no | https://www.workable.com/features | page read |
| agent-chat | Conversaciones del agente | Confirma interés y pide datos faltantes | no | https://www.workable.com/features | page read |
| agent-auto-disqualify | Descartes y avances del agente | Por criterios y umbrales de puntaje | no | https://help.workable.com/hc/en-us/articles/38381544828695-Using-the-Workable-Agent | search snippet only |
| agent-credits | Créditos AI | Consumo por evaluar, buscar y chatear; 3000 gratis por plan ATS | no | https://www.workable.com/pricing | page read |
| mobile-app | App móvil | iOS y Android | yes | https://www.workable.com/features | page read |
| custom-roles | Roles a medida | Ajustar roles por defecto con conjuntos de permisos | yes | https://www.workable.com/features | page read |
| preset-roles | Roles predefinidos | Recruiter, Hiring Manager, Contributor y Reviewer | yes | https://www.workable.com/features | page read |
| hiring-audit-log | Registro de auditoría | Cambios en roles, reportes y permisos; quién cambió qué en perfiles | yes | https://www.workable.com/features | page read |
| sso | SSO | Inicio de sesión único | yes | https://www.workable.com/features | page read |
| mfa | MFA o 2FA | Existe la pregunta en la ayuda; respuesta no leída | no | https://help.workable.com/hc/en-us/articles/26806767138455-Does-Workable-support-MFA-2FA | page read (índice, solo título) |
| smart-invites | Invitaciones por dominio | Invitar o unirse con email de la empresa | no | https://www.workable.com/features | page read |
| external-recruiters | Recruiters externos | Sección de miembros y externos; detalle no leído | no | https://help.workable.com/hc/en-us/sections/115003173887-Account-members-external-recruiters | page read (índice, solo título) |
| notification-preferences | Preferencias de avisos | Email, Slack y push (solo título) | yes | https://help.workable.com/hc/en-us/articles/115012023008-Managing-email-slack-and-push-notification-preferences | page read (índice, solo título) |
| interface-languages | Interfaz en varios idiomas | Nueve idiomas | yes | https://www.workable.com/pricing | page read |
| data-export | Exportar datos | Exportación de datos en todos los planes | yes | https://www.workable.com/pricing | page read |

## Filas nuevas

| id | área | English | Español | Português |
|---|---|---|---|---|
| job-duplicate | jobs | Duplicate a job | Duplicar vacante | Duplicar vaga |
| departments | jobs | Department hierarchy | Jerarquía de departamentos | Hierarquia de departamentos |
| job-on-hold | jobs | Put a job on hold | Poner una vacante en pausa | Pausar uma vaga |
| internal-jobs | jobs | Internal jobs | Vacantes internas | Vagas internas |
| confidential-zone | jobs | Confidential zone | Zona confidencial | Zona confidencial |
| requisition-approval-routing | jobs | Requisition approval routing | Aprobación de requisiciones por área | Roteamento de aprovação de requisições |
| requisition-reapproval | jobs | Re-approval on requisition edits | Reaprobación al editar | Reaprovação ao editar requisição |
| requisition-fields | jobs | Custom requisition fields | Campos propios de requisición | Campos próprios de requisição |
| requisition-bulk | jobs | Bulk requisitions | Requisiciones masivas | Requisições em massa |
| requisition-statuses | jobs | Requisition statuses | Estados de requisición | Status de requisição |
| hiring-plan-dashboard | jobs | Hiring plan dashboard | Tablero del plan de contratación | Painel do plano de contratação |
| multi-language-jobs | jobs | Multi-language jobs | Vacantes en varios idiomas | Vagas em vários idiomas |
| ai-interview-questions | jobs | AI interview questions | Preguntas de entrevista con AI | Perguntas de entrevista com AI |
| job-brief-agent | jobs | Job brief agent | Job Brief Agent | Agente de briefing da vaga |
| salary-estimator | jobs | Salary estimator | Estimador salarial | Estimador salarial |
| inclusive-job-tools | jobs | Inclusive job descriptions | Descripciones inclusivas | Descrições inclusivas |
| careers-editors | careers | Invite careers page editors | Editores invitados | Convidar editores da página de carreiras |
| careers-custom-domain | careers | Careers page on a custom domain | Dominio propio | Página de carreiras em domínio próprio |
| careers-api | careers | Careers page through the API | Página de empleos por API | Página de carreiras via API |
| careers-pixel | careers | Conversion tracking pixel | Píxel de conversión | Pixel de conversão |
| careers-analytics | careers | Google Analytics | Google Analytics | Google Analytics |
| application-reorder | careers | Reorder form fields | Reordenar campos del formulario | Reordenar campos do formulário |
| application-reuse | careers | Reuse a form on other jobs | Reutilizar un formulario | Reutilizar formulário |
| resume-autofill | careers | Autofill from resume | Autocompletar con CV | Preenchimento automático a partir do currículo |
| one-click-apply | careers | One-click apply | Postulación en un clic | Candidatura com um clique |
| apply-linkedin | careers | Apply with LinkedIn | Apply with LinkedIn | Candidatura com LinkedIn |
| indeed-easy-apply | careers | Indeed Easy Apply | Indeed Easy Apply | Indeed Easy Apply |
| jobs-by-workable | careers | Own job board | Jobs by Workable | Portal de vagas próprio |
| social-promotion | careers | Automated social promotion | Promoción en redes | Promoção automática em redes sociais |
| linkedin-rsc | careers | LinkedIn Recruiter System Connect | LinkedIn Recruiter System Connect | LinkedIn Recruiter System Connect |
| candidate-edit | candidates | Edit candidate profile | Editar el perfil | Editar perfil do candidato |
| utm-sources | candidates | Custom sources with UTM links | Orígenes propios con UTM | Origens próprias com UTM |
| ai-recommendations | candidates | AI candidate recommendations | Candidatos sugeridos por AI | Candidatos sugeridos por AI |
| talent-pool | candidates | Talent pool | Talent Pool | Banco de talentos |
| boolean-search | candidates | Boolean candidate search | Búsqueda booleana | Busca booleana de candidatos |
| resume-bulk-upload | candidates | Bulk resume upload | Subir CV en lote | Envio de currículos em lote |
| add-candidate-minimal | candidates | Add a candidate with name or email | Alta con nombre o email | Adicionar candidato com nome ou email |
| job-mailbox | candidates | Job mailbox | Casilla de la vacante | Caixa de email da vaga |
| candidate-attachments | candidates | Candidate attachments | Adjuntos en el perfil | Anexos do candidato |
| candidate-external-share | candidates | Share a profile outside the app | Compartir fuera de Workable | Compartilhar perfil fora do app |
| candidate-snooze | candidates | Snooze with a follow-up reminder | Posponer con recordatorio | Adiar com lembrete |
| reference-checks | candidates | Reference check notes | Referencias | Registro de referências |
| referrals-dashboard | candidates | Referral dashboard | Tablero de referidos | Painel de indicações |
| referrals-auto-join | candidates | Referral auto-join | Alta automática a referidos | Entrada automática em indicações |
| disqualify | pipeline | Disqualify candidates | Descalificar candidatos | Desqualificar candidatos |
| reporting-pipeline | pipeline | Reporting pipeline | Pipeline de reportes | Pipeline de relatórios |
| rating-scale | evaluation | Rating scale | Escala de evaluación | Escala de avaliação |
| interview-kit-sources | evaluation | Build a kit from several sources | Crear kit desde varias fuentes | Criar kit a partir de várias fontes |
| interview-kit-templates | evaluation | Interview kit templates | Plantillas de kits | Modelos de kits de entrevista |
| interview-kit-print | evaluation | Print an interview kit | Imprimir kit | Imprimir kit de entrevista |
| ai-screening | evaluation | AI candidate screening | Screening con AI | Triagem com AI |
| ai-match-score | evaluation | Explainable match score | Puntaje de ajuste explicable | Pontuação de aderência explicável |
| assessment-stage | evaluation | Assessment per stage | Test por etapa | Teste por etapa |
| internal-comments | evaluation | Internal comments | Comentarios internos | Comentários internos |
| comment-visibility | evaluation | Restrict comment visibility | Restringir visibilidad de comentarios | Restringir visibilidade de comentários |
| draft-autosave | evaluation | Draft autosave | Guardado de borradores | Salvamento de rascunhos |
| scheduling-buffers | interviews | Self-scheduling buffers | Márgenes en autoagenda | Intervalos no autoagendamento |
| interviewer-availability | interviews | Interviewer availability | Disponibilidad del entrevistador | Disponibilidade do entrevistador |
| candidate-event-reminders | interviews | Candidate event reminders | Recordatorios al candidato | Lembretes de eventos ao candidato |
| event-templates | interviews | Event description templates | Plantillas de eventos | Modelos de descrição de eventos |
| video-conferencing | interviews | Video conferencing | Videollamadas | Videoconferência |
| upcoming-interviews | interviews | Upcoming interviews view | Ver próximas entrevistas | Ver próximas entrevistas |
| video-interview-stage | interviews | One-way video per stage | Video por etapa | Vídeo por etapa |
| bulk-email | communication | Bulk email | Email masivo | Email em massa |
| scheduled-send | communication | Scheduled email or text | Envío programado | Envio agendado |
| private-email | communication | Private email or text | Email o texto privado | Email ou mensagem privada |
| email-signature | communication | Email signature | Firma de email | Assinatura de email |
| ai-email | communication | AI email drafts | Emails redactados con AI | Rascunhos de email com AI |
| offer-variables | offers | Custom offer variables | Variables propias en ofertas | Variáveis próprias em ofertas |
| offer-expiration | offers | Offer expiration | Vencimiento de oferta | Validade da oferta |
| simple-esign-templates | offers | Simple signature templates | Plantillas simples de firma | Modelos simples de assinatura |
| offer-template-access | offers | Limit offer template access | Limitar acceso a plantillas | Limitar acesso a modelos de oferta |
| offer-details-access | offers | Offer details access | Acceso a detalles de oferta | Acesso aos detalhes da oferta |
| hiring-velocity | reports | Hiring velocity report | Velocidad de contratación | Relatório de velocidade de contratação |
| job-details-report | reports | Job details report | Detalle de vacantes | Relatório de detalhes da vaga |
| offers-hires-report | reports | Offers and hires report | Ofertas y contrataciones | Relatório de ofertas e contratações |
| offer-details-report | reports | Offer details report | Detalle de ofertas | Relatório de detalhes da oferta |
| team-productivity | reports | Team productivity report | Productividad del equipo | Relatório de produtividade da equipe |
| hiring-plan-report | reports | Hiring plan report | Reporte del plan de contratación | Relatório do plano de contratação |
| ai-credit-report | reports | AI credit usage report | Uso de créditos AI | Relatório de uso de créditos de AI |
| report-filters | reports | Report filters by dimension | Filtros por dimensión | Filtros de relatório por dimensão |
| saved-reports | reports | Saved reports | Reportes guardados | Relatórios salvos |
| custom-dashboards | reports | Custom dashboards | Dashboards a medida | Painéis personalizados |
| report-exports | reports | Report exports | Exportar reportes | Exportar relatórios |
| report-sharing | reports | Report sharing | Compartir reportes | Compartilhar relatórios |
| governed-sharing | reports | Governed report sharing | Compartir gobernado | Compartilhamento governado |
| bi-link | reports | Business intelligence link | Enlace a BI | Conexão com BI |
| monthly-spotlight | reports | Monthly summary email | Email mensual Spotlight | Email de resumo mensal |
| gdpr-automation | privacy | GDPR automation | Automatización GDPR | Automação de GDPR |
| sourced-auto-delete | privacy | Auto-delete uncontacted sourced candidates | Borrado de candidatos buscados sin contacto | Excluir candidatos buscados sem contato |
| sourced-privacy-notice | privacy | Privacy notice for sourced candidates | Aviso de privacidad a buscados | Aviso de privacidade a candidatos buscados |
| ccpa | privacy | CCPA features | Funciones CCPA | Recursos de CCPA |
| eeo-ofccp | privacy | EEO and OFCCP options | Opciones EEO y OFCCP | Opções EEO e OFCCP |
| eeo-survey | privacy | EEO survey | Encuesta EEO | Pesquisa EEO |
| candidate-photos | privacy | Candidate photos and social profiles | Fotos y redes del candidato | Fotos e redes do candidato |
| hide-hired | privacy | Hide hired candidate details | Ocultar datos de contratados | Ocultar dados de contratados |
| certifications | privacy | Security certifications | Certificaciones | Certificações de segurança |
| resume-parsing | platform | Resume parsing | Lectura automática de CV | Leitura automática de currículos |
| ai-toggle | platform | Turn AI features on or off | Activar o desactivar AI | Ativar ou desativar AI |
| automation-sms | platform | Automated texts | Texto automático | Mensagens automáticas |
| zapier | platform | Zapier | Zapier | Zapier |
| api-webhooks | platform | Webhooks | Webhooks | Webhooks |
| api-oauth | platform | OAuth for partners | OAuth para socios | OAuth para parceiros |
| integrations | platform | Integrations marketplace | Integraciones | Marketplace de integrações |
| agent | platform | Autonomous recruiting agent | Workable Agent | Agente autônomo de recrutamento |
| agent-chat | platform | Agent conversations with candidates | Conversaciones del agente | Conversas do agente com candidatos |
| agent-auto-disqualify | platform | Agent disqualifies and advances | Descartes y avances del agente | Agente desqualifica e avança |
| agent-credits | platform | AI credits | Créditos AI | Créditos de AI |
| preset-roles | platform | Preset roles | Roles predefinidos | Funções predefinidas |
| sso | platform | Single sign-on | SSO | Login único |
| mfa | platform | Multi-factor sign-in | MFA o 2FA | Login com vários fatores |
| smart-invites | platform | Invites by company domain | Invitaciones por dominio | Convites por domínio da empresa |
| external-recruiters | platform | External recruiters | Recruiters externos | Recrutadores externos |
| notification-preferences | platform | Notification preferences | Preferencias de avisos | Preferências de notificações |
| interface-languages | platform | Multi-language interface | Interfaz en varios idiomas | Interface em vários idiomas |
| data-export | platform | Data export | Exportar datos | Exportação de dados |
