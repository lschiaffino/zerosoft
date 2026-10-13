---
title: "Round-robin com o Cal: um só link para o time inteiro"
description: "Como compartilhar um único link de agendamento entre seu time de vendas ou suporte com o Cal, e como o Cal escolhe o host de cada reunião: cursor, ordem do pool, conflitos e tudo."
date: "2026-07-18"
author: "zerosoft"
tags: ["cal", "agendamento", "equipes"]
---

Você tem três pessoas que podem fazer uma demo. Não quer três links de agendamento no site, e muito menos alguém decidindo na mão quem fica com cada lead. Você quer um link, e as reuniões distribuídas entre o time.

Isso é round-robin. O Cal faz, e como o código é aberto dá para fazer algo que a maioria das ferramentas de agenda não faz: mostrar exatamente como o host é escolhido. Sem caixa-preta, sem texto de marketing sobre "distribuição inteligente". Um cursor e um loop.

## Como configurar

O round-robin mora no event type. Primeiro você precisa de um time, porque o pool de hosts é formado por membros do time.

1. Vá em **Cal → Event types** e crie (ou abra) o event type que quer compartilhar; por exemplo, "Demo do produto", 30 minutos.
2. Na seção **Hosts (round-robin)**, marque os membros do time que vão fazer essas reuniões. O formulário diz sem rodeios: as reservas fazem rodízio entre os membros selecionados.
3. Configure a disponibilidade semanal do event type (mais abaixo explicamos por que isso importa).
4. Peça para cada host conectar o próprio Google Calendar em **Cal → Settings**. É por pessoa, não por workspace, e faz toda a diferença.
5. Compartilhe o link público: `/book/<seu-handle>/<slug>`.

Pronto. Se o pool ficar vazio, o event type funciona como um link normal de uma pessoa: o dono faz todas as reuniões.

Um pool aceita até 50 hosts. É um limite de validação da API, não um plano de preços.

## Como o host é escolhido

Isto é o que acontece de verdade, em ordem, direto do `lib/calendar.ts`.

**1. Mostrar horários.** Quando o convidado abre a página de agendamento, o Cal monta os horários candidatos a partir da disponibilidade semanal do event type. Para cada horário, verifica cada host do pool. O horário aparece se **pelo menos um** host estiver livre. Livre quer dizer que o horário (mais os buffers) não colide com:

- reservas confirmadas desse host em **qualquer** event type (não só neste),
- os blocked slots dele,
- os horários ocupados do Google Calendar conectado.

Ou seja, a página mostra a união do tempo livre de todo mundo. Com três hosts, o convidado vê muito mais opções do que com um.

**2. Reservar.** Quando o convidado confirma, o Cal olha um contador persistente do event type, o `rr_cursor`. Percorre o pool começando na posição do cursor (dando a volta se precisar) e atribui a reunião ao **primeiro host livre** naquele horário exato.

**3. Avançar.** Depois de salvar a reserva, o cursor avança uma posição.

A ordem do pool é a ordem da sua lista de membros do time, filtrada aos que você marcou. Não é alfabética por acaso nem aleatória.

## O que isso significa na prática

Digamos que seu pool é Ana, Bruno e Carla, o cursor está na Ana e todos estão livres a semana inteira. As reservas vão Ana, Bruno, Carla, Ana, Bruno… Rodízio de livro.

Agora o mundo real. Um convidado escolhe terça às 10:00 e a Ana tem dentista no Google Calendar. O Cal começa na Ana, vê que está ocupada, passa para o Bruno, ele está livre, o Bruno fica com a reunião. O cursor avança um passo, para o Bruno. Na próxima reserva, se o Bruno estiver livre, ele leva essa também.

Leia de novo, porque é a parte honesta: **o cursor avança uma posição por reserva, não até quem foi escolhido.** É um rodízio estrito do ponto de partida, não um balanceador de justiça. Não tem pesos, nem "quem recebeu há mais tempo", nem "quem tem menos reuniões na semana". Com muitas reservas e hosts quase sempre disponíveis, a conta fecha. Se uma pessoa vive ocupada, quem vem depois dela na lista absorve mais reuniões.

Se você precisa de distribuição ponderada ou hosts com prioridade, o Cal hoje não faz isso. O Calendly e outros oferecem mais ajustes aqui.

## Conflitos e corridas

Dois convidados clicam no mesmo horário das 10:00 no mesmo segundo. O que acontece?

Antes de salvar, o Cal confere de novo se o horário pedido ainda é um horário oferecido. Além disso, a tabela de reservas tem um índice único em `(host_user_id, starts_at)` para reservas confirmadas. Se duas requisições disputam o mesmo horário para o mesmo host, o banco rejeita a segunda e esse convidado recebe `slot_unavailable` (HTTP 409) e escolhe outro horário. Nenhum host fica com reserva dupla.

O comentário no código admite uma simplificação: escolher o host e avançar o cursor não é atômico, então duas reservas simultâneas para horários *diferentes* podem partir da mesma posição e cair no mesmo host. Ninguém fica com reserva dupla; o rodízio só pula uma vez.

## Remarcações, emails e calendários

Quando um convidado remarca pelo link de gestão, o Cal repete a escolha para o novo horário, começando no cursor atual. A reunião pode passar para outro host se o original estiver ocupado no novo horário. Remarcar não avança o cursor.

Se o host muda, o Cal apaga o evento do Google Calendar do host anterior e cria no do novo. Se não, só move o evento existente.

Tudo o que vem depois segue o host **atribuído**, não o dono do event type:

- o email de aviso vai para o host atribuído,
- o evento do Google Calendar (com link do Meet, se o event type não tiver outro local) é criado no calendário do host atribuído,
- o payload do webhook `booking.created` inclui `hostUserId`.

## Detalhes que vale saber

**A disponibilidade é por event type, não por host.** As horas semanais configuradas no event type (no fuso horário do dono) valem para o pool inteiro. O Cal não lê o horário de trabalho pessoal de cada host. Se o Bruno só trabalha de manhã, ele precisa bloquear as tardes (com blocked slots ou no Google Calendar) senão vai receber reuniões à tarde.

**Conecte todos os calendários.** Um host sem Google Calendar conectado parece livre para o Cal sempre que não tiver uma reserva do Cal ou um blocked slot. É o jeito mais comum de o round-robin dar errado: não é o algoritmo, são os dados que faltam.

**Mudar o pool reseta um cursor fora do intervalo.** Se você tira hosts e o cursor fica apontando além do fim da nova lista, ele volta para zero. Nada grave, mas não espere continuidade perfeita depois de editar o pool.

**Não existe modo coletivo.** O round-robin atribui *um* host por reunião. Reuniões que precisam de várias pessoas do time ao mesmo tempo ainda não são suportadas.

## Combine com roteamento

O round-robin responde "quem faz esta reunião". Não responde "qual reunião este lead deveria marcar". Se leads enterprise devem ir para um pool e contas pequenas para outro, coloque um routing form na frente dos dois event types. Contamos isso em [formulários de roteamento no Cal](/blog/formularios-de-ruteo-en-cal).

E se você quiser ligar as reservas aos seus próprios sistemas, `GET /api/v1/calendar/bookings` devolve as reservas com o host atribuído, e os webhooks `booking.*` disparam a cada mudança. Os detalhes estão na [documentação da API](/docs).

Round-robin não é mágica. É um loop sobre uma lista com um ponteiro. A diferença é que aqui você pode ler o loop.
