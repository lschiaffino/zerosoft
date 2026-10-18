---
title: "Que dados uma reserva deixa e para onde eles vão"
description: "O mapa completo de uma reserva no Cal: o que fica na linha, quais cópias saem para o email, o Google Calendar, o CRM, webhooks e o Stripe, e como responder a um pedido de exclusão. Com o que falta, dito."
date: "2026-10-18"
author: "zerosoft"
tags: ["cal", "privacidade", "dados", "self-host"]
---

Os guias de privacidade para ferramentas de agenda costumam começar pela papelada: contrato de operador, lista de suboperadores, cláusulas de transferência. Tudo isso importa, e o Cal.com publicou um [guia longo sobre GDPR](https://cal.com/blog/gdpr-compliant-scheduling) que cobre bem esses pontos. Mas antes da papelada existe uma pergunta mais concreta, a que qualquer pessoa que peça para ver ou apagar seus dados vai fazer: **onde eles estão?**

Este post responde isso para o Cal, lido do código. É o mapa de que você precisa para escrever seu aviso de privacidade, responder a um pedido de exclusão ou decidir se o self-host faz sentido para você.

## A linha: o que o Cal guarda de cada reserva

Cada reserva é uma linha na tabela `calendar_bookings`. Estes são os campos pessoais e operacionais:

| Campo | O que é |
|---|---|
| `invitee_name`, `invitee_email` | Nome e email de quem reservou. Sempre obrigatórios |
| `starts_at`, `ends_at`, `timezone` | Horário e fuso horário da pessoa |
| `locale` | Idioma em que a pessoa reservou (para os emails saírem nesse idioma) |
| `answers` | As respostas às suas perguntas próprias, em JSON |
| `status`, `cancel_reason` | Confirmada, cancelada, não compareceu ou aguardando pagamento, e o motivo se cancelou |
| `host_user_id` | Quem do seu time atende (no round-robin) |
| `meeting_url`, `google_event_id` | Link da videochamada e referência ao evento do Google |
| `manage_token` | O token do link para reagendar ou cancelar |
| `payment_status`, `amount_cents`, `currency`, `stripe_session_id` | Só se o tipo de evento cobra |

O que **não** está na linha: o endereço IP, o navegador, o dispositivo. O endpoint de reservas usa o IP para barrar abuso (até 10 tentativas a cada 10 minutos por IP) numa tabela de limites que se apaga sozinha quando a janela termina. Nossa [política de privacidade](/privacy) traz os detalhes, junto com os logs de curta duração do provedor de hospedagem.

A coluna que pede mais cuidado é `answers`. Uma pergunta de texto livre como "Algo que devemos saber?" convida respostas que você não quer guardar: um diagnóstico médico, um problema jurídico, dados de outra pessoa.

## As cópias: para onde cada reserva viaja

Quando alguém confirma, o Cal faz cinco coisas além de salvar a linha. Cada uma deixa uma cópia em outro lugar:

1. **Emails.** A confirmação para o convidado (com `.ics`), o aviso para o anfitrião e cada lembrete. No zerosoft Cloud eles saem pelo Resend. Levam nome, horário, local e o link de gestão.
2. **Google Calendar**, se você conectou. É criado um evento na sua agenda com o título do tipo de evento, o nome da pessoa, o email dela como convidada e uma descrição com nome e email. As respostas não vão para o Google.
3. **CRM.** Cada reserva cria o contato se ele não existir (nome e email) e uma atividade de reunião na ficha dele. O corpo dessa atividade inclui as respostas. Se a pessoa cancelar depois, a atividade recebe o motivo.
4. **Webhooks e Flow.** Os eventos `booking.created`, `booking.rescheduled` e `booking.cancelled` mandam para as suas URLs o nome, o email, o horário, as respostas e, se houver, o pagamento. O que o receptor faz com isso já é responsabilidade sua.
5. **Stripe**, se você cobra. A sessão de Checkout fica na sua conta do Stripe, com o que o Stripe exigir para cobrar.

Esse mapa é o que você vai precisar no dia em que alguém escrever. Guarde junto do seu aviso de privacidade.

## Quem responde pelo quê

Para as reservas que você recebe, o controlador dos dados é você: decide o que perguntar, para quê e por quanto tempo. No zerosoft Cloud, o zerosoft trata esses dados em seu nome, e os provedores que operam a nuvem (Vercel para hospedagem, Turso para o banco de dados, Resend para os emails) estão na [política de privacidade](/privacy). Google, Stripe e os receptores dos seus webhooks só entram se você os conectar.

Com o self-host a cadeia encurta: você escolhe o servidor, o banco e o provedor de email, e o código AGPLv3 está aí para qualquer pessoa do seu time conferir este mapa. Para um time que precisa que os dados não saiam de um país, é o caminho mais direto. Como referência, o Cal.com diz nesse mesmo guia que a hospedagem dele na União Europeia é para empresas com 50 usuários ou mais e estava em acesso antecipado.

## Coletar menos a partir do formulário

O dado mais barato de proteger é o que nunca é guardado. Nas **Perguntas** de cada tipo de evento:

- **Prefira sim/não ou número a texto livre.** As perguntas próprias podem ser de texto, número ou sim/não. "Você já usa um CRM?" responde o mesmo que "Conte sobre a sua situação" e deixa menos texto solto.
- **Marque como opcional o que você não precisa de jeito nenhum.** Cada pergunta tem sua caixa de obrigatória.
- **Diga o que não enviar.** Na mensagem de boas-vindas do tipo de evento, uma linha como "Não inclua dados de saúde nem de outras pessoas neste formulário" evita problemas.
- **Revise as perguntas a cada trimestre.** A pergunta que você criou para uma campanha continua lá coletando dados.

## Como responder a um pedido de exclusão

Alguém escreve: "Apaguem tudo o que vocês têm sobre mim." Com o mapa acima, o caminho é este:

1. **Cal.** Cancelar uma reserva não a apaga: ela fica como cancelada, com o histórico. Hoje o Cal não tem um botão para apagar uma reserva específica; apagar um tipo de evento apaga todas as reservas dele, o que raramente é o que você quer. No zerosoft Cloud, o canal para um pedido pontual é privacy@zerosoft.ai, que consta na política de privacidade. No self-host você faz isso no banco (o SQL está abaixo).
2. **CRM.** Apague o contato pela ficha. Confira se ele não ficou numa lista ou num deal.
3. **Google Calendar.** Apague o evento à mão. Se a pessoa era convidada, a cópia na agenda dela é dela.
4. **Webhooks.** O que chegou na sua planilha, no seu banco ou na sua automação precisa ser apagado lá.
5. **Stripe.** Pagamentos têm regras próprias de retenção por motivos fiscais; confira as do Stripe e as do seu país antes de apagar.
6. **Responda com data.** Diga à pessoa o que você apagou e onde.

Para o self-host, este SQL apaga as reservas de um email e os lembretes pendentes delas. Faça um backup antes:

```sql
DELETE FROM calendar_workflow_runs
  WHERE booking_id IN (SELECT id FROM calendar_bookings WHERE invitee_email = 'pessoa@exemplo.com');
DELETE FROM calendar_reminders
  WHERE booking_id IN (SELECT id FROM calendar_bookings WHERE invitee_email = 'pessoa@exemplo.com');
DELETE FROM calendar_bookings WHERE invitee_email = 'pessoa@exemplo.com';
```

## O que falta, dito

- **Apagar uma reserva pela interface.** É a maior lacuna deste post.
- **Retenção automática.** Não existe uma regra do tipo "apagar reservas com mais de 24 meses". As reservas ficam guardadas enquanto você as mantiver.
- **Exportar as reservas de uma pessoa.** A API lista reservas com busca (`GET /api/v1/calendar/bookings?q=`), o que serve para montar um pedido de acesso, mas não há um botão de "exportar tudo deste email".

Se alguma delas te trava, conte no [feedback board](/feedback). Enquanto isso, o mapa de cópias é o que mais vai te poupar tempo: um pedido de exclusão sem mapa leva uma tarde, e com mapa leva quinze minutos.
