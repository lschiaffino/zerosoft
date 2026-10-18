---
title: "Menos convidados que faltam: lembretes e regras no Cal"
description: "Por que as pessoas faltam a reuniões que elas mesmas agendaram, e como reduzir isso com o Cal: confirmação com .ics, link para reagendar, uma sequência de lembretes com modelos, regras de agendamento e a marca de Não compareceu."
date: "2026-10-18"
author: "zerosoft"
tags: ["cal", "reuniões", "lembretes"]
---

Alguém escolhe um horário na sua página de agendamento, preenche o formulário, recebe a confirmação. Chega a hora e a pessoa não aparece. Na maioria das vezes não há má-fé. Quatro causas se repetem:

1. **Esqueceu.** Agendou há duas semanas e a reunião nunca entrou na agenda dela.
2. **Surgiu um imprevisto e ela não sabia como avisar.** Cancelar parecia mais constrangedor do que faltar.
3. **Agendou sem muito compromisso.** Dois cliques, nenhum esforço, nenhum custo em não ir.
4. **Agendou fora de hora.** Longe demais para lembrar, ou tão em cima que não deu para se organizar.

Cada causa tem um remédio diferente. Este post passa por elas em ordem, com o que o Cal faz em cada caso, modelos para copiar e o que ainda não fazemos.

## 1. Fazer a reunião chegar na agenda

Um email de confirmação parado na caixa de entrada é esquecido. Um evento na agenda toca sozinho.

O Cal manda a confirmação no idioma em que a pessoa agendou, com um arquivo `.ics` anexo: um toque e ela vai para o Google Calendar, o Outlook ou a agenda do celular. Se você conectou o Google Calendar nas configurações, o Cal também cria o evento na sua agenda com a pessoa como convidada (e o link do Meet, se o local for Google Meet), então chega para ela pelo Google também.

Quando a reunião é reagendada, o `.ics` atualiza o mesmo evento em vez de criar outro. Ninguém fica com dois eventos para a mesma chamada.

## 2. Fazer cancelar ser mais fácil que faltar

Um cancelamento com antecedência é boa notícia: o horário volta a ficar livre para outra pessoa. Uma falta é uma hora perdida para os dois.

Cada confirmação traz um link de **Reagendar ou cancelar**. Ele abre uma página onde a pessoa escolhe outro horário ou cancela, sem conta e sem senha. Do seu lado, em **Reservas**, você também pode reagendar: escolhe o horário novo e o Cal manda para a pessoa o convite atualizado.

Esse link é a peça mais subestimada. Coloque também em cada lembrete com a variável `{{manage}}`, que mostramos abaixo.

## 3. Uma sequência de lembretes

Sem configurar nada, cada tipo de evento manda ao convidado um lembrete 24 horas antes. Para muitas reuniões isso basta. Para as que importam, monte uma sequência no tipo de evento, seção **Lembretes**:

- Até 10 passos por tipo de evento.
- Cada passo vai para o **convidado** ou para o **anfitrião**, um número de minutos, horas ou dias **antes** ou **depois** do início (até 30 dias).
- Assunto e mensagem próprios, com variáveis: `{{guest.name}}`, `{{guest.email}}`, `{{host.name}}`, `{{event.title}}`, `{{start}}`, `{{link}}` e `{{manage}}`.
- `{{start}}` sai no fuso horário de quem recebe. `{{link}}` é o link da videochamada ou o local.

Se você adiciona passos, eles substituem o lembrete de 24 horas. Um detalhe prático: os lembretes saem de um processo que roda a cada hora, então podem chegar até uma hora atrasados. Um "15 minutos antes" não faz sentido; use 2 ou 3 horas.

### Modelos para copiar

Uma sequência de três passos que funciona para demos, consultorias e entrevistas:

**Passo 1: convidado, 2 dias antes**

> Assunto: {{event.title}} em {{start}}
>
> Oi {{guest.name}}, passando para confirmar nossa conversa em {{start}}.
>
> Se quiser que a gente prepare algo específico, responda este email.
>
> Sua agenda mudou? Escolha outro horário aqui: {{manage}}

**Passo 2: convidado, 3 horas antes**

> Assunto: Hoje: {{event.title}}
>
> Oi {{guest.name}}, nos vemos hoje às {{start}}.
>
> Link para entrar: {{link}}
>
> Se não puder, me avise aqui e a gente muda: {{manage}}

**Passo 3: anfitrião, 1 dia antes**

> Assunto: Amanhã: {{event.title}} com {{guest.name}}
>
> {{guest.name}} ({{guest.email}}) tem reunião em {{start}}. Veja as respostas dela em Reservas antes da chamada.

O terceiro parece menor e não é: boa parte das reuniões que dão errado vem do anfitrião que chega atrasado ou sem preparo.

## 4. Regras que filtram agendamentos fracos

Algumas faltas se evitam antes de o agendamento existir. As regras ficam em cada tipo de evento (com valores padrão em **Configurações**):

- **Antecedência mínima.** Se alguém agenda para daqui a 20 minutos, provavelmente não consegue se organizar. De 2 a 4 horas é um bom piso para chamadas de vendas. Mais detalhes no post sobre [buffers, aviso mínimo e janela](/blog/buffers-aviso-minimo-y-ventana).
- **Agendável até.** Um agendamento para daqui a 60 dias é quase uma promessa vaga. Para uma demo, 14 a 21 dias costuma bastar.
- **Perguntas próprias.** Nome e email são sempre pedidos. Uma pergunta como "O que você quer ver na chamada?" faz agendar levar um minuto, e quem escreve uma resposta costuma aparecer.
- **Link de uso único.** Para mandar a uma pessoa específica: o link para de funcionar depois do primeiro agendamento, então não acaba encaminhado para um grupo.
- **Cobrança ao agendar.** Se você faz sessões pagas, conecte sua conta do Stripe em **Configurações › Pagamentos** e coloque preço no tipo de evento. O agendamento fica como **Aguardando pagamento** e é confirmado quando a pessoa paga no Stripe Checkout; se não pagar em 35 minutos, o horário é liberado. Pagar adiantado é o filtro de compromisso mais forte que existe.

## 5. Medir: a marca de Não compareceu

O que não é anotado não melhora. Em **Reservas**, cada reunião que já começou tem a opção **Não compareceu**. O Cal não deixa marcar antes do início, porque marcar libera o horário.

A marca tem um efeito útil na sequência: os passos "depois" só saem para agendamentos confirmados. Se você tem um passo "convidado, 1 hora depois" com um "obrigado pela conversa, segue o resumo", marcar Não compareceu evita que ele chegue a quem não veio.

Para tirar sua taxa de faltas do mês, use a API com uma chave com permissão `cal:read`:

```bash
curl -s "https://zerosoft.ai/api/v1/calendar/bookings?status=no_show&from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z" \
  -H "Authorization: Bearer $ZEROSOFT_KEY" | jq '.bookings | length'
```

Troque `status=no_show` por `status=confirmed` e você tem o denominador. Isso basta para ver se a mudança da semana passada funcionou.

## O que o Cal ainda não faz

Para você comparar com o que usa hoje:

- **SMS ou WhatsApp.** Os lembretes são só por email.
- **Enviar do seu Gmail.** No zerosoft Cloud os emails saem de um endereço do zerosoft, com a cor e o logo do tipo de evento. No self-host você escolhe o remetente com `EMAIL_FROM`.
- **Um email automático para quem faltou agendar de novo.** Hoje a marca de Não compareceu interrompe os passos seguintes, mas não dispara um passo próprio. Enquanto isso, mande seu link de agendamento à mão a partir do detalhe.

Para comparar, no Calendly os lembretes configuráveis ficam em Workflows, que segundo [o próprio guia deles](https://calendly.com/blog/guide-calendly-reminders) estão disponíveis nos planos pagos. No Cal a sequência não depende do plano: está no zerosoft Cloud (onde os emails são cobrados por uso) e no self-host.

## Resumo

- Confirmação com `.ics` e evento no Google Calendar: a reunião entra na agenda.
- Link de reagendar ou cancelar em cada email, inclusive nos lembretes com `{{manage}}`.
- Três passos: convidado 2 dias antes, convidado 3 horas antes, anfitrião 1 dia antes.
- Antecedência mínima, janela curta, uma pergunta própria e, se você cobra, pagamento ao agendar.
- Marque Não compareceu e olhe o número uma vez por mês.
