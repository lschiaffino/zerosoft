---
title: "Migrar do Calendly para o Cal: eventos, horários e reservas"
description: "Como trocar o Calendly pelo Cal com um token pessoal: o que importa (tipos de evento, perguntas, disponibilidade, reservas futuras), o que não e o que revisar."
date: "2026-10-31"
author: "zerosoft"
tags: ["cal", "calendly", "migração", "guia"]
---

Trocar de ferramenta de agendamento tem uma parte fácil e uma chata. A fácil é criar a conta nova. A chata é tudo o que você já configurou no Calendly: tipos de evento com perguntas, horários com exceções, reservas das próximas semanas e o link que está na sua assinatura de email.

Este guia mostra como funciona a importação do Calendly no [Cal](/products/cal), o que ela traz exatamente (lemos no código do importador), o que você vai refazer à mão e em que ordem fazer a troca para ninguém ficar sem reunião.

## O que você precisa

- **Um token de acesso pessoal do Calendly.** No Calendly, abra Integrações e apps › API e webhooks e gere um em Tokens de acesso pessoal. A importação usa a API v2 do Calendly e só lê.
- **Ser admin do workspace** no zerosoft. O que você importa fica disponível para o workspace inteiro.

O token fica cifrado enquanto seus dados são lidos e é apagado quando a importação termina, falha ou é cancelada. Mesmo assim, você pode revogá-lo no Calendly depois.

## Passo a passo

1. No Cal, vá em **Configurações › Importar**. Também está no hub de importação do workspace (**Configurações › Importar**, fonte Calendly).
2. Cole o token em **Token de acesso pessoal do Calendly**.
3. Decida se marca **Importar também as reservas futuras**. Leia antes a seção sobre a ordem da troca.
4. Clique em **Prévia**. Aparecem os tipos de evento com duração e quantas localizações e perguntas cada um traz, e os horários com fuso e número de faixas semanais.
5. Confirme com **Importar**. No fim, **Ir para tipos de evento** leva você à lista.

## O que é importado

**Horários de disponibilidade.** Cada horário do Calendly chega com nome, fuso, faixas por dia da semana e exceções por data (dias bloqueados e dias com horário diferente). O padrão no Calendly continua padrão no Cal.

**Tipos de evento.** De cada um vêm:

- título, link (slug), duração, descrição e cor;
- se está ativo ou não;
- até 20 perguntas, na ordem. Texto longo, telefone, escolha única e múltipla escolha ganham o tipo equivalente; o resto vira texto curto. Perguntas desativadas no Calendly ficam de fora;
- as localizações: presencial com endereço, Zoom, Google Meet, Microsoft Teams, ligação do anfitrião, ligação para o convidado e links próprios (Webex ou GoToMeeting também, quando têm uma URL).

Se uma localização não tem equivalente, a prévia avisa ao lado do tipo de evento ("sem equivalente aqui") e esse tipo de evento entra sem ela.

**Reservas futuras (opcional).** As reservas ativas a partir do momento da importação, com nome, email e fuso do convidado, as respostas e o link ou endereço da reunião. Entram como confirmadas, em nome de quem importa, e os convidados **não recebem outro email**: já têm a confirmação do Calendly. A importação também não cria outro evento na sua agenda.

Importar duas vezes não duplica: o que já entrou é pulado.

## O que não é importado

- **Qual horário cada tipo de evento usa.** O Calendly não informa, então todos ficam com o horário padrão. Mude em cada um se você usava vários.
- **Intervalos, aviso mínimo e janela de reserva.** O Cal tem, mas você configura de novo.
- **A marca de secreto.** Um tipo de evento secreto no Calendly entra como normal. Se não quiser que apareça no seu perfil público, marque como secreto no Cal.
- **Workflows, formulários de roteamento e cobranças.** O Cal tem os três (workflows com etapas antes e depois, formulários de roteamento e Stripe), mas é preciso montar do zero.
- **Tipos de evento de outras pessoas.** A importação lê a conta dona do token. Se o seu time tem várias contas no Calendly, cada pessoa roda a sua importação, ou um admin roda uma por token.
- **Reuniões avulsas** do Calendly, que não são tipos de evento reutilizáveis.
- **Reservas passadas e canceladas.** Só vêm as futuras ativas.
- **Convidados extras.** De cada reserva entra o primeiro convidado.
- **Links já ocupados.** Se um slug já existe no Cal, ele ganha um número no fim (`demo-2`) e o relatório final mostra quais mudaram.

## Em que ordem fazer a troca

As reservas importadas continuam vivas no Calendly também. O convidado tem os links do Calendly para cancelar ou remarcar, e essas mudanças não chegam ao Cal. Por isso há dois caminhos razoáveis:

- **Sem reservas importadas.** Você importa só tipos de evento e horários, publica o link do Cal e deixa as reservas do Calendly acontecerem lá. É o mais limpo.
- **Com reservas importadas.** Serve se você quer ver toda a agenda no Cal desde o primeiro dia. Até passar a última reserva importada, dê uma olhada no Calendly de vez em quando para ver se alguém cancelou.

Em qualquer um dos dois:

1. **Conecte sua agenda** em **Configurações › Conexões**. O Cal funciona com Google, Outlook e iCloud, e o tempo ocupado bloqueia horários.
2. **Revise cada tipo de evento**: horário, intervalos, perguntas e localizações.
3. **Faça uma reserva de teste** com outro email.
4. **Troque os links**: assinatura de email, site e embeds. Se você tinha o widget do Calendly no site, [como incorporar o Cal no seu site](/blog/embeber-cal-en-tu-sitio) explica cada opção.
5. **Desative os tipos de evento no Calendly** quando não quiser mais reservas novas lá.

## O que ainda falta no Cal em relação ao Calendly

Da tabela de paridade, sem enfeite:

- **Pacotes de reuniões, links de pagamento e faturas**: ainda não.
- **Tipos de evento gerenciados e travados por um admin**: ainda não.
- **SSO SAML e SCIM**: ainda não.
- **Apps de iOS e Android e extensão de navegador**: ainda não. A versão web funciona com 390 px de largura.
- **Notetaker com resumo de reuniões e assistente que agenda por email**: ainda não.
- **Cobranças**: Stripe com suas chaves e reembolso ao cancelar; falta PayPal.
- **Zapier e Make**: os eventos de reserva chegam por webhook, mas não há app nos diretórios deles.
- **Papéis**: são os do workspace, sem papéis próprios de agenda.
- **Idiomas da página de reservas**: inglês, espanhol e português. O Calendly tem cinco.

A comparação completa está em [/compare/zerosoft-vs-calendly](/compare/zerosoft-vs-calendly).

## Quanto custa

O Calendly Standard custa cerca de US$ 12 por usuário por mês: dez pessoas pagam US$ 1.440 por ano. O Cal no seu servidor custa $0, com o core em AGPLv3. No zerosoft Cloud você começa com um plano gratuito e depois paga pelo uso, que no Cal são as reservas. Assentos não são cobrados.

Se ainda está decidindo, leia [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly), incluindo os casos em que vale ficar onde está.
