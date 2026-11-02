---
title: "Como migrar do Excalidraw para o Board (e o caso do Miro)"
description: "Guia para importar seus arquivos .excalidraw no Board em lote: quais elementos e imagens vêm, o que é descartado, os limites e o que fazer se você vem do Miro."
date: "2026-10-31"
author: "zerosoft"
tags: ["board", "excalidraw", "migração", "guia"]
---

O [Board](/products/board) roda o mesmo editor open source do Excalidraw. Por isso a mudança a partir do Excalidraw ou do Excalidraw+ é curta: o formato `.excalidraw` é lido do jeito que está, e o que você desenhou aparece igual do outro lado. Com o Miro a história é outra, e contamos no final o que realmente dá para fazer.

## O que o importador lê

Um formato só: arquivos `.excalidraw`, que são o JSON de uma cena do Excalidraw. O editor do excalidraw.com gera esses arquivos, e o Excalidraw+ também, pelo **Save to…** do menu. O seletor também aceita arquivos `.json` com o mesmo conteúdo.

Ele não lê bibliotecas (`.excalidrawlib`). Uma biblioteca de formas não é uma cena, e o importador recusa.

Os limites:

- **50.000 elementos** por arquivo.
- **4 MB por cena.** O arquivo enviado, com as imagens dentro, pode ter até 4,5 MB.
- **Até 50 arquivos** de uma vez pela lista.

## O que é importado

- **Todos os elementos ativos da cena:** formas, setas, linhas, texto, desenho à mão livre, frames e o que mais estiver na tela. Elementos que o Excalidraw marcou como excluídos são descartados.
- **As imagens coladas no quadro**, desde que estejam dentro do arquivo em PNG, JPEG, GIF ou WebP. Imagens SVG são convertidas para PNG no seu navegador antes do envio. Todas vão para o armazenamento como em qualquer salvamento.
- **A cor de fundo** e o **tamanho da grade**.
- **O nome.** Cada arquivo vira um quadro novo com o nome do arquivo, sem a extensão.

## O que não é importado

- **Imagens por URL.** Se o arquivo aponta para uma imagem em outro site em vez de trazê-la dentro, essa imagem não é salva.
- **Links perigosos.** Um elemento com link `javascript:` ou `data:` fica sem link.
- **O HTML gerado por IA** no wireframe para código, e o elemento que o mostrava. No Board essa prévia fica só na sessão de quem gerou.
- **O resto do estado do editor:** zoom, posição, tema e ferramenta selecionada. O Board abre o quadro com os próprios valores.
- **O que não está no arquivo:** comentários, colaboradores, histórico ou pastas do Excalidraw+. Um `.excalidraw` guarda a cena e mais nada.

## Passo a passo

### Vários arquivos de uma vez

1. **Junte seus arquivos.** No excalidraw.com ou no Excalidraw+, abra cada cena e use **Save to…** para baixar o `.excalidraw`.
2. **Abra a lista do Board.** Se quiser que caiam numa pasta, entre nela antes.
3. **Clique em Importar**, ao lado de Novo quadro, e escolha todos os arquivos juntos.
4. **Confira o resultado.** Com um arquivo só, o Board abre o quadro novo. Com vários, eles aparecem na lista e um aviso diz quantos foram importados e quantos não puderam ser lidos como `.excalidraw`.

### Um arquivo dentro de um quadro

Num quadro que você pode editar, o menu da tela tem **Abrir**. Ele carrega um `.excalidraw` nesse quadro e, depois de pedir confirmação, substitui o que havia. Serve para refazer um quadro que você já compartilhou sem mudar o link.

## O que conferir depois

- **Os quadros que falharam.** Se o aviso diz que algum não pôde ser lido, quase sempre é uma biblioteca em vez de uma cena, ou um arquivo com mais de 50.000 elementos ou 4 MB. Nos pesados, tire imagens ou divida a cena em duas no Excalidraw antes de exportar.
- **As imagens.** Abra um quadro com fotos e confirme que estão todas. As que faltam eram por URL: cole de novo.
- **Os nomes.** Um arquivo chamado `Untitled-2024-03-01.excalidraw` vira um quadro com esse nome. Renomeie pela lista.
- **Cmd+K.** Os quadros importados são encontrados pelo nome e pelo texto de dentro.

## Se você vem do Miro

O Board não importa quadros do Miro. Ele não lê o formato do Miro e não há conexão com a API dele. O que dá para fazer:

- **Trazer o quadro como referência.** No Miro, pelo menu do quadro, **Save as image** baixa um JPG da área que você escolher. Cole no Board como imagem e desenhe por cima. No plano gratuito do Miro, a exportação sai só no tamanho pequeno.
- **Passar os stickies como texto.** A ferramenta de stickies do Board tem **Colar uma lista**: uma linha por sticky, até 100 de uma vez, e as palavras com `#` viram tags. Se você tem o texto dos seus stickies numa lista, em um minuto eles estão na tela.

Depois, para organizar o que trouxe, o Board agrupa stickies por tema com IA, faz votação por pontos e roda um timer compartilhado. Há exemplos em [brainstorming com o Board](/blog/lluvia-de-ideas-con-board) e em [retro num quadro branco](/blog/retro-en-una-pizarra).

## O que ainda falta

Nossa tabela de paridade compara o Board com o Excalidraw+. As lacunas que marcamos:

- **Balde de tinta, autoshape e lápis de largura fixa.** O Excalidraw+ lançou em 2026 e não estão na versão do editor que usamos.
- **Voz e compartilhamento de tela.** Não há.
- **Papéis.** Papéis do workspace mais edição ou leitura por quadro, sem outros papéis por quadro.
- **Offline.** O que não foi salvo fica como rascunho local que você pode restaurar. Não há modo offline que sincronize depois.
- **Quadros grandes.** Até 4 MB por cena, com aviso ao passar.
- **Wireframe para código.** A página gerada fica na sessão de quem gerou. Não é salva nem compartilhada.

## Quanto custa

O Miro Starter custa cerca de $10 por usuário por mês no plano mensal. O Board no seu servidor custa $0, com o código sob AGPLv3 e todas as funções. No zerosoft Cloud há um plano grátis para começar e depois você paga pelo uso, como o armazenamento das imagens. Assentos não são cobrados, então chamar o time todo para um workshop não muda a fatura. A comparação com o Excalidraw+ está em [zerosoft vs Excalidraw+](/compare/zerosoft-vs-excalidraw-plus).
