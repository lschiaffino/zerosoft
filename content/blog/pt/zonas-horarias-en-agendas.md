---
title: "Como o Cal lida com fusos horários: hora de relógio, UTC e horário de verão"
description: "Um passeio de engenharia pelos fusos horários no Cal: o que guardamos em UTC, o que guardamos como hora de relógio, como os horários sobrevivem ao horário de verão e como emails e .ics chegam no horário do convidado."
date: "2026-09-01"
author: "zerosoft"
tags: ["cal", "arquitetura", "fusos horários"]
---

Fusos horários são a parte de uma ferramenta de agenda que parece trivial e não é. "As suas 15h são as minhas 15h?" tem uma dúzia de respostas erradas, e a maioria só aparece duas vezes por ano, quando em algum lugar do mundo começa ou termina o horário de verão.

Este post mostra como o Cal resolve isso, com base estritamente no que o código faz: `lib/calendar.ts`, `lib/ics.ts`, `lib/user-tz.ts` e companhia. Sem biblioteca de fusos: só `Intl` e duas regras.

## As duas regras

**1. Instantes são guardados em UTC.** O `starts_at` e o `ends_at` de uma reserva são gravados com `toISOString()`. Blocked slots, o `send_at` dos lembretes, tudo o que é *um momento no tempo* fica em UTC.

**2. Intenções são guardadas como hora de relógio.** Sua disponibilidade semanal não é guardada em UTC. É guardada como "dia da semana + `09:00` + `17:00`", mais o fuso da sua conta como nome IANA, tipo `America/New_York`. É isso que você quer dizer de verdade: "trabalho das 9 às 17 onde eu moro", não "trabalho das 13:00 às 21:00 UTC".

A regra 2 é a que transforma o horário de verão num não-evento. Se convertêssemos sua disponibilidade para UTC ao salvar, todo março e todo novembro seu expediente mudaria uma hora sem aviso. Em vez disso, convertemos na consulta, para a data específica pedida. Numa segunda de verão, 9:00 em Nova York são 13:00 UTC; numa segunda de inverno, 14:00 UTC. Mesma regra, resposta certa nas duas.

## Três fusos em jogo

No Cal há três fusos diferentes, e mantê-los separados é metade do trabalho:

- **O fuso do host.** Configurado nos settings do Cal e validado como zona IANA real (se o `Intl.DateTimeFormat` rejeita, a API também). Contas novas começam em UTC: não inferimos em silêncio, assim sua disponibilidade nunca muda porque você viajou.
- **O fuso do convidado.** A página de agendamento lê do navegador com `Intl.DateTimeFormat().resolvedOptions().timeZone`, e o convidado pode trocar num dropdown. Fica salvo na reserva.
- **O fuso de quem olha o app.** Dentro do app, um componente pequeno grava o fuso do seu navegador num cookie `tz`, para que painéis como "reservas desta semana" apareçam no seu horário. Fora de uma requisição (crons, testes) cai para UTC.

## Montando horários entre dois calendários

Agora a parte interessante. Uma convidada em Tóquio pede horários para 10 de setembro. O host está em Buenos Aires, com disponibilidade de segunda a sexta, das 9:00 às 18:00. Tóquio está 12 horas à frente, então o 10 de setembro dela cobre dois dias do host.

O `getAvailableSlots` resolve assim:

1. Calcula o dia da convidada como intervalo UTC: meia-noite do dia 10 em Tóquio, mais 24 horas.
2. Percorre os dias locais **do host** de um dia antes até um dia depois desse intervalo. Cada passo pula para a próxima meia-noite local no fuso do host, calculada de novo, então um dia de 23 ou 25 horas não bagunça nada.
3. Para cada dia do host, descobre o dia da semana *no fuso do host*, aplica as regras de disponibilidade correspondentes e converte o início e o fim de cada regra para UTC naquela data.
4. Corta horários pela duração do evento e descarta os que ficam fora do dia da convidada, os que estão dentro do aviso mínimo e os que colidem (com buffers) com algo ocupado.
5. Ordena e remove duplicados.

Depois, o navegador da convidada formata cada instante UTC no fuso dela com `Intl`. O servidor nunca formata um horário para exibição: ele entrega instantes.

## Convertendo hora de relógio em UTC sem biblioteca

O helper central é `localToUtc(date, time, tz)`: "que instante UTC é 09:00 de 2026-09-10 em `America/Argentina/Buenos_Aires`?". O JavaScript não tem nada pronto nessa direção. O `Intl` só vai para o outro lado: dado um instante, diga a hora local.

Então iteramos. Começamos fingindo que a hora de relógio *é* UTC. Perguntamos ao `Intl` que hora local esse instante é no fuso de destino. A diferença entre o que queríamos e o que obtivemos é o offset; deslocamos o instante por essa diferença e conferimos de novo. Normalmente estabiliza em uma ou duas voltas; o loop tem limite de cinco. Como o offset é medido no instante real, as mudanças de horário de verão entram automaticamente.

São umas quinze linhas, o que significa zero dependências e nada para atualizar quando um país muda as regras de horário de verão: a base de fusos do runtime cuida disso.

## Uma semana de mudança de horário, na prática

Hipotético: um host em Nova York com disponibilidade das 9:00 às 17:00 e uma convidada em Buenos Aires (sem horário de verão).

- Antes de os Estados Unidos mudarem para o horário de verão, 9:00 em Nova York são 11:00 em Buenos Aires.
- Depois da mudança, 9:00 em Nova York são 10:00 em Buenos Aires.

A convidada vê os horários do host adiantarem uma hora. Está certo: o host continua começando às 9 na vida dele. Uma convidada em Madri veria a diferença mudar duas vezes, porque Estados Unidos e Europa mudam em fins de semana diferentes. Certo de novo, e nada mudou no banco.

## Validando a reserva

O cliente envia o instante escolhido mais o fuso do convidado. O servidor não confia cegamente em nenhum dos dois: o `findOfferedSlot` roda de novo o mesmo cálculo de horários para o dia local do convidado e só aceita um início que bata com um horário oferecido (com um minuto de tolerância). Aí a reserva é salva com o instante UTC, o fuso IANA do convidado e o idioma dele (`en`, `es` ou `pt`).

## Emails, lembretes e .ics

Tudo o que o convidado recebe é montado no fuso **dele** e no idioma **dele**. Os emails de confirmação, remarcação e cancelamento formatam a hora com `Intl.DateTimeFormat` usando `en-US`, `es-AR` ou `pt-BR`, no fuso da reserva, com o nome do fuso ao lado ("(America/Sao_Paulo)") para não haver ambiguidade. O link de gestão também aponta para o idioma do convidado.

O lembrete de 24 horas é agendado como instante UTC (`início - 24h`) e enviado pelo cron em `/api/cron/tick`, que roda de hora em hora, então sai entre 24 e 23 horas antes da reunião. Reuniões marcadas com menos de 24 horas de antecedência não têm lembrete: a confirmação acabou de chegar.

O anexo `.ics` contorna o problema por completo: `DTSTART` e `DTEND` são escritos em UTC com um `Z` no final, tipo `20260910T120000Z`. Não há bloco `VTIMEZONE` para dar errado. Gmail, Outlook e Apple Calendar convertem cada um para o fuso do seu usuário. O `UID` é estável por reserva e o `SEQUENCE` sobe a cada mudança, então uma remarcação atualiza o evento existente em vez de criar outro, e `METHOD:CANCEL` o remove.

A sincronização com o Google Calendar segue a mesma ideia: os eventos são criados com horários UTC e o Google mostra no fuso de cada pessoa.

## A lista honesta de arestas

Coisas que conhecemos e ainda não resolvemos de todo:

- **O email para o host mostra o fuso do convidado.** Está identificado, então não há ambiguidade, mas a conversão fica com o host. Se você tem o Google Calendar conectado, o evento no seu calendário já está no seu horário.
- **A linha de descrição do .ics está em inglês.** O email em volta é traduzido e o título do evento é o que o host escreveu, mas a linha "Reschedule or cancel" dentro do `.ics` ainda não é traduzida.
- **O dia de mudança de horário do convidado é tratado como de 24 horas.** No único dia do ano que dura 23 ou 25 horas no fuso dele, um horário bem na meia-noite pode aparecer na data vizinha.
- **Regras de disponibilidade dentro do buraco da mudança.** Uma regra que começa numa hora local que não existe (2:30 na noite em que o relógio adianta) é resolvida para um instante próximo. Raramente há expediente aí, mas não tratamos como caso especial.

Nada disso é suposição: sai direto do código acima, que é justamente a ideia. Se você achar outro, o código é aberto: [veja como contribuir](/blog/como-contribuir-a-zerosoftware).
