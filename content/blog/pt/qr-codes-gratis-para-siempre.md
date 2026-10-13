---
title: "Códigos QR: um padrão aberto desde 1994"
description: "O QR é a norma ISO/IEC 18004 e o inventor abriu mão da patente. Gerar um custa quase nada de processamento, e no Link cada link já vem com o seu, em SVG e PNG."
date: "2026-06-22"
author: "zerosoft"
tags: ["link", "qr", "open source"]
---

O código QR nasceu em 1994 na Denso Wave, uma subsidiária da Toyota. Masahiro Hara e sua equipe o criaram para rastrear autopeças na linha de produção: precisavam de algo que guardasse mais dados que um código de barras e fosse lido rápido, de qualquer ângulo.

E então fizeram algo que a indústria do software ainda não processou: renunciaram a exercer a patente. A especificação foi publicada, o padrão se abriu e hoje é ISO/IEC 18004. Qualquer um pode gerar e ler códigos QR. Ninguém paga licença por isso.

## Gerar um QR não custa nada

Um QR não é um serviço. É aritmética. Pegam-se os seus bytes, codificam-se numa grade de módulos brancos e pretos, adiciona-se correção de erros Reed-Solomon e desenha-se o resultado. Em qualquer CPU dos últimos vinte anos, isso leva microssegundos.

Não existe "servidor de QR" nem custo por código, e nada disso cresce com o uso. Você pode gerar um milhão de QRs num laptop de dez anos atrás, sem internet, com uma biblioteca open source.

## Como funciona, em 40 segundos

Um QR é uma matriz de módulos: a versão 1 tem 21×21, e cada versão soma 4 módulos por lado até a versão 40, com 177×177. Três elementos fazem a mágica:

- **Os quadrados dos cantos** (finder patterns): dizem ao leitor onde está o código e em que ângulo. Por isso dá para escaneá-lo girado, torto ou em perspectiva.
- **A correção Reed-Solomon**: os dados são guardados com redundância. No nível mais alto, o código é lido mesmo com até 30% danificado ou coberto. É por isso que as marcas podem estampar o logo no meio.
- **A máscara**: antes de ser desenhada, a grade passa por um XOR com um padrão de máscara para evitar grandes blocos de uma cor só, que confundiriam o leitor.

O resto são os dados em zigue-zague: modo de codificação, comprimento e o seu conteúdo. Uma URL cabe de sobra nas versões pequenas.

## Então por que cobram?

Olhe qualquer SaaS de marketing ou de links: os QR aparecem no plano premium. "QR personalizados a partir de tantos dólares por mês." Cobram uma assinatura mensal para executar uma função de uma biblioteca open source sobre um padrão aberto com patentes renunciadas.

É como cobrar por somar. A indignação é legítima: eles não estão vendendo tecnologia, estão vendendo acesso a algo que já era seu.

## No Link, está incluído

Cada link encurtado que você cria no Link vem com seu QR, em dois formatos:

- **SVG**: vetorial, escala infinito sem pixelar. Para gráfica, vitrine, embalagem.
- **PNG**: pronto para colar numa apresentação, num PDF ou num adesivo.

Sem plano premium. Sem limite de downloads e sem marca d'água: o padrão é aberto, então não há o que cobrar.

O Link é open source: self-host por $0, ou zerosoft Cloud com plano grátis e cobrança pelos cliques. Os QR são a parte mais barata do sistema, e não cobramos por eles.
