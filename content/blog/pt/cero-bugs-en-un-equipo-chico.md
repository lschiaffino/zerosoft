---
title: "Zero bugs num time pequeno: triagem, prazos e uma regra só"
description: "Como adotar uma política de zero bugs com três a dez pessoas: uma regra com duas saídas, prazos por prioridade, um plantão semanal e a fila de triagem do Track para o que chega pelo Chat ou pelo Flow."
date: "2026-10-18"
author: "zerosoft"
tags: ["track", "bugs", "playbook"]
---

A Linear contou no blog que [trabalha com uma política de zero bugs](https://linear.app/now/zero-bugs-policy): todo bug reportado é corrigido ou descartado, e nenhum vai parar no backlog. Os prazos deles são 48 horas para os de prioridade alta e 7 dias para o resto. Para chegar lá, pararam o trabalho de produto por três semanas e zeraram cerca de 175 bugs abertos.

A ideia é boa e funciona melhor ainda num time pequeno. Com cinco pessoas não existe time de QA nem gerente distribuindo tickets, então o backlog de bugs cresce em silêncio até um cliente ir embora. Este post adapta a política para um time de três a dez pessoas e mostra como tocá-la no Track com o que o Track faz hoje.

## A regra: todo bug tem duas saídas

Um bug que chega tem exatamente dois destinos possíveis:

1. **É corrigido**, dentro do prazo da sua prioridade.
2. **É descartado**, com uma linha explicando o motivo ("só acontece no Safari 14", "é o comportamento esperado").

A terceira saída, "deixa para depois", está proibida. Corrigir um bug custa quase o mesmo hoje ou daqui a seis meses. O que muda é quanto tempo o cliente convive com ele e quanto contexto você perde no caminho.

## Prazos que um time pequeno consegue cumprir

Copiar os prazos de uma empresa com dezenas de engenheiros é o jeito mais rápido de abandonar a política em um mês. Esta é uma versão mapeada para as quatro prioridades do Track:

| Prioridade no Track | O que significa | Prazo |
|---|---|---|
| Urgente | Quebrado para todo mundo, ou perda de dados | No mesmo dia |
| Alta | Uma função importante falha para alguns clientes | 2 dias úteis |
| Média | Incomoda, tem contorno | 7 dias |
| Baixa | Cosmético | 7 dias, ou descarte |

O Track não mede prazos nem avisa quando um vence. O que ele tem é a **data de vencimento** de cada issue: quando você aceita um bug, coloque a data que a tabela pede. A partir daí, o **Resumo** mostra o que está atrasado em cada projeto, e **Minhas tarefas** agrupa o trabalho de cada pessoa em Atrasadas, Hoje, Próximas e Sem data. Esse é o alarme.

## Passo 1: um lugar onde os bugs caem

A política desmorona se os bugs chegam por cinco canais e alguém precisa lembrar de copiá-los. No Track, cada projeto pode ligar o **Triage para issues externos** nas configurações (aba Triagem; quem liga é um admin). Com a triagem ligada, os issues que não foram criados por uma pessoa no app esperam numa fila separada até alguém aceitar. Enquanto isso, ficam fora das listas e de Minhas tarefas, e o quadro do time não se enche de ruído.

O que alimenta essa fila hoje:

- **Chat**: um agente do Agents com a ferramenta **Criar issue no Track** pode registrar o bug que um visitante relata, com os dados de contato na descrição.
- **Flow**: o passo **Track: criar issue** cria um issue a partir de qualquer fluxo. Há um template, "Bug relatado no chat → issue no Track", que usa IA para detectar mensagens que relatam um bug e abre um issue de prioridade alta. O mesmo passo transforma em issue o que chega por um formulário do CRM (gatilho "CRM: formulário enviado").

Os bugs que o próprio time encontra são criados no app e vão direto para a lista, sem passar pela triagem. Cada issue na fila mostra de onde veio ("De Chat", "De Flow"), e você sabe a quem responder.

## Passo 2: um plantão por semana

Alguém precisa olhar a fila. Num time pequeno, faça um rodízio semanal entre todos que escrevem código, fundadores incluídos. Essa pessoa abre a fila de triagem duas vezes por dia e resolve cada issue com um de três botões:

- **Aceitar em** um status (por padrão, o primeiro da categoria Todo), com prioridade, responsável e data de vencimento.
- **Recusar**: o issue vai para o status cancelado do projeto. É o "descartado" da regra. Deixe o motivo num comentário.
- **Duplicado**: você digita o identificador do original (por exemplo `ZER-12`), o Track vincula os dois com uma relação "duplica" e cancela a cópia.

Se duas pessoas resolvem o mesmo issue ao mesmo tempo, o Track avisa a segunda que outra pessoa já resolveu, e ninguém atropela ninguém.

O plantão não corrige tudo. Ele decide. Atribui o bug a quem conhece melhor aquela parte do código e, se ninguém conhece, fica com ele.

## Passo 3: bugs primeiro, toda manhã

O hábito que faz tudo funcionar é simples: a primeira coisa do dia são os seus bugs atribuídos. Abra **Minhas tarefas**, olhe Atrasadas e Hoje, e só depois siga com o trabalho do ciclo.

Para ninguém remontar filtros todo dia, salve uma visualização na lista de issues: prioridade Urgente e Alta, etiqueta `bug`, ordenada por prioridade. As etiquetas são do workspace e valem para todos os projetos, então `bug` significa a mesma coisa em todo lugar. As visualizações salvas são pessoais; passe a receita para o time e cada um salva a sua.

No teclado: `J` e `K` percorrem a lista, `Enter` abre o issue e `C` cria um novo.

## Passo 4: o merge fecha o bug

Se você conectar a integração com o GitHub (um webhook por workspace, com os repositórios que escolher), o Track vincula cada PR ou commit que menciona um identificador no branch, no título ou na descrição. No issue dá para **copiar o nome do branch** sugerido, algo como `zer-123-corrigir-o-login`, e o PR já nasce vinculado.

Na configuração você escolhe o que acontece com o status: mover o issue para Em andamento ao abrir o PR e para Concluído ao fazer o merge. Na descrição do PR, só contam para fechar as menções precedidas de uma palavra-chave como `fixes`, `closes`, `corrige` ou `resolve`. Um "bloqueado por ZER-11" vincula sem fechar.

## Passo 5: a revisão de sexta

Quinze minutos, o time todo:

1. Olhe o **Resumo**: issues atrasados por projeto e quantos esperam triagem.
2. Filtre a lista pela etiqueta `bug` e conte por responsável. Se alguém tem mais de quatro ou cinco abertos, redistribua, ou tire a pessoa do ciclo por dois dias para zerar a fila dela.
3. Procure padrões. Se metade dos bugs da semana veio do mesmo módulo, isso é um problema de produto, e vai para o próximo ciclo.
4. Passe o plantão para a próxima pessoa.

O Track não tem um painel de bugs por pessoa; essa contagem sai dos filtros. Com dez ou vinte bugs abertos, dá conta.

## O começo: zerar o backlog uma vez

Se hoje você tem quarenta bugs antigos, a política não começa até resolvê-los. Uma semana de faxina costuma bastar num time pequeno:

- Selecione os bugs antigos na lista (`X` marca a linha ativa, Shift+clique marca um intervalo) e use a **edição em massa** para mudar status, prioridade, responsável ou etiquetas de uma vez.
- O que ninguém consegue reproduzir vai para cancelado com um comentário.
- O resto é dividido e corrigido naquela semana, sem trabalho novo.

## Avisar o cliente

Fechar o ciclo é o que o cliente mais valoriza. Quando um bug que chegou pelo Chat vai para Concluído, responda na mesma conversa. Hoje esse aviso é manual: Track e Chat ainda não reabrem a conversa sozinhos. Para automatizar uma parte, o Flow tem o gatilho "Track: issue mudou de status", e o template "Issue urgente → Discord" mostra como mandar um aviso para um canal do time.

## O que você precisa e o que falta

Você precisa de um projeto com triagem ligada, uma etiqueta `bug`, uma tabela de prazos que o time aceite e um plantão que gire. Tudo isso roda no Track, no seu servidor por $0 ou no zerosoft Cloud.

O que o Track ainda não faz: medir prazos de bugs, mostrar um painel de bugs por pessoa, nem reabrir a conversa do Chat quando o issue fecha. Se a sua política depende desses números, por enquanto eles vão ser contados à mão.
