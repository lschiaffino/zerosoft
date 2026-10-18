---
title: "Respostas salvas: cinco regras de tom e doze modelos para suporte"
description: "Como transformar um guia de tom de suporte em regras que dá para conferir frase por frase, e doze respostas salvas prontas para o Chat, com as ações automáticas que vale associar a cada uma."
date: "2026-10-18"
author: "zerosoft"
tags: ["chat", "suporte", "modelos", "playbook"]
---

Respostas salvas têm má fama porque muitas soam robóticas. Soam assim quando ninguém as revisou contra uma ideia clara de como o time quer soar.

A Intercom publicou o [PREACH](https://www.intercom.com/blog/preach-framework-for-customer-support-tone/), o modelo de tom que o time de suporte deles usa para revisar conversas: seis traços (orgulhoso, responsável, empático, articulado, conciso, humano). É uma boa lista para revisão entre pares. Às seis da tarde, com trinta conversas abertas, um adjetivo ajuda pouco. Este post transforma o tom em cinco regras que dá para conferir frase por frase e traz doze respostas salvas escritas com essas regras, prontas para carregar no Chat.

## Cinco regras que dá para conferir

1. **Diga o próximo passo e quando.** "Vou verificar e te respondo antes das 17h" pode ser cumprido ou não. "Estamos vendo" não dá para medir.
2. **Conte o que você fez.** "Testei na sua conta e reproduzi o erro" informa. "Entendemos sua frustração" não acrescenta nada para ninguém.
3. **Uma pergunta por mensagem.** Se você precisa de três dados, peça numa lista numerada e explique para que serve cada um.
4. **Um pedido de desculpas, concreto.** "Desculpe, a cobrança duplicada foi erro nosso" uma vez. Três "desculpe o transtorno" seguidos soam como roteiro.
5. **Prometa só o que você controla.** Se a correção depende de outro time, prometa o próximo aviso. A data da correção quem dá é esse time.

Antes de salvar uma resposta, passe pelas cinco. Se falhar em uma, reescreva.

## Como funcionam no Chat

- Cada widget tem sua lista de **respostas salvas**: nome, atalho (sai do nome) e texto.
- Numa conversa, você digita `/` e parte do atalho ou do nome, escolhe na lista e o texto cai na caixa de resposta. Dá para editar antes de enviar.
- Em **Ações automáticas (Avançado)**, cada resposta pode mudar o status da conversa (aberta, pendente ou resolvida), atribuir a alguém ou a quem usa, adicionar tags ou adiar por algumas horas. As ações rodam ao enviar, não ao escolher a resposta: se você desistir e não mandar nada, a conversa fica como estava.
- Uma resposta salva enviada por uma pessoa conta como primeira resposta para o SLA. A do bot não conta (explicamos em [SLAs de suporte com o Chat](/blog/slas-de-soporte-con-chat)).

Dois cuidados. As respostas salvas ainda não têm variáveis: não existe `{{nome}}`, então nos modelos abaixo as lacunas vão entre colchetes e a pessoa preenche antes de enviar. E o bot também lê suas respostas salvas. No modo "Respostas salvas" (e no modo IA quando o modelo falha) o bot escolhe a mais parecida com a pergunta e manda do jeito que está, colchetes incluídos. Se o seu bot lê respostas salvas, revise cada uma pensando que ela pode sair sozinha: ou escreva sem lacunas, ou passe o bot para o modo "Páginas de docs".

## Doze modelos

Cada um com seu atalho e as ações que associaríamos.

**1. `/recebido`** (sem ações)
> Obrigado por escrever. Já estou vendo isso e te respondo aqui antes das [hora].

**2. `/preciso-dados`** (status: pendente)
> Para verificar, preciso de duas coisas:
> 1. O email da conta.
> 2. Um print do que aparece na sua tela.
> Com isso consigo achar seu caso direto.

**3. `/reproduzido`** (tag: bug)
> Segui os mesmos passos e vi o mesmo erro, então o problema é nosso. Já passei para o time que corrige. Te escrevo aqui quando houver novidade, nem que seja para dizer que continua aberto.

**4. `/corrigido`** (status: resolvida)
> Está corrigido: [o que mudou]. Se acontecer de novo, responda nesta conversa que eu retomo.

**5. `/reembolso`** (atribuir a: [pessoa do financeiro], tag: financeiro)
> Vou te passar para [nome], que cuida das cobranças e pode resolver o reembolso. Essa pessoa já tem esta conversa com todo o contexto, então você não precisa repetir nada.

**6. `/cobranca-duplicada`** (tag: financeiro)
> Desculpe, a cobrança duplicada foi erro nosso. Já pedi o estorno de [valor]; costuma aparecer na sua fatura em [prazo que o seu processador de pagamentos informa].

**7. `/nao-da`** (status: resolvida)
> Hoje isso não dá para fazer: [limite concreto]. O mais próximo é [alternativa]. Se servir, te mando os passos.

**8. `/pedido`** (tag: feedback, status: resolvida)
> Registrei como pedido para o time de produto, com o seu caso de uso. Não consigo te dar uma data. Se sair, te aviso por aqui.

**9. `/aguardo`** (adiar 24 h)
> Fico no aguardo da sua resposta. Se amanhã eu não tiver notícias, te escrevo de novo.

A conversa some por 24 horas e volta sozinha para a caixa de entrada. Assim o "te escrevo de novo" fica por conta da ferramenta.

**10. `/escalado`** (atribuir a: [líder de suporte], status: aberta)
> Passei para [nome], que conhece melhor essa parte. Essa pessoa vai te escrever aqui; enquanto isso, a conversa continua aberta.

**11. `/instabilidade`** (tag: incidente)
> Estamos com um problema que afeta [qual parte]. Estamos trabalhando nisso e te aviso aqui assim que voltar a funcionar. Desculpe pela interrupção.

**12. `/encerramento`** (status: resolvida)
> Pronto. Se algo não ficou claro, responda aqui e seguimos. Você vai ver uma pesquisa de uma pergunta; com ela aprendemos o que melhorar.

A última antecipa o CSAT: ao resolver uma conversa, o widget pede ao visitante uma nota de 1 a 5 com comentário opcional.

## Como manter

Meia hora por mês basta:

1. **Leia dez conversas resolvidas ao acaso.** Confira as cinco regras no que foi enviado de verdade: o modelo editado às pressas diz mais que o original.
2. **Leia os comentários de CSAT baixo.** Se dois mencionam a mesma resposta, reescreva.
3. **Apague as que o time deixou de usar.** Uma lista de 80 respostas faz ninguém achar a certa com `/`.
4. **Revise as tags.** Se `/reproduzido` adiciona `bug`, filtrar por essa tag mostra quantos erros as pessoas relataram neste mês.

## O que ainda não faz

- As respostas salvas não têm variáveis nem campos preenchidos sozinhos.
- São por widget. Com dois widgets, cada um tem sua lista.
- Não há sugestões automáticas de resposta nem reescrita com IA dentro da caixa de entrada.

O Chat roda por $0 no seu servidor, ou no zerosoft Cloud sem cobrança por assento.
