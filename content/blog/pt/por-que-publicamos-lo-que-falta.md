---
title: "Por que publicamos o que falta"
description: "O nosso README lista as lacunas conhecidas de cada produto, ao lado dos recursos. Sem calendário do Outlook, sem bot com LLM, sem coedição em tempo real. Por que marketing honesto é uma política para nós, não um humor."
date: "2026-09-13"
author: "Zerosoftware"
tags: ["honestidade", "marketing", "open source"]
---

Abra o README do Zerosoft e olhe embaixo de qualquer produto. Logo depois da lista de recursos há uma linha em itálico que começa com *Known gaps*. Não está escondida num changelog nem enterrada num tópico de fórum. Está no primeiro arquivo que qualquer pessoa lê.

A maioria das empresas de software chamaria isso de marketing ruim. Achamos que é o único tipo que funciona no longo prazo, e transformamos isso em regra.

## O que a lista diz de verdade

Estas são as lacunas, como estão publicadas, produto por produto:

- **CRM:** a sincronização do Gmail é manual, não em segundo plano. Sem templates de e-mail, sequências ou rastreamento de abertura. Sem orçamentos ou produtos. Sem formulários de leads. Sem eventos de webhook do CRM. Negócios e atividades não podem ser importados. Relatórios usam uma única moeda.
- **Track:** sem atalhos de teclado, sem sincronização em tempo real, sem integração com Git/GitHub, sem API pública ou webhooks, sem importação do Linear.
- **Cal:** sem calendários do Outlook ou do iCloud. Google Calendar, sim.
- **Chat:** o bot de resposta automática faz correspondência de palavras-chave sobre respostas prontas e páginas de docs, *não é um LLM*. Sem exportação de conversas.
- **Docs:** sem coedição em tempo real, sem exportação em JSON/Markdown, sem importação do Notion.
- **O site:** a página de status lista os serviços; o monitoramento ao vivo ainda não está ligado.
- **Enterprise:** SSO/SAML, logs de auditoria, papéis personalizados e white-label moram em `/ee` e estão em desenvolvimento.

Releia essa lista se você está avaliando substituir o HubSpot ou o Linear. Para alguns times, vários desses itens são eliminatórios. É exatamente por isso que estão ali.

## Por que fazemos isso

### Porque você vai descobrir de qualquer jeito

Uma lacuna escondida é uma lacuna que o seu usuário descobre três semanas depois de migrar, no meio de uma semana de vendas, quando tenta mandar uma sequência ou mexer no board do Track com um atalho de teclado. Nesse momento já não é um recurso que falta. É uma promessa quebrada, e a confiança não volta.

Uma lacuna publicada custa o usuário que precisava dela no primeiro dia. Tudo bem. Esse usuário deve continuar usando a ferramenta que tem o recurso. Preferimos perdê-lo com honestidade a mantê-lo insatisfeito.

### Porque a linha da IA importa agora

Seria muito fácil, em 2026, dizer que o bot do Chat é "com IA". Afinal, ele responde perguntas sozinho. Mas o que ele faz é comparar palavras-chave com as suas respostas prontas e páginas de docs. É útil, previsível e barato de rodar — e não é um modelo de linguagem. Se borrássemos essa linha, cada cliente que esperava um LLM se sentiria enganado, e com razão.

Então o README diz com todas as letras: *não é um LLM*.

### Porque nos mantém honestos internamente

Escrever "não temos X" ao lado de "temos Y" muda o jeito como um time trabalha. O nosso guia de contribuição tem uma regra: páginas de produto só podem anunciar recursos que existem na `main`. Não "num branch". Não "na próxima sprint". Na `main`.

Essa regra só funciona se a lista oposta também existir. Quando um anúncio e uma lacuna se contradizem, alguém percebe e um dos dois é corrigido. Normalmente, o anúncio.

### Porque é um projeto open source

Num produto fechado, uma lista de lacunas é uma confissão. Num projeto open source, é uma lista de tarefas que qualquer pessoa pode pegar. Cada linha de *Known gaps* é um lugar onde um contribuidor pode fazer diferença real, e [contribuir não precisa da permissão de ninguém](/blog/como-contribuir-a-zerosoftware).

Calendários do Outlook no Cal, exportação em Markdown no Docs, uma API pública no Track: não são segredos que nos envergonham. São issues esperando alguém, inclusive a gente.

## Como é o marketing honesto na prática

Publicar as lacunas é uma parte. A política completa é um punhado de regras chatas que aplicamos em todo lugar, inclusive neste blog:

- **Só anunciar o que existe no código.** Se um recurso não foi mergeado, ele não está na página do produto. "Em breve" só é permitido quando está rotulado assim — por isso a nossa página do Cal diz que Outlook e iCloud vêm em breve, em vez de simplesmente listar "sincronização de calendário".
- **Dizer onde o concorrente está na frente.** O HubSpot tem um ecossistema de integrações enorme. O Linear tem uma velocidade keyboard-first e uma sincronização em tempo real que não temos. O Notion tem colaboração em tempo real e uma biblioteca de templates gigante. Fingir o contrário é subestimar o leitor.
- **Nada de números inventados.** Sem contagem de usuários inventada, sem depoimentos que não recebemos, sem benchmarks que não rodamos. Quando damos um exemplo, dizemos que é hipotético.
- **Nada de preços de fachada.** Self-host é grátis para sempre sob AGPLv3. O Zerosoft Cloud tem um plano gratuito generoso e depois cobra por uso, com preços transparentes publicados antes de cobrarmos qualquer coisa. Não vamos citar um valor por unidade até que ele seja real.
- **Dizer quem não deveria trocar.** Se o seu time de vendas vive de sequências de e-mail, o nosso CRM ainda não é para você. Se você precisa de SAML neste trimestre, espere. Dizer isso em voz alta faz parte do produto.

## "Isso não é ruim para o negócio?"

No curto prazo, talvez. A landing page de um concorrente cheia de checkmarks parece melhor que a nossa com uma lista do que falta.

Mas pense no que a página dos checkmarks otimiza: o primeiro clique. Nós otimizamos para o segundo ano. Um software para onde você levou os seus contatos, a sua agenda e os seus documentos é um software em que você precisa confiar. E confiança não se constrói com a lista de recursos — qualquer um escreve uma lista de recursos. Se constrói com a linha que vem embaixo dela.

Há também um motivo mais simples. O nosso código é público. Qualquer pessoa pode abrir `lib/` e conferir se o Chat chama um modelo de linguagem. Mentir sobre recursos num projeto open source não é só errado: é inútil. A única posição coerente é dizer primeiro.

## Como uma lacuna sai da lista

Do mesmo jeito que entrou: em público. Um recurso é lançado, a página do produto pode anunciá-lo e a linha sai de *Known gaps*. Se você está esperando uma em especial, acompanhe o README — ou [mande um PR](/blog/como-contribuir-a-zerosoftware) e tire ela da lista você mesmo.
