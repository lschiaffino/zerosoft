---
title: "Roadmap público: por que mostramos o que vem depois"
description: "Publicamos o roadmap com trimestres e critérios. Por que um projeto open source não tem motivo para esconder o que está construindo."
date: "2026-06-06"
author: "zerosoft"
tags: ["roadmap", "open source", "link", "coming soon"]
---

No SaaS tradicional, o roadmap é um documento interno que aparece uma vez por ano num keynote. O usuário descobre as features quando elas chegam, às vezes junto com um aumento de preço.

Com código aberto, qualquer um vê no que estamos trabalhando olhando o repositório. Esconder o roadmap não faria sentido, então publicamos tudo, com trimestres e critérios.

## O que estava no plano

Quando escrevemos este post, o Link era a única app disponível. O plano publicado era:

- **Track** (Q4 2026): gestor de projetos com issues e ciclos, alternativa ao Linear.
- **CRM** (Q1 2027): contatos, pipeline e atividades, com API pública desde o primeiro dia.
- **Cal** (Q2 2027): páginas de agendamento conectadas ao seu calendário.

As três saíram antes das janelas anunciadas. Hoje a suíte tem onze apps (CRM, Chat, Agents, Flow, Robots, Track, Link, Docs, Notes, Cal e Board), todas com o mesmo contrato: código aberto, self-host a $0 e zerosoft Cloud com plano grátis e cobrança pelo uso. O que vem agora está no roadmap público, em [/roadmap](/roadmap).

## Como escolhemos a ordem

Não jogamos dado. Três critérios, nesta ordem:

1. **Onde a fatura dói mais.** Medimos a razão entre o que o mercado cobra e o que a infraestrutura custa. Um CRM cobra cerca de $50 por usuário para guardar contatos numa tabela; um encurtador cobrava $35 por redirects de 300 bytes. Quanto mais absurda a margem, mais cedo atacamos.
2. **O que se constrói sobre o quê.** O Track precisa de uma base de projetos e permissões que CRM e Cal vão reutilizar depois. Construir nessa ordem é mais barato e mais rápido que o contrário.
3. **O que a comunidade pede.** Issues e discussões dos repositórios são públicas e têm peso. Se mil pessoas pedem o que estava em quinto lugar, ele sobe.

## Por que publicar é bom para nós (e para você)

Um roadmap público faz três coisas que um secreto não consegue:

- **Nos dá prazo.** Se dizemos "Q4 2026" em público, o Q4 2026 existe. Accountability de graça: um compromisso com desconhecidos organiza mais que cem reuniões internas.
- **Deixa você planejar.** Se a sua empresa está prestes a renovar um contrato de agendamento por dois anos, você merece saber se existe uma alternativa a caminho.
- **Convida à correção.** Um roadmap privado só é corrigido em retrospecto. Um público recebe argumentos antes do erro acontecer.

E a concorrência? Já sabe o que fazemos: o código está no GitHub. O único que fica de fora com um roadmap secreto é o usuário. Essa conta não fecha.

## O que não prometemos

Trimestres são trimestres, não dias. Você não vai ver "Track sai em 14 de outubro às 9h" porque não sabemos: fingir seria o primeiro hype de uma longa série. Se algo atrasar, você vai ler no mesmo roadmap, com o motivo. Sem post-mortem dramático: mudou, este é o motivo, esta é a nova janela.

Também não prometemos listas de features fechadas. A lista curta de cada produto está nos posts dedicados, mas o detalhe final é decidido pelo uso real e pela comunidade, não por um mockup de um ano atrás.

## Como acompanhar (e mudar)

O roadmap vive em zerosoft.ai/roadmap e no repositório: cada item aponta para as suas issues. Vote comentando, proponha features novas ou simplesmente construa: PRs são o jeito mais rápido de mover uma prioridade.

Publicar o plano nos obrigou a cumprir as datas. Continuamos fazendo assim.
