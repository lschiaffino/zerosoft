---
title: "Roadmap público: o que vem depois do Link"
description: "O Link já está no ar. Track, CRM e Cal vêm a seguir. Publicamos o roadmap inteiro — trimestres e critérios inclusos — porque usuários são parceiros, não plateia."
date: "2026-06-06"
author: "Zerosoftware"
tags: ["roadmap", "open source", "link", "coming soon"]
---

No SaaS tradicional, o roadmap é um documento confidencial que vaza uma vez por ano num keynote, entre fumaça e música épica. O usuário descobre as features quando elas aparecem na fatura.

Não conseguimos operar assim. O código é aberto: qualquer um vê no que trabalhamos olhando os repositórios. Esconder o roadmap sendo open source seria como pendurar cortinas numa casa de vidro. Então publicamos tudo — trimestres e critérios incluídos.

## O que vem, em ordem

- **Track — Q4 2026.** Nosso gestor de projetos. Issues, cycles, keyboard-first, roadmaps. Pense no Linear, mas open source e a $0 em self-host. Está em construção agora.
- **CRM — Q1 2027.** Contatos, pipeline, atividades. O HubSpot que não cobra por contato guardado. API-first, como tudo o que fazemos: sai com a API pública documentada desde o primeiro dia.
- **Cal — Q2 2027.** Agendamento. Sua disponibilidade, um link público, eventos caindo na sua agenda. O Calendly que não cobra $12 por usuário por dois componentes.

Os três herdam o contrato do Link: código aberto, self-host grátis com SQLite num VPS de $5, cloud ao custo real e exportação completa em JSON/CSV/API.

## Como escolhemos a ordem

Não jogamos dado. Três critérios, nesta ordem:

1. **Onde a fatura dói mais.** Medimos a razão entre o que o mercado cobra e o que a infraestrutura custa. Um CRM cobra cerca de $50 por usuário para guardar contatos numa tabela; um encurtador cobrava $35 por redirects de 300 bytes. Quanto mais absurda a margem, mais cedo atacamos.
2. **O que se constrói sobre o quê.** O Track precisa de uma base de projetos e permissões que CRM e Cal vão reutilizar depois. Construir nessa ordem é mais barato e mais rápido que o contrário.
3. **O que a comunidade pede.** Issues e discussões dos repositórios são públicas e têm peso. Se mil pessoas pedem o que estava em quinto lugar, ele sobe.

## Por que publicar é bom para nós (e para você)

Um roadmap público faz três coisas que um secreto não consegue:

- **Nos dá prazo.** Se dizemos "Q4 2026" em público, o Q4 2026 existe. Accountability de graça: um compromisso com desconhecidos organiza mais que cem reuniões internas.
- **Deixa você planejar.** Se a sua empresa está prestes a renovar um contrato de agendamento por dois anos, você merece saber que no Q2 2027 existe uma alternativa a $0. Esconder isso seria fazer com você o dano que criticamos nos outros.
- **Convida à correção.** Um roadmap privado só é corrigido em retrospecto. Um público recebe argumentos antes do erro acontecer.

E a concorrência? Já sabe o que fazemos: o código está no GitHub. O único que fica de fora com um roadmap secreto é o usuário. Essa conta não fecha.

## O que não prometemos

Trimestres são trimestres, não dias. Você não vai ver "Track sai em 14 de outubro às 9h" porque não sabemos — fingir seria o primeiro hype de uma longa série. Se algo atrasar, você vai ler no mesmo roadmap, com o motivo. Sem post-mortem dramático: mudou, este é o motivo, esta é a nova janela.

Também não prometemos listas de features fechadas. A lista curta de cada produto está nos posts dedicados, mas o detalhe final é decidido pelo uso real e pela comunidade, não por um mockup de um ano atrás.

## Como acompanhar (e mudar)

O roadmap vive em zerosoftware.ai/roadmap e nos repositórios: cada item aponta para as suas issues. Vote comentando, proponha features novas ou simplesmente construa — PRs são o jeito mais rápido de mover uma prioridade.

O Link foi a prova de que o modelo funciona: software grátis, nuvem ao custo, zero lock-in. Track, CRM e Cal são a prova de que não foi coincidência. A ordem está definida, as janelas estão ditas e o quadro é público. A gente se vê no Q4.
