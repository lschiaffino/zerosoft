---
title: "Pesquisa NPS no Forms: modelo, lógica e como ler o resultado"
description: "Como montar uma pesquisa NPS no Forms com o modelo pronto: pergunta de 0 a 10, acompanhamento conforme a nota, campos ocultos e como o resultado é calculado."
date: "2026-11-15"
author: "zerosoft"
tags: ["forms", "typeform", "guia"]
---

Uma pesquisa NPS tem uma pergunta: qual a chance de você recomendar o produto, de 0 a 10. O número sozinho diz pouco. O que ajuda vem depois, quando você pergunta o motivo e alguém do time lê a resposta.

O Typeform tem [um guia sobre NPS](https://www.typeform.com/guides/net-promoter-score) que explica a escala e recomenda fechar com um "por quê". Aqui vai a versão para o Forms, o app de formulários da zerosoft: o que o modelo traz, como ajustar e como ler o resultado sem uma planilha à parte.

## A conta, com números

Respostas 9 e 10 são promotores, 7 e 8 são neutros, de 0 a 6 são detratores. O NPS é a porcentagem de promotores menos a de detratores, de -100 a 100.

Um exemplo inventado para ver a mecânica: 50 respostas, 25 promotores, 15 neutros e 10 detratores. Promotores 50%, detratores 20%, NPS 30. Os neutros não somam nem subtraem, mas entram no total.

O Forms usa esses mesmos cortes e mostra o resultado na aba **Resumo**: a nota e quantos promotores, neutros e detratores existem. O cálculo é feito sobre respostas completas.

## Passo 1: comece pelo modelo

No Forms escolha **Novo formulário** e, em **Começar por**, o modelo **Pesquisa NPS**. Ative **Com lógica** se quiser as regras prontas. Dê um nome, escolha o idioma do formulário e clique em **Criar formulário**.

O modelo traz quatro perguntas:

1. A pergunta da nota, obrigatória, numa escala de 0 a 10 com "Pouco provável" e "Muito provável" nas pontas.
2. Um texto longo para quem deu 6 ou menos: "Sentimos muito. O que devemos corrigir primeiro?"
3. Outro para quem deu 7 ou 8: "O que faltaria para ser um 10?"
4. Outro para quem deu 9 ou 10: "Ótimo! Do que você mais gosta?"

No final há um email opcional para poder responder à pessoa. A lógica do modelo leva cada um à sua pergunta de acompanhamento e depois todos convergem no email.

## Passo 2: entenda a lógica para poder mudá-la

Abra a aba **Lógica** do editor. Você verá regras na pergunta da nota, avaliadas em ordem:

- Se a nota **é no máximo** 6, saltar para a pergunta dos detratores.
- Senão, se a nota **é no máximo** 8, saltar para a dos neutros.
- Senão, sempre: saltar para a dos promotores.

Os saltos só vão para a frente, então a ordem na aba **Perguntas** importa: as três perguntas de acompanhamento precisam vir depois da nota.

Uma variante que serve a times pequenos: se você só quer entender os detratores, mande neutros e promotores direto para um final de agradecimento e poupe uma pergunta deles. Com **Adicionar regra** e a ação **saltar para** um final, você resolve sem código.

Se quiser uma escala de NPS numa pergunta própria, em **Perguntas** escolha uma escala de opinião e marque **Net Promoter Score (0 a 10)**. Isso fixa o intervalo de 0 a 10 e faz o Resumo calcular a nota.

## Passo 3: saiba de onde vem cada resposta

Um NPS global esconde muita coisa. Para separar por plano, canal ou campanha, use **Campos ocultos**: nomes separados por vírgula que o Forms lê do link. Se você cadastrar `plano` e `origem`, envia o link como `/f/seu-formulario?plano=pro&origem=email` e cada resposta guarda esses valores junto das respostas. Eles também vão no webhook.

Um uso concreto: no email de pós-compra, monte o link com o plano de cada cliente. Depois filtre as respostas e compare.

## Passo 4: avisos e automação

Em **Configurações** do formulário, **Notificações** permite avisar pessoas do workspace dentro da zerosoft e mandar email para até 10 endereços. Basta para o suporte ver cada resposta nova na hora.

Para ir além, cada resposta dispara o evento `forms.response.submitted` no Flow, e o formulário pode ter um webhook assinado com o header `Zerosoft-Signature`. Um uso típico: um flow que, com nota 6 ou menos, cria uma tarefa de acompanhamento para alguém escrever ao cliente nesta semana.

## Passo 5: compartilhe

A aba **Compartilhar** tem o link público, um iframe, um embed na página que cresce com o formulário e um botão com popup. Há também um código QR para imprimir. Você pode encerrar o formulário por data ou por número de respostas, útil para uma pesquisa com prazo.

## Como ler o resultado

- Leia os comentários antes do número. Três detratores dizendo a mesma coisa valem mais que um ponto de NPS.
- Compare com você mesmo, mês contra mês. Um NPS isolado diz pouco sem referência.
- Com poucas respostas a nota oscila muito. Com 20 respostas, um único detrator move o resultado 5 pontos.
- Veja o abandono por pergunta no Resumo: se muita gente sai no texto longo, encurte ou torne opcional.

## O que ainda falta

O Forms ainda não tem testes A/B, etiquetas nas respostas nem pagamentos dentro do formulário. Não há integração nativa com o Google Sheets: o webhook e o Flow cobrem isso. A API pública do Forms é somente leitura. Também não há domínio próprio para formulários.

## Custo

Self-host a $0 sob AGPLv3, com todas as funções do Forms. No zerosoft Cloud há plano gratuito para começar e depois você paga por uso; os assentos não são cobrados, então incluir alguém do suporte para ler respostas não muda a conta. Mais em [Forms](/products/forms) e na [alternativa ao Typeform](/compare/typeform-alternative).
