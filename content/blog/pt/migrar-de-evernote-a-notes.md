---
title: "Como migrar do Evernote para o Notes com arquivos .enex"
description: "Guia para levar seus cadernos do Evernote ao Notes: como exportar o .enex, o que vem (anexos, etiquetas, datas, tarefas), o que se perde e o que conferir."
date: "2026-10-31"
author: "zerosoft"
tags: ["notes", "evernote", "migração", "guia"]
---

Sair do Evernote assusta pelo volume: anos de notas, recortes, PDFs escaneados e listas de tarefas pela metade. A parte boa é que o Evernote exporta tudo para um formato aberto, o `.enex`, e o [Notes](/products/notes) lê esse formato. A seguir, o que o importador traz nota por nota, o que fica de fora e como fazer caderno por caderno para não acabar com tudo misturado.

## O que você precisa

Nada de token nem de conexão com a conta do Evernote. Só os arquivos `.enex` que o app de desktop exporta. Qualquer pessoa do workspace pode importar no Notes, sem precisar ser admin.

Os limites, tirados do código do importador:

- **4 MB por arquivo** `.enex`.
- **500 notas por arquivo.** Se um caderno tem mais, o arquivo inteiro é recusado: exporte em partes.
- **100 anexos por arquivo**, cada um com até 4 MB.
- **Até 20 arquivos** de uma vez pelo seletor.

## O que é importado

De cada nota do `.enex`:

- **O título.**
- **O conteúdo**, convertido em blocos do editor: títulos (os níveis 4 a 6 viram H3), parágrafos, listas com marcadores e numeradas, citações, blocos de código, divisores e tabelas.
- **As caixas de tarefa**, com o estado. Uma tarefa marcada no Evernote chega marcada.
- **A formatação de texto:** negrito, itálico, sublinhado, tachado, código e links (`http`, `mailto` e `tel`).
- **Os anexos.** Imagens, PDFs e outros arquivos são enviados e ficam no mesmo lugar em que estavam na nota. Os que não apareciam no texto vão para o final.
- **As etiquetas.**
- **As datas de criação e de última edição**, para a lista manter a ordem.
- **O link de origem** das notas recortadas de uma página web.

Também dá para importar arquivos Markdown (`.md`, `.markdown` ou `.txt`): uma nota por arquivo, com o título do front matter, de um `# Título` no início ou do nome do arquivo.

## O que não é importado

- **O nome do caderno.** O `.enex` não traz essa informação. As notas caem no caderno que estiver aberto na hora de importar (logo abaixo, como aproveitar isso).
- **O texto criptografado** com a função de criptografia do Evernote. Ele é descartado: descriptografe no Evernote antes de exportar.
- **Imagens remotas**, as que eram um link para outro site e não um anexo.
- **Cores, fontes e destaques.** As tabelas chegam com o texto de cada célula, sem formatação, até 200 linhas e 20 colunas.
- **Lembretes, autor e localização** da nota.
- **Anexos bloqueados**, como SVG ou HTML, e os maiores que 4 MB. A nota é importada do mesmo jeito, sem esse arquivo.

## Passo a passo

1. **Exporte do Evernote.** No app de desktop, clique com o botão direito no caderno › Exportar caderno e escolha `.enex`. Repita para cada caderno.
2. **Crie os cadernos no Notes**, um para cada caderno do Evernote, com o mesmo nome.
3. **Abra o caderno de destino** na barra lateral do Notes.
4. **Clique em Importar notas**, embaixo na barra lateral, e escolha o `.enex` daquele caderno. As notas são criadas ali.
5. **Leia o aviso.** Ele diz quantas notas foram importadas e se algum arquivo não pôde ser lido.
6. Passe para o próximo caderno.

Se você importar sem nenhum caderno aberto, as notas ficam soltas em Todas as notas. Dá para movê-las depois selecionando várias de uma vez, mas ir caderno por caderno desde o começo é mais rápido.

## O que conferir depois

- **As quantidades.** Compare quantas notas cada caderno tinha no Evernote com o número do aviso.
- **Uma nota com anexos pesados.** Se faltar um PDF, provavelmente ele passava de 4 MB.
- **As etiquetas.** Elas aparecem na barra lateral. Se no Evernote você tinha variações da mesma etiqueta, é uma boa hora para renomear e juntar. Explicamos em [como organizar notas com cadernos e etiquetas](/blog/organizar-notas-libretas-y-etiquetas).
- **Que não haja duplicatas.** Importar o mesmo arquivo duas vezes cria as notas duas vezes. Se uma importação parou no meio, apague o que entrou antes de repetir.

## E se quiser sair de novo

A saída é tão aberta quanto a entrada: cada nota exporta como Markdown, `.enex` com anexos, HTML ou PDF (pela impressão), e um caderno inteiro ou todas as notas saem como `.enex`. Contamos por que isso importa para nós em [exportar seus dados deveria ser um direito](/blog/exportar-tus-datos-deberia-ser-un-derecho).

## O que ainda falta

Nossa tabela de paridade contra o Evernote marca estas lacunas:

- **Buscar texto dentro de imagens e digitalizações.** O texto de PDFs comuns é pesquisável. Ler imagens e digitalizações é ativado por workspace e ainda não foi testado com um modelo real. Se o seu Evernote está cheio de recibos escaneados, leve isso em conta.
- **Coedição ao vivo.** O Notes detecta mudanças de outra pessoa e deixa você manter as suas ou carregar as últimas, mas duas pessoas não editam a mesma nota ao mesmo tempo.
- **Integrações com Slack, Google e Outlook.** Ainda não existem.
- **Email para uma nota.** Está pronto e testado, mas ainda não está disponível no zerosoft Cloud.
- **Apps nativos.** O Notes é um app web instalável que funciona a 390 px e offline. Não há app nativo nem widgets.
- **Transcrição com falantes.** As gravações são transcritas, mas os falantes só são separados com uma chave da Deepgram ou da AssemblyAI.

## Quanto custa

O Evernote Personal custa cerca de $14,99 por mês no plano mensal. O Notes no seu servidor custa $0: o código é AGPLv3 e vem com todas as funções. No zerosoft Cloud há um plano grátis para começar e depois você paga pelo uso, como o armazenamento dos anexos. Assentos não são cobrados. A comparação completa está em [zerosoft vs Evernote](/compare/zerosoft-vs-evernote) e, se você está avaliando opções, em [alternativas ao Evernote](/compare/evernote-alternative).
