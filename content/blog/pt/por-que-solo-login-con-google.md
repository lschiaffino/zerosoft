---
title: "Por que só temos 'Continuar com o Google'"
description: "Não é preguiça: senhas são o elo mais fraco da segurança moderna, e delegar o login é delegá-lo a quem faz isso melhor. Os trade-offs, sem rodeios."
date: "2026-06-13"
author: "Zerosoftware"
tags: ["segurança", "oauth", "login"]
---

Quando você abre o Link, existe um único botão: **Continuar com o Google**. Não há formulário de cadastro, não há email + senha, não há "esqueci minha senha". Não é uma decisão de design preguiçosa. É uma decisão de segurança, e vale a pena explicá-la direito.

## A senha é o elo fraco

Os dados contam a mesma história há anos:

- Mais da metade das pessoas reutiliza a mesma senha em vários serviços (pesquisa Google/Harris, 2019: 52%). Uma em cada oito reutiliza em todos.
- O HaveIBeenPwned acumula mais de 12 bilhões de contas vazadas em breaches.
- O Verizon DBIR repete a cada edição: a maioria dos comprometimentos começa com credenciais roubadas, fracas ou capturadas por phishing.

O problema é estrutural. Cada serviço que pede para você criar uma senha está pedindo duas coisas: que você escolha uma boa e que eles a guardem bem. Uma das duas sempre falha. E quando falha, o atacante não testa aquela senha só ali: testa no seu email, no seu banco e no seu trabalho.

Enquanto isso, do outro lado do botão há milhares de engenheiros de segurança, detecção de login anômalo, 2FA, passkeys e modelos anti-phishing que, pelos próprios números publicados pelo Google, bloqueiam 99,9% dos ataques automatizados. Nenhuma startup do mundo consegue igualar isso. Nós também não. Então não competimos: delegamos.

## O que isso significa para você

- **Nada para lembrar.** Nem senha, nem uma segunda senha "só para este app", nem rotação a cada 90 dias.
- **Nada para hackear.** Se amanhã alguém roubar nosso banco de dados, não há hashes para quebrar. A coluna de senhas não existe. Não vaza o que não guardamos.
- **Sua sessão herda a segurança da sua conta Google**, que provavelmente já é a conta mais protegida que você tem: 2FA, alertas de dispositivo novo, passkey.

## Os trade-offs, com honestidade

Seria desonesto vender isso como pura vantagem. Não é:

- **Você precisa de uma conta Google.** Se não tem ou não quer ter, hoje não consegue usar o cloud da Zerosoftware. O self-host, por outro lado, não pede login.
- **Dependemos da disponibilidade do Google.** Se o auth deles cai, o login cai. Seus links e a API com API keys continuam funcionando — o redirect não depende do login — mas o painel, sim.
- **O Google fica sabendo que você entra aqui.** Pedimos apenas email e nome; ele não vê sua atividade nem seus dados. Mas esse metadado existe, e se isso incomoda, a resposta é o self-host.

## Vamos adicionar mais providers?

Sim, quando somarem sem quebrar a propriedade-chave: não existir nenhum segredo compartilhado nos nossos servidores. GitHub e Microsoft cumprem. Passkeys cumprem ainda melhor — são o futuro óbvio do login — e provavelmente são o próximo passo.

Email + senha? Não. Esse formulário não volta. A forma mais segura de guardar senhas é não guardá-las.
