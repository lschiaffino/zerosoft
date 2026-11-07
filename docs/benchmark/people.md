# Benchmark de People: BambooHR

Fecha: 2026-11-02. Producto de referencia: BambooHR. Describe solo a BambooHR, sin juzgar nuestro producto.

## Cómo se leyó

- Páginas leídas: `bamboohr.com/platform` y sus páginas por módulo, `bamboohr.com/pricing`, `documentation.bamboohr.com` (Getting Started, referencia e índice `llms.txt`).
- Las lecturas pasaron por un modelo que resume cada página. "page read" significa que la página nombra la capacidad. Las páginas de marketing dan poco detalle.
- `help.bamboohr.com` se consultó con WebSearch filtrado por dominio. Devuelve extractos resumidos del artículo, por eso va como "search snippet only".
- Varias notas de ayuda son viejas, de 1 a 6 años según los resultados. Conviene confirmar menús y planes antes de citar el detalle.
- Se hicieron 42 lecturas de página entre los dos benchmarks. Una dio 404 y tres devolvieron una página vacía.

## Qué no se pudo leer

- `help.bamboohr.com` no entrega contenido a la lectura directa: portada y artículo devolvieron una pantalla de carga ("Sorry to interrupt", "CSS Error"), sin formulario de login visible. Ningún artículo de ayuda se leyó entero.
- `bamboohr.screenstepslive.com` no se abrió; las búsquedas no devolvieron nada de ese dominio.
- No se encontró la página oficial de novedades de producto. Rastreadores de terceros mencionan Global Employment Insights, Break Tracking y pruebas de drogas post contratación en 2026; quedan fuera de las filas por falta de fuente propia.
- El final de la referencia de API quedó sin leer: el índice se cortó en el grupo Time Off.
- La tabla de Pricing no deja claro en qué plan están Recognition, Rewards y On-Demand Pay.
- Buscado sin resultado: pestaña de activos, entrevista de salida, reportes a fecha pasada, edición masiva, importación por planilla, reportes programados. La búsqueda vacía no prueba que falten en el producto.

## Cómo leer las tablas

- id: el de `rows.txt` si la capacidad coincide, o uno nuevo en kebab-case. Las filas de `rows.txt` que juntaban varias capacidades conservan su id para la principal, y el resto sale como fila nueva.
- core: criterio de este documento, ajustable. yes si es función principal del módulo y la opera BambooHR, aunque el módulo se pague aparte. no si la da un socio, es legal de un país, es un servicio o es un detalle secundario. Toda fila unverified va como no, para que no entre al denominador sin prueba.
- `payroll`, `benefits` y `time-tracking` figuran en comp en `rows.txt`. Acá encabezan sus propios módulos, porque BambooHR los vende por separado.

## Totales

- Filas: 231 (145 core, 86 no core).
- Filas de `rows.txt` cubiertas: 62 de 62. Filas nuevas: 169.
- Evidencia: page read 174, search snippet only 52, unverified 5.

## Registros (records)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| profiles | Perfil de empleado | Registro central y seguro con datos de la persona, historial de puesto, beneficios y documentos | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| personal-data | Datos personales | Datos estándar de la persona en el registro, con acceso por rol. Campos concretos no revisados uno por uno | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| emergency-contacts | Contactos de emergencia | Pestaña Emergency con contactos; según la configuración, los cambios pueden requerir aprobación. Hoy dentro de personal-data | yes | https://help.bamboohr.com/hc/en-us/articles/227351107-Update-my-Emergency-Contacts | search snippet only |
| custom-fields | Campos personalizados | Crear campos propios para cualquier dato de empleado | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| custom-tabs | Pestañas personalizadas | Crear pestañas propias en el perfil | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| custom-tables | Tablas personalizadas | Crear tablas propias en el perfil; la API tiene el grupo Employee Tables | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| photo | Fotos de perfil | La API tiene endpoints para obtener y subir la foto del empleado | yes | https://documentation.bamboohr.com/llms.txt | page read |
| self-service | Autoservicio del empleado | La persona actualiza sus datos, pide tiempo libre y gestiona beneficios | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| change-approvals | Aprobación de cambios de perfil | Cada campo se edita directo o pasa por aprobación según el nivel de acceso; el aprobador ve valor anterior y nuevo, y el email oculta el dato nuevo | yes | https://help.bamboohr.com/hc/en-us/articles/227321928-Employee-Self-Service-Help-Manual | search snippet only |
| employee-history | Historial de puesto y estado | Historial de puesto dentro del registro. Detalle de columnas no leído | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| future-dated-changes | Cambios de puesto y pago con fecha futura | No se encontró documentación directa. Una guía de payroll solo menciona registros que terminan y empiezan dentro de un periodo | no | https://help.bamboohr.com/hc/en-us/articles/4403922697997-Run-Payroll?mobile_site=true | unverified |
| custom-approvals | Flujos de aprobación configurables | Rutas de aprobación automatizadas y configurables para tiempo libre, promociones y reconocimiento de políticas | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/ | page read |
| multi-level-approvals | Aprobaciones en varios niveles | Cadenas de hasta cinco niveles por rol o persona; se avisa al primero y un rechazo termina el proceso con aviso al solicitante | yes | https://help.bamboohr.com/s/article/1507116 | search snippet only |
| bulk-edit | Edición masiva | Sin evidencia en lo leído; la búsqueda dedicada no devolvió nada | no | sin fuente | unverified |
| employee-notes | Notas sobre el empleado | Pestaña Notes con todas las notas de la persona, en web y móvil | no | https://help.bamboohr.com/hc/en-us/articles/360036867893-Employee-Information-in-the-Mobile-App | search snippet only |
| training-tracking | Seguimiento de capacitaciones | Categorías y cursos en Settings, pestaña Training con completados, fechas vencidas marcadas y reportes personalizados | yes | https://help.bamboohr.com/s/article/587747 | search snippet only |
| termination-tracking | Registro de terminaciones | Fecha, tipo voluntario o involuntario y marca de renuncia lamentable o no | yes | https://help.bamboohr.com/s/article/691371 | search snippet only |
| rehire | Recontratación | Al recontratar se limpia la fecha de pago final, vuelve a payroll y se retoma la sincronización. Solo documentado desde payroll | no | https://help.bamboohr.com/s/article/1427192 | search snippet only |
| data-hygiene | Widget de higiene de datos (beta) | Solo se conoce el título del artículo; no se leyó qué hace | no | https://help.bamboohr.com/s/article/2121060 | search snippet only |

## Organización (org)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| directory | Directorio con búsqueda y filtros | Búsqueda por departamento, ubicación o equipo, con filtros | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| directory-timezones | Hora local en el directorio | Vista de zona horaria local en directorio y organigrama | no | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| directory-export | Exportar directorio | Descarga o exportación desde directorio y organigrama | no | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| org-chart | Organigrama | Muestra la estructura de la empresa | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| directory-visibility | Visibilidad del directorio | El administrador habilita las vistas y define qué campos se pueden mostrar | yes | https://help.bamboohr.com/hc/en-us/articles/216836007-View-the-Company-Directory-and-Organizational-Chart?mobile_site=true | search snippet only |
| ooo-in-directory | Ausencia visible en el directorio | La persona ausente aparece en gris en el directorio | no | https://help.bamboohr.com/hc/en-us/articles/216836007-View-the-Company-Directory-and-Organizational-Chart?mobile_site=true | search snippet only |
| celebrations | Cumpleaños y aniversarios | Widget Celebrations en Home y aviso al manager el día anterior y el mismo día, sujeto al nivel de acceso | yes | https://help.bamboohr.com/s/article/888143 | search snippet only |
| birthday-opt-out | Ocultar el propio cumpleaños | Cada persona decide si comparte su cumpleaños; el admin no puede cambiarlo por ella | no | https://help.bamboohr.com/s/article/888143 | search snippet only |

## Tiempo libre (timeoff)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| pto-policies | Políticas de tiempo libre por tipo | Políticas personalizadas sin límite de cantidad para full-time, part-time, por hora o asalariados | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| pto-policy-scope | Políticas por segmento o persona | Políticas para toda la empresa o personas, con opciones por ubicación, departamento o licencias especiales | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| leave-types | Tipos de licencia | Vacaciones, enfermedad, PTO, feriados, parental y duelo | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| flexible-policies | Políticas flexibles o ilimitadas | También llamadas YTD o sin tope: registran lo usado sin saldo restante | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| manual-policies | Políticas de actualización manual | El admin ajusta el saldo a mano; sirven para licencias por evento | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| accrual | Reglas de acumulación | Acumulación automática anual, mensual, quincenal o dos veces al mes | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| accrual-front-load | Asignación anticipada anual | Adelantar el total del año con una política de acumulación y un tope de arrastre | no | https://help.bamboohr.com/s/article/645671 | search snippet only |
| tenure-milestones | Hitos de antigüedad | Sube la acumulación con la antigüedad sin crear otra política. Hoy dentro de accrual | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| carryover | Arrastre al año siguiente | Opcional, con tope configurable. Hoy dentro de accrual | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| balance-cap | Tope de saldo | La acumulación se detiene al llegar a un saldo máximo (ejemplo de 160 horas en la ayuda). Hoy dentro de accrual | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| pto-requests | Pedidos y aprobaciones | La persona pide y el manager aprueba | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| pto-cancel | Editar o cancelar un pedido | Existe un artículo Update or Cancel a Time Off Request; cuerpo no leído | yes | https://help.bamboohr.com/s/article/532543 | search snippet only |
| half-days | Horas o días por tipo | Cada tipo se registra en horas o en días; el pedido propone las horas estándar del día o un día. Medios días como opción propia no confirmados | yes | https://help.bamboohr.com/hc/en-us/articles/360052355912-Request-Time-Off?mobile_site=true | search snippet only |
| holidays | Feriados | Feriados de la empresa; un pedido sobre feriado cuenta 0 ese día | yes | https://help.bamboohr.com/hc/en-us/articles/360052355912-Request-Time-Off?mobile_site=true | search snippet only |
| holidays-by-location | Feriados por ubicación | Calendarios de feriados específicos para cada ubicación | yes | https://www.bamboohr.com/platform/global-employment/ | page read |
| special-leave | Licencias especiales regionales | Time in lieu, comp time y long service leave | no | https://www.bamboohr.com/platform/global-employment/ | page read |
| whos-out | Calendario Who's Out | Quién está fuera hoy y quién tiene ausencias próximas | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| pto-calendar | Calendario de ausencias | Calendario con tiempo libre programado para planificar | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| balances-history | Saldos e historial | Saldos en autoservicio e historial con vista Earned/Used y Requests | yes | https://help.bamboohr.com/hc/en-us/articles/360042483074-Viewing-Time-Off-History | search snippet only |
| balance-adjustments | Ajustes manuales de saldo | Ajuste a mano en políticas manuales; las flexibles no admiten saldo agregado. Hoy dentro de balances-history | yes | https://help.bamboohr.com/s/article/645671 | search snippet only |
| accrual-calculator | Calculadora de saldo futuro | La persona consulta su saldo y acumulación | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| calendar-sync | Calendario externo | Solo se vio el título de un artículo, Create an iCalendar Feed, y su mención en la configuración de cumpleaños. Bloqueo de agenda no confirmado | no | https://help.bamboohr.com/s/article/788839 | search snippet only |
| pto-notifications | Avisos de tiempo libre | Alertas por app y email | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| pto-mobile | Tiempo libre en la app móvil | Pedir, revisar y calcular saldos desde el móvil | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/mobile-app | page read |
| pto-payroll-sync | Sincronización de ausencias con payroll | PTO, enfermedad y feriados pasan a BambooHR Payroll | no | https://www.bamboohr.com/platform/time-and-attendance/ | page read |

## Onboarding y offboarding (onboarding)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| onboarding-templates | Listas de onboarding desde plantillas | Plantillas y listas de tareas por rol y modo de trabajo, con responsabilidades por equipo interno | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| onboarding-custom-tasks | Tareas de onboarding propias | Crear tareas más allá de las plantillas | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| welcome | Bienvenida al ingreso | Email Get to Know You que destaca intereses comunes con el equipo | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| first-day-details | Datos del primer día | Compartir cuándo y dónde presentarse | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| preboarding | Pre-onboarding antes del primer día | Paquetes para completar pasos antes del ingreso, a su ritmo | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| new-hire-packet | Paquete de ingreso (New Hire Packet) | Tareas y documentos a firmar; se puede enviar antes del ingreso y hasta 14 días después | yes | https://help.bamboohr.com/s/article/588009 | search snippet only |
| self-onboarding | Auto-onboarding | Formulario prellenado con datos del ATS y email al ingresante para firmar | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| ats-prefill | Prellenado desde el ATS | Usa datos del candidato para reducir carga manual y empuja al registro de empleado | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| onboarding-reminders | Recordatorios de onboarding | Asigna tareas y envía recordatorios | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| onboarding-progress | Tablero de avance | Barra de avance y listas para confirmar que todo está listo | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| i9-everify | Flujos I-9 y E-Verify | Vía Mitratech, con envío de formularios y detección temprana de problemas (Estados Unidos) | no | https://www.bamboohr.com/platform/onboarding/ | page read |
| onboarding-background-checks | Verificación de antecedentes | Listada en la página sin detalle; socios como Checkr y Turn | no | https://www.bamboohr.com/platform/onboarding/ | page read |
| offboarding | Offboarding | Listas de tareas, seguimiento de avance y manejo consistente de pasos clave | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| exit-interview | Entrevista de salida | Sin evidencia en lo leído; la búsqueda dedicada solo devolvió encuestas de satisfacción y bienestar | no | sin fuente | unverified |

## Documentos (documents)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| documents | Documentos del empleado | Pestaña Documents con archivos individuales en cada perfil | yes | https://help.bamboohr.com/s/article/587287 | search snippet only |
| document-folders | Carpetas de documentos | Carpetas y subcarpetas; se agregan para todos los empleados | yes | https://help.bamboohr.com/s/article/587287 | search snippet only |
| company-files | Archivos de la empresa | Pestaña Files para manual y políticas de toda la empresa | yes | https://help.bamboohr.com/s/article/587287 | search snippet only |
| file-sharing | Compartir o hacer privado un archivo | Compartir con una persona o grupo, o dejarlo solo para Full Admin | yes | https://help.bamboohr.com/s/article/587287 | search snippet only |
| employee-document-upload | Subida de documentos por el empleado | Existe el artículo Employee Document Upload; cuerpo no leído | yes | https://help.bamboohr.com/s/article/640097 | search snippet only |
| policy-ack | Reconocimiento de políticas | Rutas de aprobación que incluyen el reconocimiento de políticas. Detalle no leído | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/ | page read |
| esign | Firma electrónica | Incluida desde el plan Core | yes | https://www.bamboohr.com/pricing/ | page read |
| esign-templates | Plantillas de firma | Plantilla con campos y carpeta destino en el perfil | yes | https://help.bamboohr.com/s/article/557531 | search snippet only |
| esign-reminders | Reporte y recordatorios de firmas | Reporte Signed Documents con envío de recordatorios | yes | https://help.bamboohr.com/s/article/557531 | search snippet only |
| document-status-report | Estado de documentos de ingreso | Reporte de firmados y pendientes | yes | https://www.bamboohr.com/platform/onboarding/ | page read |
| tax-documents | Documentos impositivos | Gestión de documentos impositivos dentro del registro | no | https://www.bamboohr.com/platform/hr-data-and-reporting/ | page read |

## Desempeño y experiencia (performance)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| review-cycles | Ciclos de revisión | Revisiones prediseñadas o ciclos propios (360 desde Pro) | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| review-self | Autoevaluación | Aviso 30 días antes del cierre, con guardado de avance | yes | https://help.bamboohr.com/hc/en-us/articles/360023623014-Complete-the-Self-Assessment-as-an-Employee | search snippet only |
| review-manager | Evaluación del manager | Manager a empleado, parte del 360 | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| review-skip-level | Evaluación de skip-level | Parte del 360 | no | https://www.bamboohr.com/platform/performance-management/ | page read |
| review-segmentation | Segmentar revisiones | Correr y ver revisiones por departamento, ubicación, puesto y más | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| review-reminders | Recordatorios de revisión | Emails automáticos a quienes no terminaron | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| review-notifications | Avisos de revisión completa | Alerta cuando se completa una revisión | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| review-scheduling | Programar revisiones | Agendar revisiones dentro del producto | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| peer-picking | Pedido de feedback de pares | El manager lo pide; el par tiene 14 días, recordatorio previo y dos preguntas fijas; solo manager y Full Admin ven las respuestas | yes | https://help.bamboohr.com/hc/en-us/articles/360023789493-Give-Peer-Feedback | search snippet only |
| goals | Objetivos con avance | Crear, seguir y compartir objetivos individuales y de equipo, en web y móvil | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| goals-cascading | Objetivos en cascada | Privados o públicos ligados a objetivos de la empresa | yes | https://help.bamboohr.com/s/article/588034 | search snippet only |
| goals-milestones | Hitos y adjuntos en objetivos | Fechas, hitos y archivos | yes | https://help.bamboohr.com/s/article/588034 | search snippet only |
| goals-ai | Objetivos sugeridos por AI | Sugerencias SMART a partir de notas de 1:1, evaluaciones, puesto y feedback | no | https://help.bamboohr.com/s/article/588034 | search snippet only |
| goals-report | Reporte de estado de objetivos | Requiere Goals activo; planes Pro y Elite | yes | https://help.bamboohr.com/s/article/984999 | search snippet only |
| one-on-ones | Reuniones 1:1 | Reuniones periódicas dentro de BambooHR. Sin datos sobre privacidad de las notas | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| one-on-one-scheduling | Agendar 1:1 | Programar reuniones uno a uno | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| performance-report | Reportes de desempeño | Datos por empresa y persona para ver destacados y quién necesita apoyo | yes | https://www.bamboohr.com/platform/performance-management/ | page read |
| growth-paths | Trayectorias de crecimiento | Solo nombradas en la página | no | https://www.bamboohr.com/platform/performance-management/ | page read |
| surveys | Encuesta de satisfacción (eNPS) | Medir satisfacción con Employee Net Promoter Score | yes | https://www.bamboohr.com/platform/employee-experience/ | page read |
| enps-trend | Evolución del eNPS | Seguir el puntaje en el tiempo | yes | https://www.bamboohr.com/platform/employee-experience/ | page read |
| wellbeing-survey | Encuesta de bienestar | Preguntas validadas, puntaje 0 a 5 en cuatro dimensiones | yes | https://www.bamboohr.com/platform/employee-experience/ | page read |
| wellbeing-heatmap | Mapa de calor de bienestar | Reporte para ver dónde actuar | no | https://www.bamboohr.com/platform/employee-experience/ | page read |
| feedback-ai-summary | Resúmenes con AI del feedback | Temas de respuestas eNPS, hallazgos y próximos pasos | yes | https://www.bamboohr.com/platform/employee-experience/ | page read |
| recognition-rewards | Reconocimiento entre pares | Feed público para agradecer y celebrar | yes | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |
| recognition-values | Reconocimiento por valores | Vincula el reconocimiento a los valores de la empresa | no | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |
| recognition-private | Reconocimiento público o privado | Quien envía elige la visibilidad | no | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |
| recognition-ai | Ayuda de AI para reconocer | Recordatorios, sugerencias y refinar el mensaje | no | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |
| recognition-history | Historial de reconocimientos | Lo dado y recibido por cada persona | no | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |
| rewards-points | Recompensas por puntos | Sistema de puntos | yes | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |
| rewards-catalog | Catálogo de recompensas | Más de 2000 gift cards y donaciones en más de 200 países | no | https://www.bamboohr.com/platform/recognition-and-rewards/ | page read |

## Compensación (comp)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| comp-history | Historial de compensación | Solo visto como grupo Compensation en la API; en la ayuda no se encontró artículo específico | yes | https://documentation.bamboohr.com/llms.txt | page read |
| payroll-export | Exportación para payroll | Exportar horas para un payroll ajeno. No se encontró un export general de salarios | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| payroll-sync | Sincronización con payroll | Registros, PTO, cambios de ubicación y beneficios | no | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| levels-bands | Niveles y bandas | Niveles, rangos salariales y trayectorias; plan Elite | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| salary-benchmarking | Benchmark salarial | Datos de mercado de Mercer integrados; plan Elite | no | https://www.bamboohr.com/platform/compensation/ | page read |
| pay-visualization | Visualización de pagos | Listada en plan Elite, sin detalle | no | https://www.bamboohr.com/pricing/ | page read |
| comp-planning | Ciclos de compensación | Proceso estructurado y creación de ciclos; plan Elite | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| comp-budget | Presupuesto de revisión salarial | Presupuestos dentro del ciclo | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| comp-worksheets | Planillas de compensación | Worksheets para trabajar la revisión | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| comp-permissions | Permisos del ciclo | Quién accede y actúa sobre tareas de compensación | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| comp-currency | Conversión de moneda | Conversión automática para equipos globales | no | https://www.bamboohr.com/platform/compensation/ | page read |
| comp-approvals | Aprobación de cambios salariales | Pasos de aprobación antes de cerrar | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| comp-communications | Comunicación de cambios salariales | Comunicar el cambio a cada persona, con avisos | yes | https://www.bamboohr.com/platform/compensation/ | page read |
| total-rewards | Recompensas totales | Salario, beneficios y extras en un lugar; estados generados desde el HRIS | yes | https://www.bamboohr.com/platform/compensation/ | page read |

## Payroll (payroll)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| payroll | Procesamiento de payroll | Módulo adicional, solo empleados de Estados Unidos, sin límite de corridas | yes | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-tax-filing | Presentación de impuestos | Federales, estatales y locales | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-direct-deposit | Depósito directo | Pago por depósito directo | yes | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-w2 | Formularios W-2 | Generación de W-2 | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-paystubs | Recibos de sueldo | Ver y descargar en cualquier dispositivo | yes | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-self-service | Datos fiscales y bancarios en autoservicio | Actualizar retenciones y depósito directo | yes | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-multi-rate | Varias tarifas | Tarifas por proyecto y tipos de clasificación | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-prorate | Pagos prorrateados | Pagos de periodo parcial | yes | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-garnishment | Embargos salariales | Procesa embargos | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-managed | Payroll gestionado | Un especialista ejecuta y el cliente aprueba | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-reminders | Recordatorios de payroll | Avisos y borradores de ítems para aceptar, editar o descartar | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-anomalies | Detección de anomalías | Marca saltos de horas extra o deducciones atípicas | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-run-compare | Comparar corridas | Compara con la corrida anterior antes de cerrar | no | https://www.bamboohr.com/platform/payroll/ | page read |
| payroll-audit | Auditoría de payroll | Historial de actividad de payroll | yes | https://www.bamboohr.com/platform/payroll/ | page read |
| accounting-sync | Sincronización contable | QuickBooks Online, Xero, NetSuite y Sage Intacct | no | https://www.bamboohr.com/platform/payroll/ | page read |
| journal-entries | Asientos contables | Creador de asientos según el plan de cuentas | no | https://www.bamboohr.com/platform/payroll/ | page read |
| employment-verification | Verificación de empleo e ingresos | Vía The Work Number de Equifax | no | https://www.bamboohr.com/platform/payroll/ | page read |
| on-demand-pay | Pago a demanda | Salario ganado antes del día de pago, con Clair; también con payroll ajeno | no | https://www.bamboohr.com/platform/employee-experience/ | page read |

## Registro de horas (time)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| time-tracking | Registro de horas y hojas de horas | Módulo adicional: la persona registra horas y las edita | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| clock-in | Marcar entrada y salida | Varios métodos, desde cualquier lugar, en web y móvil | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| time-geolocation | Geolocalización | Registros con datos de ubicación | no | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| time-kiosk | Kiosco y relojes | Kiosco en iPad y relojes de marcación | no | https://www.bamboohr.com/pricing/ | page read |
| time-projects | Horas por proyecto | Asignar tiempo a proyectos; el plan menciona horas facturables | no | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| timesheet-approvals | Aprobación de hojas de horas | Flujos automáticos y revisión del manager | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| timesheet-reminders | Recordatorios de horas | Avisos a empleados y managers | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| timesheet-corrections | Correcciones de horas | Enviar correcciones desde el móvil | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/mobile-app | page read |
| overtime | Cálculo de horas extra | Automático para los 50 estados de EE. UU. | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| overtime-custom | Reglas de horas extra propias | Definir políticas por organización y región | no | https://www.bamboohr.com/platform/global-employment/ | page read |
| shift-differentials | Diferenciales por turno | Ajustes de pago para ciertos turnos | no | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| shift-scheduling | Programación de turnos | Listada en el módulo Time & Attendance | yes | https://www.bamboohr.com/pricing/ | page read |
| breaks | Pausas de comida y descanso | Listadas en el módulo; la API tiene el subgrupo Meal & Rest Breaks | no | https://www.bamboohr.com/pricing/ | page read |
| manager-team-view | Vista de equipo del manager | Existe el artículo Manager Team View in BambooHR Time & Attendance; cuerpo no leído | no | https://help.bamboohr.com/s/article/2125211 | search snippet only |
| timesheet-export | Exportar hojas de horas | Para un payroll que no sea BambooHR | yes | https://www.bamboohr.com/platform/time-and-attendance/ | page read |
| time-payroll-sync | Horas a BambooHR Payroll | Sincronización automática | no | https://www.bamboohr.com/platform/time-and-attendance/ | page read |

## Beneficios (benefits)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| benefits | Administración de beneficios | Módulo adicional, solo Estados Unidos: planes, elecciones y datos en un lugar | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-tracking | Registro de beneficios | Seguimiento y resumen de elecciones, en planes base | yes | https://www.bamboohr.com/pricing/ | page read |
| benefits-config | Configuración guiada | Configurar beneficios con pasos guiados | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-self-enrollment | Autoinscripción | La persona elige y queda en su perfil; también en móvil | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-open-enrollment | Inscripción abierta | Definir ventanas anuales | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-new-hire | Elecciones de nuevos ingresos | Manejo automático al ingreso | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-life-events | Eventos de vida | Actualizar cambios como estado civil o domicilio | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/mobile-app | page read |
| benefits-approval | Revisión y aprobación de elecciones | Listada en el módulo | yes | https://www.bamboohr.com/pricing/ | page read |
| benefits-plan-types | Tipos de plan | Médico, dental, visión, retiro, vida, HSA, FSA, discapacidad | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-carriers | Conexión con aseguradoras | Envío automático; solo proveedores nacionales seleccionados | no | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-broker | Acceso para corredores | Acceso directo o exportación | no | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-export | Exportar inscripciones | Formulario de aseguradora o CSV | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-deductions | Deducciones a payroll | Sincronización sin doble carga | no | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-notifications | Avisos de beneficios | Notificaciones automáticas | yes | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| benefits-esign | Firma en inscripción | Firmas en documentos de inscripción | no | https://www.bamboohr.com/platform/benefits-administration/ | page read |
| retirement-401k | Plan 401(k) integrado | Con Human Interest; datos fluyen entre sistemas | no | https://www.bamboohr.com/platform/benefits-administration/ | page read |

## Reportes (reports)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| reports | Reportes estándar | Pestaña Standard Reports con reportes propios de BambooHR. Cobertura exacta de headcount y antigüedad no leída | yes | https://help.bamboohr.com/s/article/1681943 | search snippet only |
| turnover-report | Reporte de rotación | Tendencias, filtros por fecha, manager y tipo, voluntaria o no, lamentable o no | yes | https://help.bamboohr.com/s/article/691371 | search snippet only |
| time-off-report | Reporte de ausencias | Uso de PTO, posible desgaste y efectividad | yes | https://www.bamboohr.com/platform/time-and-attendance/time-off | page read |
| custom-reports | Generador de reportes | Incluido desde el plan Core | yes | https://www.bamboohr.com/pricing/ | page read |
| report-organize | Favoritos y carpetas de reportes | Favoritos, carpetas y pestaña de recientes | no | https://help.bamboohr.com/s/article/1681943 | search snippet only |
| report-sharing | Compartir reportes | Con otros usuarios | yes | https://help.bamboohr.com/s/article/1681943 | search snippet only |
| instant-reporting | Reportes instantáneos | Listado desde Pro, sin detalle | no | https://www.bamboohr.com/pricing/ | page read |
| compliance-reporting | Reportes de cumplimiento | Reportes para auditorías y presentaciones oficiales | no | https://www.bamboohr.com/platform/hr-data-and-reporting/ | page read |
| point-in-time-report | Reportes a una fecha pasada | Sin evidencia en lo leído; la búsqueda dedicada no devolvió nada | no | sin fuente | unverified |
| custom-dashboards | Dashboards a medida | Combinar visualizaciones sobre datos vivos, en plan Elite | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |
| dashboard-templates | Plantillas de dashboards | Dashboards listos para áreas comunes | no | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |
| dashboard-charts | Tipos de gráfico | Varios formatos con arrastrar y soltar | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |
| dashboard-formulas | Fórmulas propias | Cálculos con sintaxis tipo Excel | no | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |
| dashboard-sharing | Compartir dashboards con permisos | Acceso a medida por permisos | no | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |
| dashboard-export | Exportar dashboards | PDF, PNG o Excel | no | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |
| hr-benchmarks | Benchmarks de RR. HH. | Grupos de pares por AI o elegidos por industria, tamaño o lugar | no | https://www.bamboohr.com/platform/hr-data-and-reporting/custom-dashboards-and-analytics | page read |

## Seguridad (security)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| roles | Roles y niveles de acceso | Controla qué roles ven o editan cada dato | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| custom-access-levels | Niveles de acceso a medida | Creación de niveles propios; se asignan varios a una persona | yes | https://help.bamboohr.com/s/topic/0TO4z000000SnFdGAK/creating-access-levels | search snippet only |
| audit | Reporte de auditoría | Audit trail reporting de cambios | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| mfa | Login en dos pasos | App autenticadora y códigos de respaldo; obligatorio para Payroll si no hay SSO | yes | https://help.bamboohr.com/s/article/1328496 | search snippet only |
| passkeys | Passkeys | Algunas cuentas tienen la opción | no | https://help.bamboohr.com/s/article/1328496 | search snippet only |
| sso-saml | SSO con SAML | SAML de terceros instalado por Full Admin; deshabilita el login en dos pasos | yes | https://help.bamboohr.com/hc/en-us/articles/224726367-Third-Party-SAML | search snippet only |
| sso-google | SSO con Google | Existe el artículo Google Single Sign-On; cuerpo no leído | no | https://help.bamboohr.com/hc/en-us/articles/216836097-Google-Single-Sign-On | search snippet only |
| security-certs | Auditorías y prácticas de seguridad | SOC I y II, pruebas de penetración, bug bounty, monitoreo | no | https://www.bamboohr.com/platform/ | page read |
| data-residency | Centros de datos regionales | Estados Unidos, Canadá e Irlanda | no | https://www.bamboohr.com/platform/global-employment/ | page read |

## Plataforma (platform)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| api | API | REST para leer y modificar datos y generar reportes | yes | https://documentation.bamboohr.com/docs/getting-started | page read |
| api-oauth | OAuth y API key | OAuth para apps de varios clientes y API key para una cuenta | yes | https://documentation.bamboohr.com/docs/getting-started | page read |
| api-sdks | SDK oficiales | Sección Official SDKs en la documentación | no | https://documentation.bamboohr.com/llms.txt | page read |
| webhooks-global | Webhooks globales | Configurados por admin en Settings sobre campos predefinidos | yes | https://documentation.bamboohr.com/docs/global-webhooks | search snippet only |
| webhooks-permissioned | Webhooks por permiso | Creados por API, atados al acceso del creador; firma HMAC-SHA256 | yes | https://documentation.bamboohr.com/docs/permissioned-webhooks | search snippet only |
| webhooks-events | Webhooks por evento | employee.created, employee.updated y employee.deleted | yes | https://documentation.bamboohr.com/docs/event-based-webhooks | search snippet only |
| automations | Automatizaciones en eventos de RR. HH. | Flujos agénticos que completan tareas de rutina y derivan a una persona cuando hace falta criterio | yes | https://www.bamboohr.com/platform/ai | page read |
| assistant | Asistente AI (Ask BambooHR) | Responde con datos de BambooHR y citas; versiones por plan | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/mobile-app | page read |
| assistant-policies | Asistente sobre políticas | Responde solo con documentos elegidos por admins; desde Pro | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/ | page read |
| ai-analytics | Análisis en lenguaje natural | Preguntas, gráficos, reportes y preguntas sugeridas | yes | https://www.bamboohr.com/platform/ai | page read |
| ai-risk | Riesgos detectados por AI | Desgaste, rotación, anomalías de ausencias e inconsistencias de desempeño | no | https://www.bamboohr.com/platform/ai | page read |
| ai-external | Conexión con otras AI | Claude, ChatGPT y Slack (aprobar, recordar, preguntar quién falta) | no | https://www.bamboohr.com/platform/ai | page read |
| ai-governance | Gobierno de AI | Registros, reglas de aprobación humana y trazabilidad | no | https://www.bamboohr.com/platform/ai | page read |
| import | Importación desde planilla u otro HRIS | Sin evidencia de autoservicio en lo leído; el plan Elite menciona servicios de integridad de datos | no | sin fuente | unverified |
| mobile | App móvil | App con tareas, aprobaciones, firmas, horas, beneficios y desempeño; login SSO, MFA o QR | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/mobile-app | page read |
| mobile-push | Notificaciones push | Avisos en móvil y encuestas eNPS | no | https://www.bamboohr.com/platform/hr-data-and-reporting/mobile-app | page read |
| ats | Reclutamiento (ATS) | Incluido con tope de vacantes por plan: 5, 25 y 50 | yes | https://www.bamboohr.com/pricing/ | page read |
| home-inbox | Inicio y bandeja de tareas | Home con accesos, tareas y pedidos; bandeja en móvil | yes | https://www.bamboohr.com/platform/hr-data-and-reporting/employee-records | page read |
| company-community | Anuncios de la empresa | Noticias centralizadas, desde Pro | yes | https://www.bamboohr.com/platform/employee-experience/ | page read |
| community-read-receipts | Confirmación de lectura | Confirma que se vio el mensaje | no | https://www.bamboohr.com/platform/employee-experience/ | page read |
| community-groups | Grupos internos | Por departamento, equipo, tema o interés | no | https://www.bamboohr.com/platform/employee-experience/ | page read |
| community-scheduling | Publicaciones programadas | Publicar a una hora elegida | no | https://www.bamboohr.com/platform/employee-experience/ | page read |
| integrations | Marketplace de integraciones | Más de 150 integraciones prearmadas | yes | https://www.bamboohr.com/platform/ | page read |
| multi-language | Interfaz en varios idiomas | Ocho idiomas | yes | https://www.bamboohr.com/platform/global-employment/ | page read |

## Cumplimiento (compliance)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| compliance-intelligence | Alertas legales (VirgilHR) | Avisos y guía legal por estado de EE. UU. en todos los planes | no | https://www.bamboohr.com/platform/compliance/ | page read |
| compliance-training | Capacitación obligatoria (EasyLlama) | Cursos con asignación, recordatorios y avance | no | https://www.bamboohr.com/platform/compliance/ | page read |
| handbook-templates | Plantillas de manual | Crear y mantener manuales del empleado | no | https://www.bamboohr.com/platform/compliance/ | page read |
| aca-reporting | Reporte ACA (Lumelight) | Formularios 1094 y 1095 | no | https://www.bamboohr.com/platform/compliance/ | page read |
| hr-consulting | Consultoría de RR. HH. | Coaching, capacitación y experto dedicado | no | https://www.bamboohr.com/platform/compliance/ | page read |

## Empleo global (global)

| id | capacidad | qué hace | core | fuente | evidencia |
|---|---|---|---|---|---|
| global-eor | Empleador de registro | EOR con Remote en más de 90 países | no | https://www.bamboohr.com/platform/global-employment/ | page read |
| global-contractors | Gestión de contratistas | Contratos, riesgo y pagos en más de 200 países | no | https://www.bamboohr.com/platform/global-employment/ | page read |
| global-payroll-bridge | Conexión con payroll local | Conecta con proveedores regionales de payroll | no | https://www.bamboohr.com/platform/global-employment/ | page read |
| global-cost-calculator | Calculadora de costo global | Incluida en el módulo Global Employment | no | https://www.bamboohr.com/pricing/ | page read |
| global-regional-settings | Ajustes regionales | Políticas, feriados y formato de fecha por región | yes | https://www.bamboohr.com/platform/global-employment/ | page read |
| global-data-formats | Formatos locales de datos | Moneda, teléfono y tipos de documento por región | yes | https://www.bamboohr.com/platform/global-employment/ | page read |

## Filas nuevas

| id | área | English | Español | Português |
|---|---|---|---|---|
| emergency-contacts | records | Emergency contacts | Contactos de emergencia | Contatos de emergência |
| custom-tabs | records | Custom profile tabs | Pestañas personalizadas | Abas personalizadas no perfil |
| custom-tables | records | Custom tables with rows | Tablas personalizadas | Tabelas personalizadas com linhas |
| multi-level-approvals | records | Multi-level approvals | Aprobaciones en varios niveles | Aprovações em vários níveis |
| employee-notes | records | Employee notes | Notas sobre el empleado | Notas sobre o colaborador |
| training-tracking | records | Training tracking | Seguimiento de capacitaciones | Acompanhamento de treinamentos |
| termination-tracking | records | Termination records | Registro de terminaciones | Registro de desligamentos |
| rehire | records | Rehire | Recontratación | Recontratação |
| data-hygiene | records | Data hygiene widget | Widget de higiene de datos (beta) | Widget de qualidade dos dados |
| directory-timezones | org | Local time zones in the directory | Hora local en el directorio | Fuso horário local no diretório |
| directory-export | org | Directory export | Exportar directorio | Exportar diretório |
| ooo-in-directory | org | Out of office shown in the directory | Ausencia visible en el directorio | Ausência visível no diretório |
| birthday-opt-out | org | Hide your own birthday | Ocultar el propio cumpleaños | Ocultar o próprio aniversário |
| pto-policy-scope | timeoff | Policies per segment or person | Políticas por segmento o persona | Políticas por segmento ou pessoa |
| leave-types | timeoff | Leave types | Tipos de licencia | Tipos de licença |
| flexible-policies | timeoff | Flexible or unlimited policies | Políticas flexibles o ilimitadas | Políticas flexíveis ou ilimitadas |
| manual-policies | timeoff | Manually updated policies | Políticas de actualización manual | Políticas com atualização manual |
| accrual-front-load | timeoff | Front-loaded annual allotment | Asignación anticipada anual | Concessão anual antecipada |
| tenure-milestones | timeoff | Tenure milestones | Hitos de antigüedad | Marcos de tempo de casa |
| carryover | timeoff | Carryover | Arrastre al año siguiente | Saldo transferido para o ano seguinte |
| balance-cap | timeoff | Balance cap | Tope de saldo | Limite de saldo |
| pto-cancel | timeoff | Edit or cancel a request | Editar o cancelar un pedido | Editar ou cancelar um pedido |
| holidays-by-location | timeoff | Holidays per location | Feriados por ubicación | Feriados por local |
| special-leave | timeoff | Regional leave types | Licencias especiales regionales | Licenças regionais especiais |
| pto-calendar | timeoff | Time off calendar | Calendario de ausencias | Calendário de ausências |
| balance-adjustments | timeoff | Manual balance adjustments | Ajustes manuales de saldo | Ajustes manuais de saldo |
| accrual-calculator | timeoff | Future balance calculator | Calculadora de saldo futuro | Calculadora de saldo futuro |
| pto-mobile | timeoff | Time off in the mobile app | Tiempo libre en la app móvil | Ausências no app móvel |
| pto-payroll-sync | timeoff | Time off sync to payroll | Sincronización de ausencias con payroll | Sincronização de ausências com a folha |
| onboarding-custom-tasks | onboarding | Custom onboarding tasks | Tareas de onboarding propias | Tarefas de onboarding personalizadas |
| first-day-details | onboarding | First-day details | Datos del primer día | Dados do primeiro dia |
| new-hire-packet | onboarding | New hire packet | Paquete de ingreso (New Hire Packet) | Pacote de admissão |
| self-onboarding | onboarding | Self-onboarding | Auto-onboarding | Auto-onboarding |
| ats-prefill | onboarding | Prefill from applicant tracking | Prellenado desde el ATS | Preenchimento a partir do ATS |
| onboarding-reminders | onboarding | Onboarding reminders | Recordatorios de onboarding | Lembretes de onboarding |
| onboarding-progress | onboarding | Onboarding progress dashboard | Tablero de avance | Painel de progresso do onboarding |
| i9-everify | onboarding | I-9 and E-Verify workflows | Flujos I-9 y E-Verify | Fluxos I-9 e E-Verify |
| onboarding-background-checks | onboarding | Background checks | Verificación de antecedentes | Verificação de antecedentes |
| document-folders | documents | Document folders | Carpetas de documentos | Pastas de documentos |
| company-files | documents | Company files | Archivos de la empresa | Arquivos da empresa |
| file-sharing | documents | Share a file or make it private | Compartir o hacer privado un archivo | Compartilhar arquivo ou torná-lo privado |
| employee-document-upload | documents | Document upload by the employee | Subida de documentos por el empleado | Envio de documentos pelo colaborador |
| esign-templates | documents | Signature templates | Plantillas de firma | Modelos de assinatura |
| esign-reminders | documents | Signature report and reminders | Reporte y recordatorios de firmas | Relatório e lembretes de assinatura |
| document-status-report | documents | Onboarding document status report | Estado de documentos de ingreso | Relatório de status de documentos |
| tax-documents | documents | Tax documents | Documentos impositivos | Documentos fiscais |
| review-self | performance | Self-assessment | Autoevaluación | Autoavaliação |
| review-manager | performance | Manager assessment | Evaluación del manager | Avaliação do gestor |
| review-skip-level | performance | Skip-level review | Evaluación de skip-level | Avaliação skip-level |
| review-segmentation | performance | Review segmentation | Segmentar revisiones | Segmentação de avaliações |
| review-reminders | performance | Review reminders | Recordatorios de revisión | Lembretes de avaliação |
| review-notifications | performance | Review completion alerts | Avisos de revisión completa | Alertas de avaliação concluída |
| review-scheduling | performance | Review scheduling | Programar revisiones | Agendamento de avaliações |
| goals-cascading | performance | Cascading goals | Objetivos en cascada | Metas em cascata |
| goals-milestones | performance | Goal milestones and attachments | Hitos y adjuntos en objetivos | Marcos e anexos em metas |
| goals-ai | performance | AI goal suggestions | Objetivos sugeridos por AI | Metas sugeridas por AI |
| goals-report | performance | Goals status report | Reporte de estado de objetivos | Relatório de status de metas |
| one-on-one-scheduling | performance | One-on-one scheduling | Agendar 1:1 | Agendamento de 1:1 |
| performance-report | performance | Performance reports | Reportes de desempeño | Relatórios de desempenho |
| growth-paths | performance | Growth paths | Trayectorias de crecimiento | Trilhas de crescimento |
| enps-trend | performance | eNPS trend | Evolución del eNPS | Evolução do eNPS |
| wellbeing-heatmap | performance | Well-being heatmap | Mapa de calor de bienestar | Mapa de calor de bem-estar |
| recognition-values | performance | Recognition tied to company values | Reconocimiento por valores | Reconhecimento por valores da empresa |
| recognition-private | performance | Public or private recognition | Reconocimiento público o privado | Reconhecimento público ou privado |
| recognition-ai | performance | AI help for recognition | Ayuda de AI para reconocer | Ajuda de AI para reconhecimento |
| recognition-history | performance | Recognition history | Historial de reconocimientos | Histórico de reconhecimentos |
| rewards-points | performance | Points-based rewards | Recompensas por puntos | Recompensas por pontos |
| rewards-catalog | performance | Rewards catalog | Catálogo de recompensas | Catálogo de recompensas |
| payroll-sync | comp | Payroll data sync | Sincronización con payroll | Sincronização com a folha |
| salary-benchmarking | comp | Salary benchmarking | Benchmark salarial | Benchmark salarial |
| pay-visualization | comp | Pay visualization | Visualización de pagos | Visualização de remuneração |
| comp-budget | comp | Compensation review budget | Presupuesto de revisión salarial | Orçamento de revisão salarial |
| comp-worksheets | comp | Compensation worksheets | Planillas de compensación | Planilhas de remuneração |
| comp-permissions | comp | Compensation cycle permissions | Permisos del ciclo | Permissões do ciclo de remuneração |
| comp-currency | comp | Currency conversion in reviews | Conversión de moneda | Conversão de moeda |
| comp-approvals | comp | Pay change approvals | Aprobación de cambios salariales | Aprovação de mudanças salariais |
| comp-communications | comp | Pay change communications | Comunicación de cambios salariales | Comunicação de mudanças salariais |
| payroll-tax-filing | payroll | Payroll tax filing | Presentación de impuestos | Declaração de impostos da folha |
| payroll-direct-deposit | payroll | Direct deposit | Depósito directo | Depósito direto |
| payroll-w2 | payroll | W-2 forms | Formularios W-2 | Formulários W-2 |
| payroll-paystubs | payroll | Pay stubs | Recibos de sueldo | Holerites |
| payroll-self-service | payroll | Withholding and bank self-service | Datos fiscales y bancarios en autoservicio | Autosserviço de dados fiscais e bancários |
| payroll-multi-rate | payroll | Multi-rate payroll | Varias tarifas | Folha com várias taxas |
| payroll-prorate | payroll | Prorated pay | Pagos prorrateados | Pagamentos proporcionais |
| payroll-garnishment | payroll | Wage garnishments | Embargos salariales | Penhoras salariais |
| payroll-managed | payroll | Managed payroll | Payroll gestionado | Folha gerenciada |
| payroll-reminders | payroll | Payroll reminders | Recordatorios de payroll | Lembretes da folha |
| payroll-anomalies | payroll | Payroll anomaly detection | Detección de anomalías | Detecção de anomalias na folha |
| payroll-run-compare | payroll | Payroll run comparison | Comparar corridas | Comparar execuções da folha |
| payroll-audit | payroll | Payroll audit trail | Auditoría de payroll | Auditoria da folha |
| accounting-sync | payroll | Accounting sync | Sincronización contable | Sincronização contábil |
| journal-entries | payroll | Journal entries | Asientos contables | Lançamentos contábeis |
| employment-verification | payroll | Employment and income verification | Verificación de empleo e ingresos | Verificação de emprego e renda |
| on-demand-pay | payroll | On-demand pay | Pago a demanda | Pagamento sob demanda |
| clock-in | time | Clock in and out | Marcar entrada y salida | Registro de entrada e saída |
| time-geolocation | time | Geolocation on time records | Geolocalización | Geolocalização nos registros |
| time-kiosk | time | Time kiosk and clocks | Kiosco y relojes | Quiosque e relógios de ponto |
| time-projects | time | Project time and billable hours | Horas por proyecto | Horas por projeto e faturáveis |
| timesheet-approvals | time | Timesheet approvals | Aprobación de hojas de horas | Aprovação de folhas de ponto |
| timesheet-reminders | time | Timesheet reminders | Recordatorios de horas | Lembretes de folha de ponto |
| timesheet-corrections | time | Timesheet corrections | Correcciones de horas | Correções de folha de ponto |
| overtime | time | Overtime calculation | Cálculo de horas extra | Cálculo de horas extras |
| overtime-custom | time | Custom overtime rules | Reglas de horas extra propias | Regras próprias de horas extras |
| shift-differentials | time | Shift differentials | Diferenciales por turno | Adicionais por turno |
| shift-scheduling | time | Shift scheduling | Programación de turnos | Escala de turnos |
| breaks | time | Meal and rest breaks | Pausas de comida y descanso | Pausas de refeição e descanso |
| manager-team-view | time | Manager team view for time | Vista de equipo del manager | Visão de equipe do gestor |
| timesheet-export | time | Timesheet export | Exportar hojas de horas | Exportar folhas de ponto |
| time-payroll-sync | time | Time sync to payroll | Horas a BambooHR Payroll | Sincronização de horas com a folha |
| benefits-tracking | benefits | Benefits tracking | Registro de beneficios | Acompanhamento de benefícios |
| benefits-config | benefits | Guided benefits setup | Configuración guiada | Configuração guiada de benefícios |
| benefits-self-enrollment | benefits | Benefits self-enrollment | Autoinscripción | Autoinscrição em benefícios |
| benefits-open-enrollment | benefits | Open enrollment | Inscripción abierta | Inscrição aberta |
| benefits-new-hire | benefits | New hire benefit elections | Elecciones de nuevos ingresos | Escolhas de benefícios na admissão |
| benefits-life-events | benefits | Life events | Eventos de vida | Eventos de vida |
| benefits-approval | benefits | Benefit election review and approval | Revisión y aprobación de elecciones | Revisão e aprovação de escolhas |
| benefits-plan-types | benefits | Benefit plan types | Tipos de plan | Tipos de plano de benefício |
| benefits-carriers | benefits | Carrier connections | Conexión con aseguradoras | Conexão com seguradoras |
| benefits-broker | benefits | Broker access | Acceso para corredores | Acesso para corretores |
| benefits-export | benefits | Enrollment export | Exportar inscripciones | Exportar inscrições |
| benefits-deductions | benefits | Benefit deductions in payroll | Deducciones a payroll | Deduções de benefícios na folha |
| benefits-notifications | benefits | Benefits notifications | Avisos de beneficios | Avisos de benefícios |
| benefits-esign | benefits | Signatures on enrollment | Firma en inscripción | Assinatura na inscrição |
| retirement-401k | benefits | Embedded 401(k) | Plan 401(k) integrado | Plano 401(k) integrado |
| turnover-report | reports | Turnover report | Reporte de rotación | Relatório de rotatividade |
| time-off-report | reports | Time off report | Reporte de ausencias | Relatório de ausências |
| report-organize | reports | Report favorites and folders | Favoritos y carpetas de reportes | Favoritos e pastas de relatórios |
| report-sharing | reports | Report sharing | Compartir reportes | Compartilhar relatórios |
| instant-reporting | reports | Instant reporting | Reportes instantáneos | Relatórios instantâneos |
| compliance-reporting | reports | Compliance reports | Reportes de cumplimiento | Relatórios de conformidade |
| dashboard-templates | reports | Dashboard templates | Plantillas de dashboards | Modelos de painéis |
| dashboard-charts | reports | Chart types and layout | Tipos de gráfico | Tipos de gráfico e layout |
| dashboard-formulas | reports | Custom formulas | Fórmulas propias | Fórmulas personalizadas |
| dashboard-sharing | reports | Dashboard sharing with permissions | Compartir dashboards con permisos | Compartilhar painéis com permissões |
| dashboard-export | reports | Dashboard export | Exportar dashboards | Exportar painéis |
| hr-benchmarks | reports | HR benchmarks | Benchmarks de RR. HH. | Benchmarks de RH |
| mfa | security | Two-step login | Login en dos pasos | Login em duas etapas |
| passkeys | security | Passkeys | Passkeys | Passkeys |
| sso-saml | security | SSO with SAML | SSO con SAML | SSO com SAML |
| sso-google | security | Google single sign-on | SSO con Google | SSO com Google |
| security-certs | security | Security audits and practices | Auditorías y prácticas de seguridad | Auditorias e práticas de segurança |
| data-residency | security | Regional data centers | Centros de datos regionales | Data centers regionais |
| api-oauth | platform | OAuth and API keys | OAuth y API key | OAuth e chaves de API |
| api-sdks | platform | Official SDKs | SDK oficiales | SDKs oficiais |
| webhooks-global | platform | Global webhooks | Webhooks globales | Webhooks globais |
| webhooks-permissioned | platform | Permissioned webhooks | Webhooks por permiso | Webhooks por permissão |
| webhooks-events | platform | Event-based webhooks | Webhooks por evento | Webhooks por evento |
| assistant-policies | platform | Assistant on company policies | Asistente sobre políticas | Assistente sobre políticas |
| ai-analytics | platform | Natural language analytics | Análisis en lenguaje natural | Análise em linguagem natural |
| ai-risk | platform | AI risk signals | Riesgos detectados por AI | Sinais de risco por AI |
| ai-external | platform | Connection to other AI tools | Conexión con otras AI | Conexão com outras AIs |
| ai-governance | platform | AI governance | Gobierno de AI | Governança de AI |
| mobile-push | platform | Push notifications | Notificaciones push | Notificações push |
| community-read-receipts | platform | Announcement read confirmations | Confirmación de lectura | Confirmação de leitura |
| community-groups | platform | Interest groups | Grupos internos | Grupos internos |
| community-scheduling | platform | Scheduled posts | Publicaciones programadas | Publicações agendadas |
| integrations | platform | Integrations marketplace | Marketplace de integraciones | Marketplace de integrações |
| multi-language | platform | Multi-language interface | Interfaz en varios idiomas | Interface em vários idiomas |
| compliance-intelligence | compliance | Labor law alerts | Alertas legales (VirgilHR) | Alertas de legislação trabalhista |
| compliance-training | compliance | Compliance training | Capacitación obligatoria (EasyLlama) | Treinamento de conformidade |
| handbook-templates | compliance | Handbook templates | Plantillas de manual | Modelos de manual |
| aca-reporting | compliance | ACA reporting | Reporte ACA (Lumelight) | Relatórios ACA |
| hr-consulting | compliance | HR consulting | Consultoría de RR. HH. | Consultoria de RH |
| global-eor | global | Employer of record | Empleador de registro | Empregador de registro |
| global-contractors | global | Contractor management | Gestión de contratistas | Gestão de prestadores |
| global-payroll-bridge | global | Local payroll connections | Conexión con payroll local | Conexão com folhas locais |
| global-cost-calculator | global | Global cost calculator | Calculadora de costo global | Calculadora de custo global |
| global-regional-settings | global | Regional settings | Ajustes regionales | Configurações regionais |
| global-data-formats | global | Local data formats | Formatos locales de datos | Formatos locais de dados |
