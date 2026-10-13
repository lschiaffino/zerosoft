---
title: "Formulários de roteamento no Cal: cada lead na reunião certa"
description: "Algumas perguntas antes do calendário e cada visitante cai no event type certo. Como montar routing forms no Cal, como as regras são avaliadas e onde estão os limites."
date: "2026-08-03"
author: "zerosoft"
tags: ["cal", "agendamento", "vendas"]
---

Um único link de agendamento para todo mundo parece simples até seu melhor vendedor sênior passar a terça à tarde numa call com um estudante que queria desconto. Ou seu prospect enterprise cair num horário de 15 minutos de "papo rápido" com um júnior.

A solução é velha e sem graça: fazer algumas perguntas *antes* de mostrar o calendário e mandar cada pessoa para o lugar certo. No Cal isso se chama **routing forms**. Veja como montar um e como o Cal decide, exatamente, para onde vai cada visitante.

## As peças

Um routing form tem três partes:

- **Perguntas.** Os campos que o visitante preenche. Três tipos: **Text**, **Select** (um dropdown com até 50 opções) e **Yes / No**. Cada pergunta tem um label (o que as pessoas veem), uma key (à qual as regras se referem, em minúsculas, tipo `company_size`) e pode ser obrigatória.
- **Regras.** Cada regra diz: *se a pergunta X* (**is**, **is not**, **contains** ou **is answered**) *o valor Y, mande para o event type Z*.
- **Um event type padrão.** Para onde vão as pessoas se nenhuma regra bater.

O form tem sua própria URL pública, `/r/<seu-handle>/<slug>`, que você compartilha no lugar de um link de agendamento. Quando o visitante envia, o Cal avalia as regras e redireciona para `/book/<seu-handle>/<event-slug>` do event type correspondente.

## Montando um, passo a passo

Um caso hipotético: uma agência B2B de 6 pessoas que vende projetos de site e também recebe um fluxo constante de gente pedindo suporte para sites que já existem.

**1. Crie primeiro os event types de destino.** Routing forms apontam para event types, então eles precisam existir. Por exemplo:

- `discovery-call`: 45 min, com os dois fundadores num pool round-robin,
- `intro-call`: 20 min, com um account manager júnior,
- `support-triage`: 15 min, com quem cuida do suporte.

**2. Crie o form.** Vá em **Cal → Routing forms → New routing form**. Dê um título e um slug, por exemplo `fale-conosco`.

**3. Adicione as perguntas.**

- `name`: Text, obrigatória
- `email`: Text, obrigatória
- `need`: Select: *Site novo*, *Redesign*, *Suporte para um site existente*
- `budget`: Select: *Menos de 5k*, *5k–20k*, *Mais de 20k*

**4. Adicione as regras, em ordem.**

1. `need` **is** *Suporte para um site existente* → `support-triage`
2. `budget` **is** *Mais de 20k* → `discovery-call`
3. `budget` **is** *5k–20k* → `discovery-call`

**5. Defina o padrão**: `intro-call`.

Agora quem tem um site existente sempre vai para o suporte, independente do orçamento. Projetos grandes vão para os fundadores. O resto vai para a intro de 20 minutos.

## Como as regras são avaliadas de verdade

Esta é a parte que a maioria das documentações explica correndo. Isto é o que o `lib/calendar-routing.ts` faz:

- **As regras rodam em ordem, de cima para baixo. A primeira que bate vence.** As seguintes nem são olhadas. Por isso a regra de suporte vem primeiro no exemplo: a ordem é o seu sistema de prioridades.
- **As comparações ignoram maiúsculas e espaços nas pontas.** "Mais de 20K " bate com "mais de 20k". Útil em campos de texto, onde as pessoas digitam o que querem.
- **`contains`** procura um trecho do texto, também sem diferenciar maiúsculas. Serve para perguntas de texto: `company` contains `universidade`.
- **`is answered`** bate quando a resposta não está vazia e não significa "não": `false`, `0`, `no` ou vazio não contam. Numa pergunta Yes / No, na prática é "é sim".
- **Uma resposta ausente nunca bate com `is not`.** Se alguém pulou uma pergunta opcional, `budget is not Menos de 5k` *não* dispara. Uma regra não consegue comparar contra o nada, então é pulada. Isso pega muita gente de surpresa, então desenhe pensando nisso: torne a pergunta obrigatória ou roteie com condições positivas.
- **Destinos inativos são pulados.** Se uma regra aponta para um event type desativado ou apagado, o Cal passa para a próxima regra em vez de mandar o visitante para uma página morta. Com o padrão acontece o mesmo.
- **Sem rota, sem redirect.** Se nada bate e não há padrão ativo, o visitante vê "Nenhuma página de reserva corresponde às suas respostas." Defina sempre um padrão.

As perguntas obrigatórias também são validadas no servidor, não só no navegador.

## O que faz funcionar melhor

**Use as keys `name` e `email`.** Se o form tem perguntas com exatamente essas keys, o Cal passa as respostas como `?name=…&email=…` para a página de agendamento, e o visitante não digita duas vezes. As outras respostas hoje não vão junto para a reserva: se você precisa delas no booking, adicione-as também como perguntas personalizadas do event type.

**Combine com round-robin.** A regra escolhe o *event type*; o pool de hosts do event type escolhe a *pessoa*. Roteamento mais [round-robin](/blog/round-robin-con-cal) é como você chega em "leads enterprise fazem rodízio entre os dois seniores, o resto faz rodízio entre os demais".

**Mantenha a lista de regras curta.** De três a seis regras cobrem a maioria dos casos reais. Se você tem vinte, provavelmente precisa de dois forms.

**Teste como visitante.** Abra a URL pública numa janela anônima e percorra cada caminho. Não há simulador de regras na interface, então essa é a sua suíte de testes.

## O lado da API

O form público se apoia numa API pequena que você pode chamar do seu próprio frontend, se preferir montar um formulário sob medida:

```bash
# Form definition (questions, types, options — no routing targets exposed)
curl https://zerosoft.ai/api/calendar/routing/<form-id>/route

# Evaluate answers
curl -X POST https://zerosoft.ai/api/calendar/routing/<form-id>/route \
  -H "Content-Type: application/json" \
  -d '{"answers": {"name": "Ana", "email": "ana@example.com", "need": "Redesign", "budget": "Over 20k"}}'
# → {"eventTypeSlug": "discovery-call", "bookPath": "/book/your-handle/discovery-call"}
```

O `GET` propositalmente não revela para onde cada regra manda. Os dois endpoints têm rate limit por IP.

## O que os routing forms (ainda) não fazem

Sendo direto sobre os limites:

- **Cada regra tem uma condição só.** Não há grupos AND/OR. Dá para aproximar um AND ordenando bem as regras, mas lógica complexa fica desajeitada.
- **Os destinos são só os seus próprios event types.** Não dá para rotear para uma URL externa nem para o event type de outra pessoa.
- **Não consulta o CRM.** Os planos pagos do Calendly conseguem rotear com base em dados do seu CRM, tipo "cliente existente vai para o account owner dele". O Cal roteia só com o que o visitante digitou.
- **Sem analytics do form.** Você vê as reservas, não quantas pessoas preencheram o form e desistiram.

Para um time pequeno que só quer as pessoas certas nas calls certas, costuma bastar. Para um time de receita com regras de território complexas, seja honesto consigo mesmo sobre se regras de uma condição vão dar conta.
