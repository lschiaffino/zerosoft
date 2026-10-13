---
title: "Como contribuir com a zerosoft (sem pedir permissão)"
description: "O código é aberto, o roadmap é público e este blog sai em três idiomas. Veja como participar: issues, PRs, traduções, documentação e ideias de produto."
date: "2026-06-07"
author: "zerosoft"
tags: ["open source", "comunidade", "contribuir"]
---

O código da zerosoft é aberto, o roadmap é público e este blog sai em três idiomas. Tudo isso melhora quando alguém aparece e diz "isso eu consigo fazer melhor". Este post explica como participar: issues, PRs, traduções, documentação e ideias de produto.

## Reporte o que está quebrado

A contribuição mais subestimada do open source é uma boa issue. Se algo falha, conte para a gente:

- **O que você fez**, passo a passo, até quebrar.
- **O que você esperava** que acontecesse e o que aconteceu de fato.
- **O seu ambiente**: versão, sistema operacional, como você está rodando (self-host no seu VPS ou na nossa cloud).

Uma issue com esses três dados vale mais que dez comentários de "não funciona". E se o bug já foi reportado, some o seu caso: cada reprodução independente encurta o diagnóstico.

## Envie código

O repositório é público e os PRs são revisados de verdade. Antes de abrir um:

1. **Olhe as issues abertas.** Se a sua mudança já está sendo discutida, entre na conversa primeiro. Um PR surpresa de 2.000 linhas é difícil de revisar; um pequeno, alinhado com uma issue, entra rápido.
2. **Respeite o estilo do projeto.** Código se lê muito mais do que se escreve: nomeie as coisas como nós nomeamos, comente o que nós comentamos, nada mais.
3. **Um PR, uma mudança.** Se você corrige um bug e aproveita para reformatar metade do repositório, o PR fica impossível de revisar. Dois PRs é melhor.

Não precisa ser sênior. Boa parte dos PRs aprovados são typos, validações, testes e casos de borda que ninguém tinha testado. O Link roda sobre SQLite: você baixa, executa e tem o ambiente local funcionando em uma tarde.

## Traduções e documentação

A zerosoft existe em três idiomas: português, espanhol e inglês. A interface, a documentação em /docs e este blog. É muito texto, e sempre tem alguma frase que soa a tradução automática disfarçada.

Se você fala dois desses idiomas, sua contribuição é direta: marque a frase que soa estranha e proponha uma melhor. As traduções não vêm de uma equipe de localização na Califórnia: vêm de gente que leu algo e fez careta.

O mesmo vale para a documentação. A API v1 está documentada endpoint por endpoint, mas documentação nunca está pronta: exemplos que faltam, erros comuns que ninguém explicou, um tutorial de self-hosting para o seu caso. Se você travou em algum ponto de /docs, esse ponto é o seu PR.

## Ideias, não promessas

Hoje a suíte tem onze apps, e a ordem em que elas chegaram saiu de issues e conversas com quem usa o produto. Se você quer influenciar o que é construído, o lugar é esse: conte qual ferramenta cara está cobrando demais de você e o que a versão livre precisaria fazer para substituí-la.

O que não prometemos: datas exatas, features sob encomenda, suporte 24/7. Somos um projeto pequeno com princípios grandes. O que prometemos é ler tudo.

## O combinado

O código que você contribuir fica sob AGPLv3. Essa licença não pode ser revogada para o que já foi publicado, então, se a zerosoft desaparecer amanhã, o software continua disponível para quem quiser rodá-lo.
