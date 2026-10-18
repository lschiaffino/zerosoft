---
title: "zerosoft Chat vs Intercom: uma comparação honesta"
description: "O Intercom está muito à frente em IA, canais e integrações. O Chat é um inbox de webchat auto-hospedável com SLAs e CSAT. O que cada um faz, e quem não deveria trocar."
date: "2026-09-23"
author: "zerosoft"
tags: ["chat", "intercom", "comparação"]
---

Vamos tirar a parte desconfortável do caminho: o Intercom e o zerosoft Chat não são mais a mesma categoria de produto. O Intercom virou uma plataforma de atendimento com IA no centro. O Chat é um widget de webchat com um inbox compartilhado e o básico do suporte bem feito. Comparar os dois feature por feature seria bobagem: então, em vez disso, aqui está onde cada um realmente está, e uma resposta honesta para "devo trocar?".

## A versão curta

- O **Intercom** é uma suíte de atendimento madura: um agente de IA que responde sozinho, vários canais, central de ajuda, mensagens ativas, SDKs móveis e um marketplace de integrações enorme. Se o suporte é uma função central com volume de verdade, ele foi feito para você.
- O **Chat** é open source (AGPLv3), auto-hospedável, e cobre o essencial: um widget de webchat incorporável, um inbox compartilhado, regras de atribuição, políticas de SLA, respostas prontas e macros, notas internas, tags, horário de atendimento, CSAT e uma central de ajuda montada com as suas páginas do Docs. Serve para times pequenos que querem um inbox organizado e próprio, sem preço por assento.

## Onde o Intercom está claramente à frente

**IA.** Esse é o ponto principal. O agente de IA do Intercom lê seu conteúdo e responde clientes em linguagem natural, resolvendo muitas conversas do começo ao fim. O bot do Chat pode responder com IA: busca nas suas páginas do Docs e nas respostas prontas, responde enquanto nenhum humano entrou na conversa e, se não sabe ou o visitante pede uma pessoa, passa a conversa para o time com prioridade alta. Sem IA configurada, cai num bot por palavras-chave que responde uma vez. Para agentes que também agem (cadastram leads, agendam), existe o Agents. Mesmo assim, o Intercom está anos à frente em IA de atendimento.

**Canais.** O Intercom reúne conversas de vários canais (email, apps de mensagem, redes sociais e mais) num inbox só. O Chat é um widget para o seu site. Só isso, por enquanto.

**Central de ajuda.** O Intercom vem com uma central de ajuda pública, com artigos, coleções, busca e domínio próprio. Na zerosoft, as páginas do Docs que você publica formam uma [central de ajuda](/blog/centro-de-ayuda-con-docs) em `/h/<seu-handle>`, com coleções, busca e um "Isso ajudou?" por artigo, e o widget do Chat mostra essas páginas numa aba Ajuda. É mais simples que a do Intercom: no zerosoft Cloud ela fica em `zerosoft.ai/h/`, sem domínio próprio, e os artigos não levam imagens nem vídeos.

**Mensagens ativas e dentro do produto.** Tours de produto, banners, mensagens segmentadas, campanhas de email. O Chat só responde; ele não vai atrás de ninguém.

**SDKs móveis.** O Intercom tem SDKs nativos para colocar suporte dentro de apps iOS e Android. O Chat tem um widget JavaScript para sites.

**Integrações e API.** O Intercom tem um marketplace de apps e uma API pública. O Chat ainda não tem API pública, nem webhooks de eventos de chat, nem exportação de conversas.

**Tickets, workflows e profundidade de relatórios.** O Intercom tem tickets, construtores visuais de fluxo e relatórios detalhados. Os relatórios do Chat cobrem um intervalo de datas, no total e por agente: conversas, primeira resposta média, tempo médio de resolução, resolvidas e CSAT, com exportação em CSV. O Chat não tem tickets nem construtor de fluxos.

**Maturidade.** Anos em produção em empresas muito grandes, certificações de segurança, recursos enterprise. Nossas peças enterprise (SSO/SAML, logs de auditoria, papéis personalizados e white-label para o widget) estão em desenvolvimento em `/ee`, não lançadas.

## Onde o Chat se garante

**O básico do suporte, feito com cuidado.**

- **Widget:** uma tag `<script>`, sua cor, canto inferior esquerdo ou direito, uma mensagem de boas-vindas e até 20 campos antes do chat (texto, email ou número). Visitantes podem mandar imagens, áudios e arquivos de até 10 MB, e veem indicador de digitação e confirmação de leitura.
- **Inbox:** estados aberta, pendente, adiada e resolvida; filtros de sem responsável e minhas; prioridades (low, medium, high, urgent); snooze que reabre sozinho.
- **Regras de atribuição:** palavra-chave, faixa de horário, round-robin e catch-all, avaliadas em ordem, sem nunca sobrescrever uma atribuição manual.
- **Políticas de SLA:** meta de primeira resposta e, opcional, de resolução por widget e por prioridade, com um selo ao vivo "Reply in Xm" ou "Breached" em cada conversa. Escrevemos um [playbook de SLAs de suporte com o Chat](/blog/slas-de-soporte-con-chat), incluindo onde o relógio é mais simples do que você talvez queira (ele corre em tempo de relógio, não em horário comercial).
- **Respostas prontas e macros:** digite `/` na caixa de resposta para buscar e inserir. Uma resposta pronta também pode mudar o status, atribuir, adiar ou adicionar tags à conversa.
- **Notas internas e tags:** notas no fio que o visitante nunca vê, com `@` para avisar um colega, e tags por conversa.
- **Horário de atendimento:** horário por dia e fuso; fora do horário, o widget mostra um aviso de ausência com quando vocês voltam.
- **CSAT:** nota de 1 a 5 com comentário opcional, pedida quando a conversa é resolvida.
- **Pessoas:** uma lista de visitantes com suas conversas e notas. Se o email de um visitante bate com um contato do zerosoft CRM, a conversa mostra esse contato.

**É seu.** AGPLv3, auto-hospedável, conversas no seu próprio banco de dados. Para times com exigências de residência de dados, ou que simplesmente não querem as conversas com clientes na nuvem de mais um fornecedor, isso importa.

**A suíte.** O Chat compartilha login, time e dados com CRM, Docs, Track, Cal e Link. Suas páginas do Docs podem alimentar o bot; seus contatos do CRM aparecem ao lado do chat.

**Preço que não pune o crescimento.** O Intercom combina preço por assento com cobranças por uso do agente de IA; confira a página de preços deles para os números atuais, porque eles mudam. O Chat auto-hospedado custa $0. O zerosoft Cloud tem um plano grátis para começar e depois cobra pelo uso do workspace, sem cobrança por assento.

## Quem deveria ficar no Intercom

Sinceramente, muitos times. Fique se:

- Você depende de um agente de IA para resolver uma parte relevante das conversas. O bot do Chat e o Agents ainda não chegam nesse nível.
- Você atende clientes em mais de um canal (email, WhatsApp, redes) e quer tudo num lugar só.
- Você precisa de uma central de ajuda com domínio próprio, tours de produto ou mensagens ativas.
- Você dá suporte dentro de um app móvel nativo.
- Seu stack de suporte depende de integrações (sincronização com CRM, ticketing, data warehouse) ou da API do Intercom.
- Você precisa de requisitos enterprise hoje: SSO, logs de auditoria, papéis personalizados, compliance formal.

Para esses times, migrar para o Chat seria um passo atrás.

## Para quem é o Chat

- Times pequenos (de duas a dez pessoas) atendendo o chat do site, em que o trabalho é "responder rápido e não deixar nada cair".
- Empresas que querem as conversas de suporte no próprio servidor, sob uma licença open source.
- Times que já usam o zerosoft CRM ou o Docs e querem o chat ao lado dos contatos e do conhecimento.
- Qualquer um que olhou uma fatura por assento mais cobrança por resolução e concluiu que o volume não justifica.

## Como testar

Crie um widget no **Chat**, copie o snippet de incorporação e coloque numa página de staging. Configure duas políticas de SLA, uma regra de atribuição e cinco respostas prontas. Se puder, rode por uma semana ao lado da sua ferramenta atual e compare com honestidade: se você sentiu falta do agente de IA todo dia, já tem sua resposta.

## Resumindo

O Intercom é, de longe, o produto mais capaz, principalmente em IA e canais. O Chat é um inbox de webchat focado, honesto e auto-hospedável, com os fundamentos do suporte (SLAs, regras, CSAT) incluídos. Escolha o que corresponde ao trabalho que você realmente tem.
