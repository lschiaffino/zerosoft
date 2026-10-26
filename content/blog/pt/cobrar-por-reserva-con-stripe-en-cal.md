---
title: "Cobrar por um agendamento com Stripe no Cal: guia passo a passo"
description: "Como cobrar consultas e sessões direto da sua página de agendamento com a sua própria conta Stripe: configuração, o que acontece se o convidado não paga e como funciona o reembolso."
date: "2026-10-26"
author: "zerosoft"
tags: ["cal", "agendamento", "pagamentos"]
---

Se você vende consultoria, aulas ou sessões de mentoria, já conhece a cena: alguém marca uma hora do seu tempo, não aparece e fica por isso mesmo. A solução mais comum é cobrar na hora de agendar. Um horário pago raramente é cancelado no mesmo dia.

O Calendly tem seu [guia de pagamento no agendamento](https://calendly.com/blog/pay-at-booking) e uma [página de pagamentos](https://calendly.com/learn/calendly-payments): você conecta Stripe ou PayPal, ativa a cobrança em cada tipo de evento e o dinheiro vai para a sua conta. Segundo a central de ajuda deles, a cobrança não está em todos os planos, então confira o seu antes de montar qualquer coisa.

Aqui vai a versão do Cal: como configurar, o que acontece nos casos incômodos e o que ainda não faz. Tudo o que segue vem do código, que é aberto.

## Como a cobrança funciona no Cal

O Cal não cobra por você nem fica no meio do caminho. Você usa a sua conta Stripe e entrega ao Cal uma chave secreta. O Cal a guarda criptografada e a usa para criar uma sessão do Stripe Checkout por agendamento. O dinheiro vai do Stripe para a sua conta. As taxas do Stripe são as do seu contrato com ele.

A sequência, do lado do convidado:

1. Escolhe um horário na sua página de agendamento e preenche o formulário.
2. O Cal salva o agendamento como pendente e **reserva o horário por 35 minutos**. Nesse intervalo ninguém mais pode pegá-lo.
3. O convidado paga no Stripe Checkout.
4. O Stripe avisa o Cal por webhook e o agendamento vira confirmado. Só então saem o email de confirmação e o evento no calendário.

Se o convidado volta sem pagar ou a sessão expira, o horário é liberado sozinho.

## Passo 1: conectar o Stripe

Vá em **Cal → Configurações → Pagamentos com Stripe**. São três dados:

- **Chave secreta** (começa com `sk_` ou `rk_`). Uma chave restrita (`rk_`) funciona e é a opção mais organizada: dê permissão só para Checkout Sessions e Refunds. O Cal mostra apenas os quatro últimos caracteres e se é modo teste ou live.
- **URL do webhook.** O Cal dá uma única por workspace. Copie.
- **Signing secret do webhook** (`whsec_`). Você o gera no Stripe, em Developers → Webhooks, colando essa URL.

No webhook do Stripe, marque estes quatro eventos: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` e `checkout.session.async_payment_failed`.

O Cal exige as duas peças, chave e signing secret, para aceitar agendamentos pagos. Se faltar o secret, os convidados não conseguem agendar esse evento e o editor avisa. É de propósito: sem webhook, um pagamento que o convidado conclui sem voltar à sua página poderia ficar cobrado com o agendamento já vencido.

Só o owner ou um admin do workspace pode alterar essa configuração.

## Passo 2: colocar preço em um tipo de evento

No editor do tipo de evento, aba **Pagamentos**, você escolhe preço e moeda. As moedas disponíveis são USD, EUR, ARS, BRL, MXN, CLP, COP e GBP. Com preço 0, o evento não é cobrado.

O Cal valida algumas regras ao salvar:

- O valor aceita `15000`, `15.000` ou `15.000,50`. Um único separador seguido de três dígitos é lido como milhar.
- CLP não tem centavos: informe um número inteiro.
- O Stripe impõe um mínimo por cobrança. O Cal o conhece para USD, EUR, GBP, BRL e MXN e rejeita um preço menor antes de o Checkout falhar em produção.

Teste primeiro com uma chave em modo teste e o cartão de teste do Stripe. Faça um agendamento completo, veja se a confirmação chega e cancele para ver o reembolso.

## O que acontece nos casos incômodos

Um fluxo de pagamento se testa pelo que dá errado, não pelo caminho feliz. Isto é o que o Cal faz:

- **O convidado não paga.** Aos 35 minutos a reserva do horário vence, o horário volta a ficar livre e o agendamento pendente é descartado.
- **Paga depois de a reserva vencer.** Se o horário continua livre, o agendamento é confirmado mesmo assim. Se outra pessoa pegou, o pagamento é reembolsado por inteiro de forma automática.
- **Meios de pagamento com atraso** (voucher em dinheiro, boleto). A reserva se estende por até 72 horas, nunca depois do início da reunião. Se o pagamento cair com a reunião já iniciada, é reembolsado.
- **Você cancela um agendamento pago.** Seja o anfitrião, o convidado ou a API, o Cal reembolsa o pagamento completo e marca como "reembolsado". Se o Stripe falhar nesse momento, o agendamento fica cancelado com o pagamento ainda como pago, para você reembolsar manualmente pelo Stripe.
- **Você apaga um tipo de evento com agendamentos futuros.** O Cal pede que você os cancele antes, e ao cancelar os convidados são avisados e os pagamentos reembolsados.
- **Eventos de outra origem.** O Cal ignora webhooks que não trazem seus metadados ou cujo valor e moeda não batem com o agendamento. Um Payment Link na mesma conta Stripe não consegue confirmar nem cancelar agendamentos.

## Uma política de cobrança que funciona

O Cal sempre reembolsa o valor total. Se você quer uma política mais fina, monte-a no desenho do evento:

- **Uma primeira sessão curta e paga.** Uma conversa de 20 ou 30 minutos a preço baixo filtra os curiosos sem afastar ninguém. A sessão longa é marcada depois.
- **Aviso mínimo longo.** Com 24 horas de aviso mínimo, quem agenda já sabe que não é para hoje. Veja [buffers, aviso mínimo e janela de agendamento](/blog/buffers-aviso-minimo-y-ventana).
- **Uma pergunta antes.** Uma pergunta obrigatória no formulário ("o que você quer resolver na sessão?") permite chegar preparado.
- **Um workflow de lembrete.** Um email 24 horas antes com o link da reunião e o de reagendamento reduz reclamações. Mais em [menos faltas em reuniões com o Cal](/blog/menos-ausencias-en-reuniones-con-cal).

## O que ainda não faz

O Cal é direto sobre suas lacunas. Hoje:

- Só há Stripe. **PayPal não existe.**
- Não há cupons nem descontos, nem pagamentos parciais ou sinal.
- Reembolsos parciais são feitos pelo Stripe, não pelo Cal.
- Não calcula impostos: isso fica na configuração da sua conta Stripe.

Se algum desses pontos for indispensável para você, o Calendly ou um Payment Link próprio resolvem hoje.

## Quanto custa

Self-host: $0, com a cobrança incluída, porque o core é AGPL com todas as funções. No zerosoft Cloud não há preço por usuário: paga-se por agendamento e armazenamento, e a taxa do Stripe é separada e vai direto para a sua conta Stripe. Para o raciocínio completo sobre por que um agendamento não deveria custar por assento, leia [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly).

## Checklist final

1. Chave restrita do Stripe em modo teste carregada no Cal.
2. Webhook criado com os quatro eventos e o signing secret colado.
3. Preço e moeda no tipo de evento, respeitando o mínimo.
4. Um agendamento de teste completo, confirmado e cancelado com reembolso.
5. Só então, chaves live e o preço real.
