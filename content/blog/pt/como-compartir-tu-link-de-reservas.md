---
title: "Como compartilhar seu link de agendamento para que as pessoas usem"
description: "Onde colocar o link do Cal (email, assinatura, site, campanhas), como preencher dados antes, medir de onde veio cada reserva e quando vale um link secreto ou de uso único."
date: "2026-11-06"
author: "zerosoft"
tags: ["cal", "agendamento", "guia"]
---

Montar o tipo de evento leva dez minutos. Fazer as pessoas usarem leva mais, porque um link de agendamento mal posicionado convive com o velho "terça funciona?" por email. Este guia reúne os lugares onde vale colocá-lo, o que escrever ao lado e quais ajustes do Cal ajudam em cada caso.

## 1. Escolha o link certo

O Cal oferece três formas de link, todas com o mesmo formato:

- `https://zerosoft.ai/pt/book/seu-handle` é seu perfil público e lista todos os seus tipos de evento ativos.
- `https://zerosoft.ai/pt/book/seu-handle/demo-30` abre um tipo de evento específico.
- Um tipo de evento **secreto** pode ser reservado por quem tem o link, mas não aparece no seu perfil. Você ativa no editor do tipo de evento.

A regra prática: para o público geral, o link do evento específico. O perfil com a lista serve para a bio de redes sociais, onde a pessoa ainda não sabe o que quer. Se o seu perfil tem seis tipos de evento, quem chega precisa decidir antes de reservar, e decidir atrapalha.

Tipos secretos, de uso único e enquetes de horário levam `noindex`, então não aparecem em buscadores.

## 2. Em um email: uma frase e o link

Um link solto como único conteúdo da mensagem parece automático. Funciona melhor uma frase com contexto e uma saída:

> Oi Ana, para ver o quadro com a sua equipe bastam 30 minutos. Escolha o horário que ficar bom para você aqui: https://zerosoft.ai/pt/book/lau/demo-30
>
> Se nenhum servir, responda com dois horários e resolvemos por aqui.

O segundo parágrafo importa. Há quem não queira usar o link no primeiro contato, e oferecer outra porta evita que a mensagem fique sem resposta. Clientes de email não executam widgets, então em um email vai sempre o link em texto ou um botão, nunca um embed. [O Calendly explica o mesmo na central de ajuda](https://help.calendly.com/hc/en-us/articles/31618986451863-How-to-add-Calendly-to-an-email-or-email-template): o agendador é linkado no email, não incorporado.

## 3. Preencha nome, email e respostas

Se você já sabe quem é a pessoa (vem de um CRM, de uma lista, de um formulário), não a faça digitar de novo. A página de reservas lê parâmetros da URL:

```
https://zerosoft.ai/pt/book/lau/demo-30?name=Ana%20Paz&email=ana%40acme.com
```

Os dois campos chegam preenchidos no formulário. O mesmo vale para perguntas próprias: se o seu tipo de evento tem uma pergunta com o nome interno `empresa`, o parâmetro `empresa=Acme` a preenche. Em listas e opções, o valor só é usado se coincidir com uma das opções que você definiu.

Dois limites: os valores são cortados (200 caracteres para nome e email, 2000 para respostas) e o convidado ainda pode editar nome e email, então o preenchimento economiza digitação e não valida identidade.

Se você usa o CRM da zerosoft, o botão **Book meeting** de um contato ou negócio gera esse tipo de link, e ao reservar a reunião fica registrada na ficha. Mais em [workflows do CRM](/blog/workflows-crm-tareas-de-seguimiento).

## 4. Marque de onde vem cada reserva

Se o mesmo link está na assinatura, na newsletter e em um anúncio, você não saberá qual traz reservas. O Cal guarda os cinco parâmetros `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` e `utm_content` que o link tiver e os anexa à reserva. Depois eles chegam ao anfitrião e aos webhooks.

Uma convenção simples, uma por canal:

| Onde | Link |
|---|---|
| Assinatura de email | `.../demo-30?utm_source=assinatura&utm_medium=email` |
| Newsletter de outubro | `.../demo-30?utm_source=newsletter&utm_medium=email&utm_campaign=outubro` |
| Bio do LinkedIn | `.../demo-30?utm_source=linkedin&utm_medium=bio` |
| Botão na página de preços | `.../demo-30?utm_source=web&utm_content=precos` |

O Cal só guarda essas cinco chaves, como texto de uma linha com até 200 caracteres. Qualquer outro parâmetro que não seja um campo do formulário é ignorado, então não serve para passar dados arbitrários. Se o site é seu, o [embed do Cal](/blog/embeber-cal-en-tu-sitio) mantém o visitante na sua página.

## 5. Quando usar um link de uso único

Para uma pessoa específica, um link secreto com horários limitados é mais organizado que o perfil público. Há duas opções:

- **Link de uso único.** Para de funcionar depois da primeira reserva. Se for encaminhado, a página mostra que expirou. Para distribuir reuniões entre uma equipe, veja [round-robin com o Cal](/blog/round-robin-con-cal).
- **Reunião única.** Você escolhe os horários exatos que oferece, mesmo fora da sua agenda semanal, e compartilha esse link. Serve para uma revisão pontual com um cliente que precisa de um dia fora do comum.

## 6. Checklist antes de enviar

Abra o link em uma janela anônima e percorra o fluxo como convidado:

1. Os horários aparecem no seu fuso e no de quem reserva (teste com outro fuso; mais em [fusos horários em agendas](/blog/zonas-horarias-en-agendas)).
2. O formulário pede o mínimo de que você precisa.
3. Chega o email de confirmação com o `.ics` e o link para reagendar.
4. No celular, a página cabe sem rolagem horizontal.
5. Você fez uma reserva de teste e cancelou, para o horário ficar livre.

## O que ainda falta

Para você comparar com o que usa hoje: o Cal não gera QR code do link de agendamento, e os lembretes saem só por email. Para um QR, use o [gerador de QR code](/pt/tools/qr-code-generator) das ferramentas do site e aponte para a sua URL de reservas.

## Resumo

- Link de um evento específico para o público, perfil para as bios.
- Em um email: uma frase, o link e uma segunda saída.
- `?name=` e `?email=` preenchem, e as perguntas próprias também, pelo nome interno.
- Cinco chaves `utm_*` viajam com a reserva: use uma convenção por canal.
- Secreto, uso único ou reunião única quando é para uma pessoa.
