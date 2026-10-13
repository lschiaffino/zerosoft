---
title: "Seus contatos são seus, não da HubSpot"
description: "A HubSpot cobra mais conforme a sua base de contatos cresce, e guardar um contato custa bytes. Sair de um CRM deveria levar minutos."
date: "2026-06-19"
author: "zerosoft"
tags: ["crm", "hubspot", "lock-in", "open source"]
---

Olhe sua fatura da HubSpot. Se sua empresa vai bem, ela subiu. Não porque você usa mais recursos: porque você juntou mais contatos. Você fez seu trabalho direito (mais gente te conhece, mais gente te deu o e-mail) e o prêmio é pagar mais por mês. É o único negócio em que ter mais clientes próprios sai mais caro.

## O imposto sobre o contato

Um contato é uma linha numa tabela: nome, e-mail, telefone, empresa, algumas datas. Algumas centenas de bytes. Cem mil contatos dão uns 50 MB de disco. Um VPS de US$ 5 vem com 25 GB: cabem as bases de quinhentas empresas.

Agora olhe a página de preços: o Marketing Hub Professional começa em torno de US$ 890 por mês e inclui 2.000 contatos de marketing. Passou do limite? Contatos extras vêm em pacotes pagos. Sua fatura é indexada ao tamanho da sua própria base. Você não paga por tecnologia: paga aluguel pelos seus próprios dados, e o aluguel sobe toda vez que o negócio vai bem.

## O verdadeiro lock-in não é o CSV

Sim, a HubSpot deixa você exportar um CSV com nomes e e-mails. O que o CSV não leva é a memória:

- **O histórico**: quais e-mails cada contato abriu, quais páginas visitou, por qual campanha chegou. A linha do tempo completa do relacionamento.
- **As associações**: qual contato pertence a qual empresa, de quais negócios participou, quais tickets abriu.
- **Os workflows**: as sequências, os fluxos de nutrição, as automações que você construiu ao longo de anos. Isso não se exporta: se reconstrói, na mão, do outro lado.

Você pode ir embora, mas vai sem memória. O teste honesto é este: consigo sair em 10 minutos levando tudo, não só a lista? Se a resposta é não, seus contatos não são seus. São do CRM, e você paga aluguel para acessá-los.

## O que o zerosoft CRM faz

O zerosoft CRM segue as mesmas regras que aplicamos no resto da suíte:

- **API documentada.** Contatos, empresas, deals, atividades, tarefas e pipelines têm endpoints na API REST v1, com a referência em /docs.
- **Export completo.** Contatos, empresas e deals saem em CSV ou JSON pela tela de Import / Export, ou pela API.
- **Contatos ilimitados.** Um contato é uma linha no banco. A fatura não cresce com a sua base.
- **O mesmo contrato.** Código aberto, self-host a $0 no seu VPS, ou zerosoft Cloud com plano grátis e cobrança pelo uso, sem cobrança por assento.

Para trazer seus dados da HubSpot, o guia está em [como tirar seus contatos da HubSpot com um CSV](/blog/migrar-contactos-de-hubspot-por-csv).

O relacionamento com os seus clientes é seu. O CRM deveria ser uma ferramenta que você usa, não um lugar que cobra para você acessar o que é seu.
