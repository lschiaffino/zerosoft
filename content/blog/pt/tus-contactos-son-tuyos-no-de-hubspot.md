---
title: "Seus contatos são seus, não da HubSpot"
description: "A HubSpot cobra mais quanto maior fica sua base de contatos. Mas um contato é uma linha que custa bytes para guardar. Seus contatos são seus — e sair deveria levar minutos, não um projeto de migração."
date: "2026-06-19"
author: "Zerosoftware"
tags: ["crm", "hubspot", "lock-in", "open source"]
---

Olhe sua fatura da HubSpot. Se sua empresa vai bem, ela subiu. Não porque você usa mais recursos: porque você juntou mais contatos. Você fez seu trabalho direito — mais gente te conhece, mais gente te deu seu e-mail — e o prêmio é pagar mais por mês. É o único negócio em que ter mais clientes próprios sai mais caro.

## O imposto sobre o contato

Um contato é uma linha numa tabela: nome, e-mail, telefone, empresa, algumas datas. Algumas centenas de bytes. Cem mil contatos dão uns 50 MB de disco. Um VPS de US$ 5 vem com 25 GB: cabem as bases de quinhentas empresas.

Agora olhe a página de preços: o Marketing Hub Professional começa em torno de US$ 890 por mês e inclui 2.000 contatos de marketing. Passou do limite? Contatos extras vêm em pacotes pagos. Sua fatura é indexada ao tamanho da sua própria base. Você não paga por tecnologia: paga aluguel pelos seus próprios dados, e o aluguel sobe toda vez que o negócio vai bem.

> Quando sua fatura cresce junto com seus contatos, você não está comprando software. Está pagando pedágio para falar com a sua própria gente.

## O verdadeiro lock-in não é o CSV

Sim, a HubSpot deixa você exportar um CSV com nomes e e-mails. Isso não é liberdade: é uma cortesia. O que o CSV não leva é a memória:

- **O histórico**: quais e-mails cada contato abriu, quais páginas visitou, por qual campanha chegou. A linha do tempo completa do relacionamento.
- **As associações**: qual contato pertence a qual empresa, de quais negócios participou, quais tickets abriu.
- **Os workflows**: as sequências, os fluxos de nutrição, as automações que você construiu ao longo de anos. Isso não se exporta: se reconstrói, na mão, do outro lado.

Você pode ir embora, mas vai sem memória. O teste honesto é este: consigo sair em 10 minutos levando tudo, não só a lista? Se a resposta é não, seus contatos não são seus. São do CRM, e você paga aluguel para acessá-los.

## O que estamos construindo

Nosso CRM chega no primeiro trimestre de 2027 e já nasce com as regras que o Link aplica hoje:

- **API-first**: a API pública sai documentada no dia um, como fizemos com a API v1 do Link. Tudo o que a interface faz, o curl faz.
- **Exportação completa, sempre**: JSON, CSV ou API. Tudo, incluindo o histórico. Sem pedir permissão, sem ticket de suporte.
- **Contatos ilimitados**: porque um contato é uma linha e linhas não custam nada. Sua fatura não cresce quando você cresce.
- **O mesmo contrato de sempre**: código aberto, self-host a US$ 0 no seu VPS, ou cloud hospedada pelo custo real da infraestrutura.

Enquanto isso, o Link já está no ar — short links, analytics sem cookies, QR, API documentada em /docs — e funciona exatamente com esse princípio: seus dados saem tão fácil quanto entram.

Seus contatos são seus porque o relacionamento é seu. O CRM tem que ser uma ferramenta que você usa, não um cofre que cobra para você olhar o que é seu.
