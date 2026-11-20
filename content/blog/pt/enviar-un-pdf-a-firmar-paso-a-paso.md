---
title: "Como enviar um PDF para assinar e o que fica registrado"
description: "Passo a passo para mandar um contrato para assinatura com o Sign, sem que o signatário crie conta, e como ler o certificado de conclusão para conferir que ninguém mexeu no documento."
date: "2026-11-20"
author: "zerosoft"
tags: ["sign", "docusign", "assinatura eletrônica", "guia"]
---

Enviar um PDF para assinar parece simples até alguém perguntar como saber que assinou quem diz ter assinado, e que o arquivo não mudou depois. Os guias do DocuSign, como [o que explica como assinar e enviar um PDF](https://www.docusign.com/blog/how-to-electronically-sign-and-send-pdf), mostram o caminho básico: subir, posicionar a assinatura, enviar. Aqui fazemos o mesmo caminho com o [Sign](/products/sign), o app de assinatura da zerosoft, e paramos no que pouca gente olha: a evidência que sobra no fim.

## O que você precisa antes

- Um PDF. O Sign aceita só PDF, até 4 MB e 100 páginas. Se o contrato está em Word, exporte antes. Se você o escreveu numa página do Docs, o Sign a converte no PDF para você.
- O email de cada signatário. Eles não precisam de conta na zerosoft.
- A ordem: quem assina primeiro, e se alguém só aprova ou só recebe cópia.

O Sign remove do arquivo tudo o que executa ou abre algo: scripts, ações ao abrir, formulários e anexos. O que segue é um PDF limpo, e o certificado guarda o hash do original caso você queira comparar.

## Passo 1: suba o documento e adicione os destinatários

Crie um envelope novo, suba o PDF e adicione cada pessoa com seu papel: signatário, aprovador ou cópia. O aprovador serve para um visto sem assinatura, como o do financeiro antes de o cliente assinar.

Cada destinatário tem um número de ordem. Quem compartilha o número assina em paralelo, e o número seguinte só recebe o convite quando todos os anteriores terminaram. Num contrato entre seu sócio e um cliente, dê 1 ao sócio e 2 ao cliente: o cliente não vê nada até a sua parte estar assinada.

## Passo 2: posicione os campos

Arraste os campos sobre as páginas e atribua cada um a um destinatário. Há assinatura, iniciais, data, nome, email, texto, caixa de seleção e lista, obrigatórios ou opcionais. Cada pessoa preenche só os seus e não pode editar os de outra.

Uma regra prática: marque como obrigatórios os campos sem os quais o documento não vale (assinatura e data) e deixe o resto opcional. Os campos guiados levam o signatário um a um, o que reduz documentos devolvidos pela metade.

Algo que ainda não fazemos: posicionar campos automaticamente por um texto âncora. Se você manda o mesmo contrato todo mês, use um modelo: ele guarda papéis e campos, e só mudam os emails.

## Passo 3: defina vencimento e lembretes

Escolha em quantos dias o envelope vence (de 1 a 365, padrão 30) e a cada quantos dias vai um lembrete a quem não assinou (de 0 a 30, onde 0 é sem lembretes). Um bom ponto de partida para um contrato comercial: vence em 14 dias, lembrete a cada 3. Se vencer incompleto, todos são avisados e o link deixa de funcionar.

Você pode incluir uma mensagem no email. Diga o que é o documento e o que espera: "Contrato de serviço de dezembro, assine na última página" ajuda mais que um texto genérico.

## Passo 4: envie e acompanhe o status

Ao enviar, cada destinatário recebe um link pessoal. Esse link:

- é de uso único por pessoa,
- vence com o envelope,
- pode ser revogado se você mandou para o endereço errado,
- e no banco só se guarda o hash dele, não o link.

Por padrão, o signatário também confirma um código enviado por email antes de abrir o documento. Os códigos também são guardados como hash, com limites de tentativas por destinatário e por IP. A verificação é por email: ainda não há SMS nem verificação de identidade com documento.

Antes de assinar, a pessoa aceita assinar eletronicamente. Depois digita, desenha ou envia sua assinatura. Pode recusar com um motivo, e esse motivo chega a você. Se errou algo num envelope já enviado, ele não se edita: anule com um motivo (os destinatários recebem por email) e copie para um novo rascunho.

## Passo 5: leia o certificado de conclusão

Quando todos assinam, o Sign desenha os campos no PDF e acrescenta no fim um certificado de conclusão. Nele constam:

- cada destinatário, com IP e navegador,
- cada evento do envelope (criado, enviado, aberto, assinado) com horário, IP e navegador,
- o SHA-256 do documento original e do assinado.

Todos recebem a cópia assinada. Para conferir, calcule o SHA-256 do arquivo que você tem e compare com o hash do email de conclusão e da página do envelope:

```bash
sha256sum contrato-assinado.pdf
```

Se um único byte mudou, o resultado é outro. Um aviso honesto: o certificado também lista um hash intermediário (as páginas assinadas antes de somar o certificado), que não dá para recalcular a partir do PDF final. O que você compara é o hash do arquivo final.

## Que valor jurídico tem

O Sign faz assinatura eletrônica simples com trilha de auditoria, do tipo reconhecido pelo ESIGN Act e pela UETA dos EUA. Ainda não emite assinaturas avançadas ou qualificadas do eIDAS nem a assinatura digital da Lei 25.506 da Argentina, que exige um certificador licenciado. Para um contrato de serviços entre duas empresas, costuma bastar. Para um ato que a lei exige com assinatura digital ou qualificada, não. Consulte alguém que conheça sua jurisdição antes de decidir.

## O que fazer depois da assinatura

Com o envelope concluído, você pode disparar uma automação no [Flow](/products/flow): arquivar o PDF, avisar no Chat ou atualizar o negócio no [CRM](/products/crm). Existem gatilhos para envelope concluído e recusado.

E se você hospeda, os documentos ficam na sua infraestrutura: Blob privado ou arquivos cifrados com AES-256-GCM, acessíveis só a quem envia, aos admins e a cada destinatário pelo seu link. É AGPL: dá para ler no código como o certificado é montado.
