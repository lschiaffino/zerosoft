---
title: "zerosoft Cal vs. Calendly: uma comparação honesta"
description: "Onde o Calendly está claramente à frente, onde o Cal se garante e quem deveria trocar, ou ficar onde está. Sem benchmarks inventados: só o que cada um faz hoje."
date: "2026-09-29"
author: "zerosoft"
tags: ["cal", "calendly", "comparativo"]
---

Comparações escritas pelo próprio fornecedor costumam ser inúteis: uma tabela de recursos em que cada linha do nosso lado tem um check. Vamos tentar escrever o outro tipo. O Calendly é um produto maduro, bem feito, com uma década de refinamento e um ecossistema enorme. O Cal é mais novo, open source e mais enxuto. Para alguns times isso é um negócio melhor. Para outros, o Calendly é simplesmente a escolha certa, e vamos dizer isso.

## A versão curta

- **Fique no Calendly** se você vive no Outlook / Microsoft 365, precisa de integrações nativas tipo Salesforce, apps móveis ou controles enterprise como SSO e audit logs.
- **Olhe para o Cal** se você usa Google Workspace, paga por assento para várias pessoas que no geral só precisam de "um link de agendamento que funcione", quer API e webhooks sem contrato enterprise, ou quer fazer self-hosting e ser dono dos seus dados de agenda.

O resto do post é o detalhe por trás dessas duas linhas.

## Onde o Calendly está à frente

Começamos por aqui, porque é a parte que as comparações de fornecedor pulam.

**Cobertura de calendários.** O Calendly conecta com Google, Outlook / Microsoft 365, Exchange e iCloud. O Cal conecta **só com o Google Calendar**. Se o seu time roda em Microsoft, o Cal não consegue ver seus conflitos nem gravar eventos no seu calendário. Outlook e iCloud estão no nosso roadmap, não no produto. E dentro do Google, o Cal verifica conflitos no calendário principal, não nos secundários.

**Videochamadas.** O Calendly gera links de Zoom, Teams, Webex e Meet. O Cal cria links do **Google Meet** pelo Google Calendar. Para qualquer outra coisa, você coloca um link fixo no local do evento.

**Ecossistema de integrações.** O Calendly tem integrações nativas com os grandes CRMs, ferramentas de marketing e um marketplace de apps, além de extensões de navegador. O Cal tem webhooks `booking.created`, `booking.rescheduled` e `booking.cancelled`, uma API REST e integração nativa com o zerosoft CRM. Para todo o resto, você monta ou conecta por conta própria.

**Apps móveis.** O Calendly tem apps para iOS e Android. O Cal não. A página de agendamento e o painel funcionam no navegador do celular, mas não há app nativo.

**Workflows e lembretes.** O Calendly permite montar sequências de lembretes e follow-ups, incluindo SMS nos planos pagos. O Cal envia a confirmação e os emails de remarcação ou cancelamento, e cada tipo de evento pode ter até 10 passos de workflow: um email para o convidado ou para o anfitrião, antes ou depois da reunião, com assunto e texto próprios. São só emails, sem SMS. No zerosoft Cloud os passos saem por um cron que roda uma vez por hora, então podem chegar até uma hora atrasados.

**Tipos de reunião.** O Calendly suporta eventos coletivos (vários hosts na mesma call), eventos em grupo (muitos convidados num horário) e enquetes de horário. O Cal suporta eventos um a um, opcionalmente com um pool de hosts em [round-robin](/blog/round-robin-con-cal). Ainda não há eventos coletivos, em grupo nem enquetes.

**Profundidade do roteamento.** Os dois têm routing forms. Os do Calendly conseguem consultar seu CRM ("conta existente vai para o owner dela"). Os [routing forms do Cal](/blog/formularios-de-ruteo-en-cal) roteiam só com as respostas do visitante, uma condição por regra.

**Enterprise e maturidade.** SSO/SAML, provisionamento SCIM, audit logs, controles de admin, papelada de compliance, anos de casos extremos já resolvidos. Os recursos enterprise do Cal vivem na nossa pasta `/ee` e ainda estão em desenvolvimento. E o Calendly já processou mais reuniões do que nós vamos ver este ano: maturidade é um recurso de verdade.

## Onde o Cal se garante

Nada do que vem a seguir é único no mundo. É o que você recebe de graça, com código-fonte.

**O núcleo é sólido.** Event types com perguntas personalizadas, horários reutilizáveis com exceções por data, buffers, aviso mínimo, janela de agendamento, blocked slots, links de uso único, branding por evento (cor, logo, mensagem de boas-vindas) e cobrança na reserva com a sua própria conta do Stripe, com reembolso automático se a reserva for cancelada. Isso cobre o que a maioria das pessoas realmente usa numa ferramenta de agenda. Escrevemos um guia inteiro sobre [como usar bem essas regras](/blog/buffers-aviso-minimo-y-ventana).

**Agenda de time sem a conta por assento.** Pools de round-robin com até 50 hosts e routing forms vêm incluídos. Não existe a etapa "faça upgrade para o plano Teams".

**Experiência do convidado.** Fuso detectado pelo navegador, horários no fuso do convidado, emails no idioma dele (inglês, espanhol ou português) com um convite `.ics` que qualquer app de calendário entende, e um link sem conta para remarcar ou cancelar. A [engenharia de fusos horários](/blog/zonas-horarias-en-agendas) está documentada até a função.

**Google Calendar bem feito.** O free/busy bloqueia horários, as reservas caem no calendário do host com link do Meet, remarcar move o evento, cancelar apaga. Por pessoa: cada host do time conecta o seu.

**Incorporável em qualquer lugar.** Uma tag de script, inline ou popup, altura automática e um evento `zs-cal:booked` que sua página pode escutar. [Aqui está o setup](/blog/embeber-cal-en-tu-sitio).

**API e webhooks para todos.** `/api/v1/calendar/*` para listar event types, listar e criar reservas e cancelá-las, mais webhooks assinados. As mesmas API keys pessoais do resto do zerosoft, documentadas em [/docs](/docs). Sem plano enterprise.

**Self-hosting.** O núcleo é AGPLv3. Você pode rodar o Cal no seu próprio servidor com um arquivo SQLite local, manter cada reserva num banco que você controla e ler cada linha que toca o seu calendário. Se a sua empresa tem opinião sobre onde vivem os dados das reuniões, isso pesa.

**Conecta com o resto do zerosoft.** A partir de um contato no zerosoft CRM, você gera um link de agendamento com nome e email já preenchidos.

## Preços, sem números inventados

O Calendly tem um plano grátis e planos pagos por assento; recursos de time como round-robin e roteamento ficam nos planos mais altos. Confira a página de preços deles para os números atuais, que mudam.

Hospedar o Cal custa $0, com todos os recursos do núcleo. No zerosoft Cloud há um plano grátis para começar e depois você paga pelas reservas que usar. Não é por assento: colocar uma quinta pessoa no pool de round-robin não muda a fatura por si só.

O enquadramento honesto: se falta ao Cal algo de que você precisa, a diferença de preço não importa. Se não falta, pagar por assento por um link de agendamento é difícil de justificar; [já defendemos isso antes](/blog/calendly-y-el-impuesto-a-agendar).

## Quem deveria ficar no Calendly

- Times no **Outlook / Microsoft 365**, Exchange ou iCloud.
- Times de vendas que dependem de **roteamento e sincronização nativos** com Salesforce ou HubSpot.
- Quem gerencia a agenda por um **app móvel**.
- Empresas que precisam de **SSO, SCIM, audit logs** e uma revisão de segurança de fornecedor hoje.
- Quem precisa de **eventos em grupo, coletivos, enquetes ou lembretes por SMS**.

Se um desses é você, não troque. Sério.

## Para quem o Cal compensa

- Times no **Google Workspace** que precisam principalmente de reservas um a um e round-robin.
- Times pequenos onde o preço por assento se acumula com gente que quase não usa a ferramenta.
- **Desenvolvedores** que querem API e webhooks sem uma call de vendas, ou querem fazer self-hosting.
- Times que atendem falantes de **espanhol e português** e querem páginas de agendamento e emails no idioma deles.
- Agências e freelancers que querem o agendamento incorporado no próprio site.
- Quem já usa o **zerosoft CRM**.

## Teste antes de decidir

O jeito mais barato de saber é testar. Crie um event type, conecte o Google Calendar, marque uma reunião consigo mesmo numa janela anônima e remarque pelo email. Quinze minutos. Se faltar algo crítico, você vai descobrir rápido, e vai saber que o Calendly valia a pena.
