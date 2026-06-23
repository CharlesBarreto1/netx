/**
 * Conteúdo inicial da wiki (base de conhecimento da equipe NetX). Inserido uma
 * vez quando a tabela está vazia (WikiService.onModuleInit). Depois é editável
 * pelo painel — re-seed NÃO sobrescreve edições.
 */
export type WikiAudience = 'INTERNAL' | 'CLIENT';

export interface SeedArticle {
  slug: string;
  title: string;
  category: string;
  audience: WikiAudience;
  orderIndex: number;
  content: string;
}

export const WIKI_SEED: SeedArticle[] = [
  {
    slug: 'visao-geral',
    title: 'Visão geral do Hub',
    category: 'Início',
    audience: 'INTERNAL',
    orderIndex: 1,
    content: `# Visão geral do NetX Hub

O Hub é a plataforma da **NetX (nós)** para licenciar e cobrar os provedores
(ISPs) que usam o NetX. Ele faz três coisas:

1. **Licenciamento** — assina diariamente um token (Ed25519) que cada instalação
   do NetX valida localmente. Sem token válido, o painel do ISP bloqueia.
2. **Cobrança** — gera faturas mensais por contrato ativo, recebe Pix (EFI) e
   controla inadimplência.
3. **Gestão** — cadastro de clientes (licenciados), instâncias e telemetria.

## Como as peças conversam

- O NetX do cliente faz **heartbeat diário** → o Hub assina um token de 7 dias.
- O token diz se a licença está \`ACTIVE\` ou \`BLOCKED\`. O NetX só confia na
  assinatura (chave pública embarcada); o Hub guarda a privada.
- Bloqueio nunca derruba a rede dos assinantes do ISP — só o painel de gestão.

> Detalhe técnico do lado do cliente: \`netx/docs/licensing.md\`.`,
  },
  {
    slug: 'cadastrar-cliente',
    title: 'Cadastrar e provisionar um cliente',
    category: 'Operação',
    audience: 'INTERNAL',
    orderIndex: 1,
    content: `# Cadastrar e provisionar um cliente

Passo a passo para colocar um novo ISP no ar:

1. **Cadastrar o licenciado** (Clientes → Novo cliente): nome, CNPJ/RUC,
   **preço por contrato** e **dia de vencimento**.
2. **Instalar o NetX** na VPS do cliente. O installer gera o \`NETX_INSTANCE_ID\`
   (fica em \`/etc/netx/.secrets\`).
3. **Vincular a instância** (detalhe do cliente → Instâncias → colar o
   \`NETX_INSTANCE_ID\` → Vincular). O Hub devolve a **license key** — ela
   aparece **uma única vez**, copie na hora.
4. Configurar no \`.env\` do cliente:
   \`\`\`
   NETX_HUB_URL=https://hub.seu-dominio
   NETX_LICENSE_KEY=<license key gerada>
   NETX_INSTANCE_ID=<o mesmo uuid>
   \`\`\`
5. **Criar acesso à central** (detalhe do cliente → Acesso à central): e-mail e
   senha que o ISP usará para ver faturas e pagar.

Pronto: no próximo heartbeat o cliente aparece com telemetria (versão, contratos
ativos, último contato).`,
  },
  {
    slug: 'faturamento',
    title: 'Faturamento e cobrança',
    category: 'Financeiro',
    audience: 'INTERNAL',
    orderIndex: 1,
    content: `# Faturamento e cobrança

- **Base de cálculo:** pico de contratos ativos no mês (telemetria do heartbeat)
  × **preço por contrato** do licenciado.
- **Geração:** automática no começo do mês (cron diário). Dá para gerar sob
  demanda no detalhe do cliente → Faturas → "Gerar fatura do mês".
- **Vencimento:** o \`billingDay\` do cliente.
- **Situações:** \`OPEN\` → \`PAID\` (pagou) ou \`OVERDUE\` (venceu + dias de graça).

## Dar baixa

- **Automática (Pix/EFI):** o webhook marca a fatura como paga sozinho.
- **Manual:** detalhe do cliente → Faturas → "Marcar paga" (quando o cliente
  pagou por fora).

> A graça antes de virar OVERDUE é \`LICENSE_GRACE_DAYS\` (padrão 2 dias).`,
  },
  {
    slug: 'bloqueio-desbloqueio',
    title: 'Bloqueio e desbloqueio',
    category: 'Financeiro',
    audience: 'INTERNAL',
    orderIndex: 2,
    content: `# Bloqueio e desbloqueio

O status que o cliente recebe no token é o **status efetivo**:

1. **Bloqueio manual (admin):** detalhe do cliente → Instâncias → "Bloquear".
   Tem prioridade — bloqueia independente de fatura.
2. **Inadimplência:** fatura vencida (além da graça) bloqueia automaticamente no
   próximo heartbeat — **a menos** que haja um desbloqueio em confiança vigente.

## Desbloqueio em confiança

O próprio cliente, na central, pode se desbloquear por um prazo curto
(\`TRUST_UNLOCK_DAYS\`, padrão 3) — limitado a \`TRUST_UNLOCK_MAX_PER_INVOICE\`
(padrão 1) por fatura em atraso. Serve para dar fôlego sem abrir suporte.

## Importante

O bloqueio trava **só o painel de gestão** do ISP. RADIUS/PPPoE dos assinantes
dele continuam funcionando — nunca derrubamos a rede por licença.`,
  },
  {
    slug: 'pagamento-pix-efi',
    title: 'Pagamento Pix (EFI)',
    category: 'Financeiro',
    audience: 'INTERNAL',
    orderIndex: 3,
    content: `# Pagamento Pix (EFI)

Pix imediato via EFI, com baixa automática por webhook.

## Configuração (\`.env\` do Hub)

\`\`\`
EFI_ENABLED=true
EFI_CLIENT_ID=...
EFI_CLIENT_SECRET=...
EFI_CERTIFICATE_BASE64=<.p12 em base64>
EFI_CERTIFICATE_PASSWORD=...
EFI_PIX_KEY=<chave Pix da NetX>
HUB_PUBLIC_URL=https://hub.seu-dominio
EFI_WEBHOOK_TOKEN=<aleatório>
\`\`\`

## Como funciona

1. Cliente clica "Pagar" na central → o Hub cria uma cobrança Pix e mostra
   copia-e-cola + QR (idempotente: reusa a cobrança vigente).
2. A EFI chama \`POST /v1/efi/webhook/pix/<EFI_WEBHOOK_TOKEN>\` quando paga.
3. O Hub acha a fatura pelo \`txid\` e marca como paga → o cliente sai do
   bloqueio no próximo heartbeat.

**Registre o webhook na EFI** apontando para essa URL (mTLS no proxy).
Com \`EFI_ENABLED=false\`, o "Pagar" orienta pagamento por fora + baixa manual.`,
  },
  {
    slug: 'backup',
    title: 'Backup e restauração',
    category: 'Operação',
    audience: 'INTERNAL',
    orderIndex: 2,
    content: `# Backup e restauração

Backup diário do Postgres do Hub via systemd timer.

- Script: \`deploy/backup/netx-hub-backup.sh\` (pg_dump validado + retenção +
  rclone off-site opcional).
- Dumps em \`/var/backups/netx-hub/auto\`.
- Off-site: configure \`rclone\` e \`HUB_BACKUP_REMOTE\` no \`.env\`.

## Rodar manual / testar
\`\`\`
sudo systemctl start netx-hub-backup.service
journalctl -u netx-hub-backup -n 50
\`\`\`

## Restaurar
\`\`\`
pg_restore --clean --if-exists -d "$DATABASE_URL" /var/backups/netx-hub/auto/netxhub-<stamp>.dump
\`\`\``,
  },
  {
    slug: 'chaves-licenca',
    title: 'Chaves de licença (segurança)',
    category: 'Operação',
    audience: 'INTERNAL',
    orderIndex: 3,
    content: `# Chaves de licença

O Hub assina tokens com uma **chave privada Ed25519**. O NetX valida com a
**pública** embarcada nele.

- Gerar par: \`npm run keygen\` → privada no \`.env\` (\`LICENSE_PRIVATE_KEY_B64\`),
  pública em \`netx/packages/shared/src/licensing/public-key.ts\`.
- **A privada nunca vai pro git.** Guarde em cofre. Se vazar, dá pra forjar
  licença — rotacione (gera par novo, atualiza o NetX dos clientes com
  \`sudo netx-update\`).
- License keys dos clientes ficam como **sha256** (a key em claro aparece só na
  criação). Perdeu? Use "Nova key" no detalhe da instância.

> DEV usa um par fixo guardado fora do repo; PROD usa um par próprio.`,
  },
  {
    slug: 'troubleshooting',
    title: 'Solução de problemas',
    category: 'Suporte',
    audience: 'INTERNAL',
    orderIndex: 1,
    content: `# Solução de problemas

### Cliente diz que o painel bloqueou "do nada"
- Veja em Instâncias se o status é \`BLOCKED\` (bloqueio manual) ou se há fatura
  \`OVERDUE\`. Inadimplência bloqueia automático.
- Solução rápida: o cliente pode usar "desbloquear em confiança" na central, ou
  você dá baixa/desbloqueia manual.

### Instância não aparece / sem telemetria
- O heartbeat é diário. Confira no cliente: \`NETX_HUB_URL\`,
  \`NETX_LICENSE_KEY\`, \`NETX_INSTANCE_ID\` no \`.env\` e se a VPS tem internet.
- Force no cliente: \`POST /v1/license/heartbeat\` (admin) ou reinicie o core.

### Pagou e não baixou
- Confira se o webhook da EFI está registrado e acessível
  (\`/v1/efi/webhook/pix/<token>\`). Em último caso, baixa manual em Faturas.

### "Licença inválida" no cliente
- A chave pública embarcada no NetX precisa casar com a privada do Hub. Se
  rotacionou a chave, rode \`sudo netx-update\` no cliente.`,
  },

  // ===========================================================================
  // ARTIGOS DO CLIENTE (central de ajuda no portal — audience CLIENT)
  // Documentação do produto NetX para o ISP que usa o sistema.
  // ===========================================================================
  {
    slug: 'cliente-bem-vindo',
    title: 'Bem-vindo ao NetX',
    category: 'Começando',
    audience: 'CLIENT',
    orderIndex: 1,
    content: `# Bem-vindo ao NetX

O NetX é a plataforma que gerencia o seu provedor de internet de ponta a ponta:
clientes, contratos, rede (RADIUS/PPPoE, OLT/ONT), financeiro e estoque — tudo
num só sistema, rodando na sua infraestrutura.

Esta central é o seu canal com a **NetX**: aqui você acompanha sua licença, suas
faturas e encontra ajuda para usar o sistema.

## O que você consegue fazer aqui na central

- Ver a **situação da sua licença** (em dia / em atraso).
- Acompanhar e **pagar suas faturas** (Pix).
- **Desbloquear em confiança** se ficar bloqueado por atraso, enquanto regulariza.
- Consultar esta **central de ajuda**.

> Dúvidas que não estão aqui? Fale com o suporte NetX (artigo "Suporte e contato").`,
  },
  {
    slug: 'cliente-primeiros-passos',
    title: 'Primeiros passos no sistema',
    category: 'Começando',
    audience: 'CLIENT',
    orderIndex: 2,
    content: `# Primeiros passos no NetX

1. **Acesse o painel** do NetX (o endereço da sua instalação) com o usuário
   admin criado na instalação.
2. **Configure sua operação** em Configurações: país, moeda, dados da empresa.
3. **Cadastre seus planos** de internet (velocidade e preço).
4. **Cadastre o primeiro cliente** e crie um **contrato** para ele.
5. **Ative o cliente** (provisionamento) — veja o artigo específico.

Dica: o painel tem busca rápida (atalho no topo) para achar cliente, contrato ou
ordem de serviço sem navegar por menus.`,
  },
  {
    slug: 'cliente-clientes-contratos',
    title: 'Clientes e contratos',
    category: 'Uso diário',
    audience: 'CLIENT',
    orderIndex: 1,
    content: `# Clientes e contratos

- **Cliente** é a pessoa/empresa (PF/PJ). Um cliente pode ter vários contratos.
- **Contrato** liga o cliente a um **plano**, define a forma de autenticação
  (PPPoE é o padrão), o vencimento e o endereço de instalação.
- Ao criar o contrato, ele nasce em **Aguardando instalação**; vira **Ativo**
  quando o cliente é provisionado em campo.

## Faturas dos seus assinantes

O NetX gera as **mensalidades** dos seus assinantes automaticamente e marca as
vencidas. O pagamento pode suspender/reativar o contrato conforme as regras do
seu plano (dias de tolerância).`,
  },
  {
    slug: 'cliente-ativar-assinante',
    title: 'Ativar (provisionar) um assinante',
    category: 'Uso diário',
    audience: 'CLIENT',
    orderIndex: 2,
    content: `# Ativar um assinante

Quando o técnico instala o cliente em campo:

1. Abra o contrato em **Aguardando instalação**.
2. Informe os dados da ONT (número de série) e a posição na rede, se aplicável.
3. O NetX provisiona automaticamente: autoriza na OLT (quando integrado),
   cria a sessão PPPoE no RADIUS e aplica a configuração (Wi-Fi, VLAN).
4. O contrato passa a **Ativo** e o assinante navega.

> Em rede neutra (ex.: Ufinet), a ativação dispara a ordem no orquestrador e
> aguarda a confirmação da ONT física.`,
  },
  {
    slug: 'cliente-licenca-central',
    title: 'Sua licença e a central',
    category: 'Licença e cobrança',
    audience: 'CLIENT',
    orderIndex: 1,
    content: `# Sua licença NetX

O seu NetX é licenciado pela NetX. O sistema confirma a licença automaticamente
todo dia — você não precisa fazer nada enquanto estiver tudo em dia.

## Se o painel bloquear

Se uma fatura vencer, o **painel de gestão** do NetX pode ser bloqueado até a
regularização. Importante: **a internet dos seus assinantes NÃO para** — apenas
o painel administrativo fica indisponível.

O que fazer:
1. Acesse esta central e veja suas **faturas**.
2. **Pague** a fatura em aberto (Pix) — a liberação é automática.
3. Precisa de um prazo? Use **"Desbloquear em confiança"**: libera o painel por
   alguns dias enquanto você regulariza (limitado por fatura).

> A baixa do Pix é automática; o painel volta sozinho em seguida.`,
  },
  {
    slug: 'cliente-pagar-fatura',
    title: 'Pagar uma fatura',
    category: 'Licença e cobrança',
    audience: 'CLIENT',
    orderIndex: 2,
    content: `# Pagar uma fatura

1. Na central, abra **Faturas**.
2. Na fatura em aberto, clique em **Pagar**.
3. Aparece um **Pix** (QR Code + copia-e-cola). Pague pelo app do seu banco.
4. A confirmação é **automática** — assim que o banco confirma, a fatura fica
   como paga e qualquer bloqueio é liberado no próximo ciclo.

Pagou e não atualizou na hora? O Pix pode levar alguns minutos. Se persistir,
fale com o suporte NetX com o comprovante.`,
  },
  {
    slug: 'cliente-suporte',
    title: 'Suporte e contato',
    category: 'Ajuda',
    audience: 'CLIENT',
    orderIndex: 1,
    content: `# Suporte e contato

Precisa de ajuda com o NetX?

- Procure primeiro nesta **central de ajuda** — a maioria das dúvidas do dia a
  dia está aqui.
- Para suporte técnico ou comercial, fale com a equipe NetX pelos canais
  informados no seu contrato.

Ao abrir um chamado, tenha em mãos: o que tentou fazer, a mensagem de erro (se
houver) e, para questões de cobrança, o número/competência da fatura.`,
  },
];
