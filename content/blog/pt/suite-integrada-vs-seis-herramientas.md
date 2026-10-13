---
title: "Uma suíte ou seis ferramentas especializadas? Os tradeoffs honestos"
description: "Login compartilhado, um banco de dados e uma caixa de notificações, ou seis produtos especializados que vão mais fundo. O que as seis apps do Zerosoft compartilham hoje de verdade, o que não, e quando escolher os especialistas."
date: "2026-09-27"
author: "Zerosoftware"
tags: ["produto", "ferramentas", "arquitetura"]
---

Existem dois jeitos de equipar uma empresa pequena com software. Você escolhe a melhor ferramenta para cada tarefa — um encurtador de links, um CRM, um issue tracker, um agendador, uma caixa de suporte, uma wiki — e cola tudo junto. Ou escolhe uma suíte que faz as seis coisas, um pouco menos a fundo, mas num lugar só.

O Zerosoft é do segundo tipo. Isso nos deixa parciais, então este post se esforça para ser justo: o que ser "integrado" realmente oferece no nosso caso (verificado no código, não num slide), o que não oferece, e quando seis ferramentas especializadas são simplesmente a melhor resposta.

## O que "integrado" significa no Zerosoft, na prática

"Suíte integrada" é uma expressão que muitas vezes esconde um pacote de apps separadas com um logo em comum. Então aqui vai a lista do que os nossos seis produtos compartilham de verdade hoje:

- **Uma app, um login.** Link, CRM, Track, Cal, Chat e Docs são uma única aplicação Next.js. Você entra uma vez com o Google e está nas seis. Sem contas separadas, sem seis redefinições de senha.
- **Um mesmo modelo de workspace.** Times funcionam igual em todo lugar: um owner convida pessoas, cada membro é owner, admin ou member, e os membros operam dentro do workspace compartilhado. Você convida o colega uma vez; não precisa adicioná-lo em seis ferramentas.
- **Uma única caixa de notificações.** Menções, atribuições, mudanças de status e comentários do Track, mensagens novas do Chat e a ação "notificar usuário" dos workflows do CRM caem na mesma caixa.
- **O Chat conhece o seu CRM.** Quando um visitante numa conversa do Chat tem um e-mail que corresponde a um contato do CRM, o painel lateral da conversa mostra esse contato com um link direto para a ficha dele.
- **Uma única configuração do Google.** A sincronização do Gmail no CRM e a do Google Calendar no Cal reutilizam as mesmas credenciais de Google OAuth do login.
- **Uma chave de API, um sistema de webhooks.** Uma chave pessoal `zs_…` funciona em toda a API pública: `/api/v1/links`, `/api/v1/crm/*`, `/api/v1/calendar/*`. Os webhooks `link.created` / `link.clicked` do Link e os `booking.*` do Cal passam pela mesma máquina de entrega assinada e novas tentativas.
- **Um banco de dados.** Tudo mora num único banco libSQL — um só arquivo SQLite se você hospedar. Uma coisa para fazer backup, uma coisa para mover, uma coisa para consultar.

Esse último é subestimado. Quando contatos, agendamentos, issues e conversas estão num arquivo só, "onde estão os nossos dados?" tem uma resposta de uma palavra.

## O que *ainda* não está conectado

Igualmente concreto. São coisas que você poderia supor que uma suíte faz, e a nossa hoje não faz:

- **Agendamentos do Cal não criam nem atualizam contatos no CRM.** Alguém marca uma demo; o seu CRM não fica sabendo sozinho. (O webhook `booking.created` pode fazer a ponte, se você conectar.)
- **Cliques do Link não aparecem nos contatos do CRM.** O analytics do Link é sem cookies por design e não está ligado a pessoas.
- **O Chat não cria contatos no CRM.** Ele mostra o correspondente se já existir; não adiciona novos.
- **Páginas do Docs e issues do Track não se referenciam.** As menções `[[` do Docs apontam para outras páginas do Docs, não para issues.

Preferimos listar isso a deixar a palavra "integrado" trabalhar mais do que deveria. Se automação entre produtos é o seu principal motivo para mudar, compare esta lista com o seu fluxo de trabalho primeiro.

## Onde seis ferramentas especializadas ganham

Não vamos fingir. Uma empresa que faz só agendamento, ou só issue tracking, por uma década vai mais fundo que uma suíte que faz seis coisas. Concretamente, os especialistas estão na frente em:

- **Profundidade.** O HubSpot tem sequências de e-mail, rastreamento de abertura, orçamentos e produtos; o nosso CRM ainda não tem nada disso. O Linear tem atalhos de teclado e sincronização em tempo real; o Track não. O Notion tem coedição em tempo real e importações; o Docs não. O Calendly conecta com Outlook e iCloud; o Cal, por enquanto, é só Google.
- **Ecossistemas.** As ferramentas grandes têm marketplaces com centenas ou milhares de integrações. Nós temos uma API, webhooks e workflows no CRM. É um kit inicial, não um ecossistema.
- **Recursos de IA.** Vários concorrentes já têm recursos com LLM. O nosso bot do Chat faz correspondência de palavras-chave sobre respostas prontas e páginas de docs, e dizemos isso.
- **Apps móveis e maturidade.** Apps nativas, anos de casos extremos, papelada de compliance enterprise. Não temos apps móveis nativas, e os nossos recursos enterprise (SSO, logs de auditoria, papéis personalizados) estão [ainda em desenvolvimento](/blog/open-core-explicado).
- **Raio de impacto.** Com seis fornecedores, uma queda derruba uma ferramenta. Com uma suíte, um deploy ruim afeta tudo. Hospedar você mesmo permite escolher quando atualizar; não faz uma app única deixar de ser única.

Se uma dessas ferramentas é o coração do seu negócio — um time de vendas que vive de sequências, uma engenharia que precisa de boards em tempo real —, fique com o especialista para essa tarefa. Não é um fracasso da ideia de suíte. É a decisão certa.

## Onde a suíte ganha

As vantagens da suíte são menos chamativas e, para muitos times pequenos, maiores:

- **A cola desaparece.** Seis ferramentas exigem alguém para manter automações estilo Zapier, sincronizar usuários em seis painéis de admin e lembrar quem tem acesso a quê. Cada conexão é um mini projeto de integração que quebra em silêncio.
- **Entrada e saída de pessoas viram uma ação só.** Você adiciona uma pessoa ao time uma vez. Remove uma vez. Num stack de seis ferramentas, o checklist de offboarding é justamente por onde os acessos vazam.
- **Um modelo de cobrança, uma história de dados.** Preço por assento em seis produtos se multiplica rápido quando o time cresce: olhe qualquer uma das páginas de preço e multiplique. O Zerosoft é grátis para hospedar sob AGPLv3; o Zerosoft Cloud tem um plano gratuito generoso e depois cobra por uso, não por assento.
- **Uma exportação só, se você sair.** Os seus dados não ficam espalhados por seis formatos de exportação de seis fornecedores. Em self-host, é um arquivo SQLite que já é seu.

## Uma regra prática

Imagine uma agência hipotética de cinco pessoas: algumas centenas de contatos, chamadas com clientes marcadas por uma página de agendamento, um board de projetos, um widget de suporte em alguns sites de clientes e uma wiki interna. Nenhuma dessas tarefas é o produto principal dela. São o encanamento do negócio. Esse é o ponto ideal para uma suíte: boa o suficiente em tudo, um lugar só para olhar, nada para colar.

Agora imagine uma empresa de cinquenta pessoas, orientada a vendas, em que as sequências outbound *são* o negócio. Use um CRM especialista. Você ainda pode rodar Link, Cal ou Docs do Zerosoft ao lado: os produtos não exigem uns aos outros.

Talvez essa seja a coisa mais honesta sobre a nossa suíte: são seis produtos numa app, não um combo que você precisa engolir inteiro. Use os que servem e deixe o resto.
