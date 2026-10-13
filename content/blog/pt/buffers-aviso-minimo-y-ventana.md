---
title: "Higiene de agenda: buffers, aviso mínimo e janela de agendamento"
description: "Um link de agendamento vale o que valem as regras por trás dele. Guia prático de disponibilidade semanal, buffers, aviso mínimo, janela de agendamento e blocked slots no Cal, e por que cada um importa."
date: "2026-08-17"
author: "zerosoft"
tags: ["cal", "agendamento", "produtividade"]
---

A maior parte da dor com agenda não vem da ferramenta. Vem de um link de agendamento que diz "sim" para coisas que você nunca aceitaria pessoalmente: uma call que começa no minuto em que a anterior termina, uma reunião marcada para daqui a 20 minutos, uma demo daqui a quatro meses que ninguém vai lembrar.

Cada uma dessas coisas tem um ajuste. Veja o que cada regra faz no Cal, como funciona por dentro e os valores que sugerimos. Dez minutos de configuração poupam muita remarcação constrangedora.

## Passo zero: configure seu fuso horário

Antes de tudo: **Cal → Settings → Timezone.** Uma conta nova do Cal começa em **UTC**. O Cal não adivinha seu fuso pelo navegador neste ajuste, porque sua disponibilidade não deveria mudar em silêncio quando você abre o notebook em outro país.

Por que importa: seus horários semanais são interpretados nesse fuso. Se você coloca "9:00 às 17:00" e deixa UTC morando em São Paulo, vai oferecer horários das 6:00 às 14:00 no seu relógio. Os convidados sempre veem os horários no fuso *deles*, então ninguém percebe até alguém marcar com você às 6:30 da manhã.

Configure uma vez. Depois abra sua página pública numa janela anônima e confira se os horários fazem sentido.

## Disponibilidade semanal

A disponibilidade é configurada **por event type**, como regras de "dia da semana + hora de início + hora de fim". Dá para ter várias regras no mesmo dia, e é assim que você reserva o almoço: segunda 9:00–12:30 e segunda 14:00–18:00.

Ser por event type é proposital. Seu horário de 15 minutos para "uma dúvida rápida" pode ficar aberto o dia todo, enquanto o workshop de 60 minutos só acontece terça e quinta à tarde. Uma pessoa, portas diferentes.

Um detalhe que passa batido: **os horários são cortados pela duração do evento, a partir do início de cada janela.** Um evento de 30 minutos numa janela de 9:00–12:00 oferece 9:00, 9:30, 10:00… Um de 45 minutos oferece 9:00, 9:45, 10:30, 11:15, e para aí, porque não cabe outro antes das 12:00. Se você quer reuniões de 45 minutos em horas cheias, monte as janelas pensando nisso.

## Buffers

Buffers são folgas antes e depois de uma reunião: **Buffer before (min)** e **Buffer after (min)**.

O Cal usa assim: para cada horário candidato, estica o horário com os buffers (10:00–10:30 com 10 minutos depois vira 10:00–10:40) e compara esse intervalo esticado com tudo o que te ocupa: outras reservas do Cal (de qualquer event type), blocked slots e seu Google Calendar, se estiver conectado. Se algo colide, o horário some.

Por que você quer buffers:

- **Calls se estendem.** Uma de 30 minutos que dura 35 não deveria te atrasar para a próxima.
- **Você precisa anotar.** Notas, atualizar o CRM, um email de follow-up. Esse é o trabalho de verdade.
- **Trocar de contexto custa caro.** Um buffer de 5–10 minutos é o truque de produtividade mais barato que existe.

Uma sutileza, direto do código: **o Cal acolchoa a reunião que está sendo marcada, não o que já está no seu calendário.** Reservas existentes e eventos do Google são comparados como estão. Então, se você só define um buffer *depois*, uma call de 10:00–10:30 protege o tempo seguinte só se a próxima reunião já existia quando ela foi marcada. Se alguém marca 10:00 primeiro e depois outra pessoa vem para as 10:30, o buffer posterior desse horário não olha para trás, e as reuniões ficam coladas.

A solução é simples: **se você quer um intervalo garantido entre quaisquer duas reuniões, use o mesmo valor antes e depois.** Assim, a reunião marcada em segundo lugar carrega o intervalo do lado que encosta na primeira. Lembre que isso também reduz os horários: com horários de 30 minutos e 10 de cada lado, marcar 10:00 esconde 10:30, e a próxima opção livre é 11:00.

Sugestão: 10 minutos antes e depois para calls de vendas e suporte; mais do lado de antes para reuniões que pedem preparo, como entrevistas (reler o currículo) ou demos (carregar os dados certos).

## Aviso mínimo

**Min. notice (hours)** impede que marquem uma reunião que começa cedo demais. Com 4 horas de aviso, às 10:00 o primeiro horário disponível é 14:00.

É uma conta direta de "agora mais N horas", então não liga para noites nem fins de semana. Com 12 horas, às 20:00 de sexta alguém ainda pode marcar sábado às 8:00, se sábado estiver na sua disponibilidade. Se você não trabalha no fim de semana, garanta que suas regras semanais digam isso.

Por que importa: uma reunião que aparece no calendário 15 minutos antes de começar é uma reunião que você provavelmente vai perder ou fazer sem preparo. Sugestão: 2–4 horas para calls mais informais, 12–24 horas para demos e entrevistas.

## Janela de agendamento

**Max. future (days)** limita até quando podem marcar com você. Padrão: 30 dias, contados a partir de hoje no fuso do convidado.

Por que limitar? Porque reuniões marcadas muito à frente têm mais faltas e batem com planos que você ainda não fez: férias, uma conferência, um lançamento. Uma janela de 2–4 semanas mantém o calendário fiel à realidade. Recrutamento e demos de vendas costumam funcionar bem com 14–21 dias. Office hours ou onboardings talvez queiram 60.

## Blocked slots

Blocked slots são blocos pontuais em que você não está disponível: médico, meio período fora, uma semana de férias. Você adiciona pela página principal do Cal, com início, fim e um motivo opcional.

Diferente da disponibilidade semanal, os blocked slots são **seus**, não de um event type. Eles tiram essas horas de todas as suas páginas de agendamento, incluindo pools de round-robin dos quais você participa.

Com o Google Calendar conectado, muitas vezes você nem precisa deles: os eventos do calendário principal já bloqueiam horários, porque o Cal consulta seu free/busy antes de mostrar opções. Blocked slots servem para o que você não coloca no calendário, ou para quando prefere não conectar nenhum.

## Regras do event type vs. padrões da conta

Buffers, aviso mínimo e janela aparecem em dois lugares:

- **Cal → Settings → Defaults for all event types**,
- as **Booking rules** de cada event type.

Quando o event type tem valor próprio, ele vence. Quando não tem, o Cal usa o padrão da conta. Na prática, event types criados pelo editor salvam suas próprias regras, então **trate as regras do event type como a fonte da verdade** e confira cada um. Os padrões da conta pesam mais em event types criados pela API sem regras.

## Mais duas ferramentas

**Links de uso único.** Marque um event type como single-use e o link serve para exatamente uma reserva. Depois disso, a página avisa que já foi usado. Ótimo para "este link é para *você*": uma entrevista com candidato, um cliente VIP.

**Seu calendário faz parte da sua disponibilidade.** Todas as regras acima funcionam tão bem quanto os dados por trás delas. Se você está num time que usa [round-robin](/blog/round-robin-con-cal), um host sem calendário conectado parece livre sempre que o Cal não souber o contrário.

## Uma configuração para começar

Se quiser algo para copiar, esta é uma base razoável para um consultor independente hipotético:

- Fuso horário: o seu de verdade (não UTC).
- Disponibilidade: segunda a quinta, 9:30–12:30 e 14:00–17:30. Sexta livre.
- Buffers: 10 minutos antes e 10 depois.
- Aviso mínimo: 12 horas.
- Janela: 21 dias.
- Google Calendar conectado, blocked slots para o que não está no calendário.

Nada disso é avançado. É higiene. Do tipo que você só nota quando falta: normalmente às 6:30 da manhã, numa call que você não sabia que tinha.
