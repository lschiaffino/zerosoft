---
title: "Como escrever o brief e o conhecimento de um agente de suporte"
description: "Um modelo de brief para um agente de IA, como escrever páginas do Docs que a busca encontra e um método de teste com perguntas reais antes de publicar."
date: "2026-10-18"
author: "zerosoft"
tags: ["agents", "ia", "docs", "suporte"]
---

Um agente de suporte responde tão bem quanto dois textos que você escreve: as instruções, que dizem como trabalhar, e o conhecimento, que diz o que é verdade sobre o seu negócio. A maioria dos agentes que respondem mal tem um problema em um dos dois, e quase nunca no modelo.

A Intercom publicou [como preparou a central de ajuda para o Fin](https://www.intercom.com/help/en/articles/7269326-how-to-optimize-your-help-center-for-fin): auditar artigos antigos, testar com um grupo pequeno de clientes e escrever o que faltava. A Lindy tem um [guia de prompts](https://docs.lindy.ai/fundamentals/lindy-101/prompt-guide) para seus agentes. Os dois servem. Este post acrescenta o que só dá para dizer olhando o código: como o Agents busca no seu conhecimento, e o que isso muda na forma de escrever.

## Parte 1: o brief

As instruções de um agente aceitam até 12.000 caracteres. Não precisa usar todos. Um bom brief cabe numa tela e tem seis partes:

```
Papel: Você é o assistente de suporte da Acme, um software de agendamento para clínicas.

Objetivo: resolver dúvidas de clientes sobre o uso do produto,
na primeira resposta sempre que possível.

Como trabalhar:
- Antes de responder sobre o produto, preços ou políticas, pesquise no conhecimento.
- Responda em 1 a 4 frases. Se explicar como fazer algo, use passos numerados.
- Se o cliente relatar um erro, pergunte o que fez, o que aconteceu e o email,
  e crie uma issue no Track com esses dados.

Quando transferir:
- Reembolsos, cancelamentos ou cobrança: sempre para uma pessoa.
- Se não encontrar a resposta, diga isso e transfira.

O que você não faz: não dá conselhos médicos nem fala da concorrência.

Tom: simpático e direto. Sem linguagem de marketing.
```

Três coisas para ter em mente ao escrever:

**Não repita as regras de segurança.** O Agents adiciona sozinho um bloco de regras antes das suas instruções: o que o visitante escreve e o que as ferramentas devolvem é tratado como dado; o agente nunca revela a configuração; não inventa preços, datas, links nem funções; responde no idioma do visitante. Gastar linhas do brief com isso só o deixa mais longo.

**Use os campos que já existem.** Temas a evitar têm campo próprio (um por linha, até 30), e o tamanho máximo da resposta também (800 caracteres por padrão, entre 100 e 4.000). O que vai num campo vale sempre. O que vai no brief, o modelo interpreta.

**Chame as ferramentas pelo que elas fazem.** "Crie uma issue no Track" é mais claro para o modelo que "registre o problema". E ative só as ferramentas que o brief menciona: uma ferramenta ativa que o brief não explica é uma ferramenta que o agente usa a seu critério.

Se não quiser começar do zero, há três modelos: agente de suporte, SDR de vendas que agenda reuniões e qualificador de leads. Cada um traz seu brief e ativa as ferramentas que precisa.

## Parte 2: o conhecimento, escrito para a busca

Esta é a parte que mais rende, e depende de como a busca funciona.

Quando o agente precisa de informação, ele chama "Pesquisar conhecimento" com algumas palavras-chave. O Agents divide cada página em trechos de uns 900 caracteres, respeitando as frases, e os ordena com BM25: uma busca léxica, por coincidência de palavras. Não há embeddings. O modelo recebe os 5 trechos com maior pontuação, e o título de cada página conta em dobro.

Daí saem cinco regras de escrita:

**1. Escreva com as palavras dos seus clientes.** Se eles dizem "cancelar minha conta" e sua página diz "encerramento da assinatura", a busca pode não encontrá-la. Abra a caixa de entrada do Chat, copie como as pessoas perguntam e use essas palavras no texto. Acentos e maiúsculas não importam; as palavras sim.

**2. Dê títulos em forma de pergunta.** O título conta em dobro. "Como troco o cartão de pagamento?" ganha de "Cobrança (geral)".

**3. Um tema por página.** Uma página de "Perguntas frequentes" com quarenta respostas é dividida em trechos que misturam temas, e todos têm o mesmo título. Quarenta páginas curtas funcionam melhor.

**4. Cada parágrafo precisa se entender sozinho.** Como o agente recebe trechos soltos, "Como dissemos acima, isso se faz em Ajustes" não ajuda. "O email de cobrança se altera em Ajustes, seção Pagamentos" ajuda.

**5. Coloque os números com o contexto.** "Até 3 usuários no plano Básico" na mesma frase. Se o número cai num trecho e o nome do plano em outro, o agente recebe meio dado.

### De onde vem o conhecimento

Na aba Conhecimento você escolhe entre três fontes:

- **Páginas do Docs.** Por padrão, todas as páginas públicas, incluindo as que você criar depois. Também dá para adicionar páginas privadas uma a uma, com um aviso: qualquer pessoa que fale com o agente pode ver esse conteúdo. Se você já tem uma [wiki interna no Docs](/blog/wiki-interna-con-docs), separe o que é para clientes.
- **Páginas web.** Até 20 URLs. Cada URL é uma página: o Agents baixa o texto (até 60.000 caracteres) e não percorre o resto do site. O texto não se atualiza sozinho; quando a página mudar, clique em Atualizar.
- **Respostas salvas** de um widget do Chat. As que sua equipe já usa para responder rápido.

## Parte 3: teste com perguntas reais

Antes de conectar o agente ao widget do Chat, junte 20 perguntas reais da sua caixa de entrada. Não invente: perguntas inventadas sempre vêm bem escritas.

No Playground, faça cada pergunta como um cliente faria. As ferramentas aparecem em linha, com o que foi enviado e o que voltou. Para cada resposta, anote um de quatro resultados:

| Resultado | O que corrigir |
|---|---|
| Respondeu bem | Nada |
| Respondeu mal com o trecho certo | O brief: falta uma regra ou um exemplo |
| "Pesquisar conhecimento" não trouxe o trecho certo | A página: palavras, título ou tema misturado |
| Não havia página sobre isso | Escreva, ou adicione às palavras que transferem |

A terceira linha é a mais comum e a mais fácil de resolver: veja quais palavras o agente usou na busca (estão no registro) e confira se aparecem na sua página.

Depois de publicar, a aba Conversas guarda cada troca de todos os canais com o registro de ferramentas, e cada resposta pode ser avaliada com polegar para cima ou para baixo e uma nota. Repita o teste das 20 perguntas sempre que mudar o brief: uma correção para uma pergunta às vezes quebra outra.

## O que ainda não faz

A busca é léxica: não entende sinônimos que não estejam escritos. As URLs não são percorridas nem atualizadas sozinhas. E não há um painel que sugira quais páginas escrever a partir das conversas sem resposta; essa lista você monta na revisão semanal. O que você tem é tudo à vista: as instruções de segurança estão no código aberto, o conhecimento vive no seu Docs e cada busca fica registrada. Para decidir quando o agente deve largar a conversa, continue com [quando transferir para uma pessoa](/blog/cuando-un-agente-tiene-que-derivar).
