# Handoff: NetX — Shell + Dashboard Operacional

## Overview
NetX é uma plataforma SaaS de gestão para provedores de internet (ISPs) no Brasil e Paraguai.
Esta entrega cobre **(a) o shell completo da aplicação** (top bar, navegação lateral composta por
módulos licenciados, rail direito do copiloto de IA) e **(b) o dashboard operacional** dentro dele,
com três "lentes" por papel (Operador, NOC, Financeiro) que reconfiguram a mesma base — não são
apps separados.

Princípios de produto que a implementação NÃO pode perder:
1. **Painel único (single pane of glass)** — tudo num só app. A navegação se **compõe** a partir
   dos módulos licenciados; módulos não comprados aparecem como **"Disponível · ativar"** (upsell
   dentro do produto), nunca somem.
2. **Copiloto de IA "Conselheira"** — sugere, correlaciona e explica, mas **nunca age sozinha**:
   toda ação passa por um passo de confirmação humana explícito. Isso é um requisito de UX, não
   um detalhe. O fluxo é `propor → confirmar (humano) → aplicado/registrado em log`.
3. **Tempo real** — feed de eventos ao vivo conecta os módulos.
4. **Busca global / command palette (Cmd/Ctrl+K)** alcança assinante, equipamento, fatura, chamado
   e ações de qualquer lugar.

## About the Design Files
O arquivo neste pacote (`NetX.dc.html`) é uma **referência de design criada em HTML** — um protótipo
que demonstra o visual e o comportamento pretendidos, **não código de produção para copiar
diretamente**. A tarefa é **recriar este design no ambiente do codebase de destino** (React, Vue,
etc.), usando os padrões, a biblioteca de componentes e as convenções já estabelecidas lá. Se ainda
não existir um ambiente front-end, escolha o framework mais adequado ao projeto e implemente o design
nele.

> Nota técnica sobre o formato: `.dc.html` é um formato de protótipo. A lógica vive numa classe
> `Component` (estado + `renderVals()`) e o template usa `{{ }}` para interpolação e
> `<sc-for>`/`<sc-if>` para repetição/condicional. Trate isso como pseudocódigo de referência —
> mapeie estado para `useState`/store e os blocos `sc-*` para `.map()`/render condicional do seu
> framework. **Todos os estilos são inline** no protótipo apenas para facilitar a renderização; no
> codebase real use o sistema de estilo de vocês (CSS Modules, Tailwind, styled-components, etc.).

## Fidelity
**High-fidelity (hifi).** Cores, tipografia, espaçamento e interações são finais e intencionais.
Recriar a UI fielmente usando as bibliotecas/padrões do codebase. Os valores exatos estão em
**Design Tokens** abaixo.

---

## Design Tokens

### Cores — superfícies (tema escuro, padrão)
| Token | Valor | Uso |
|---|---|---|
| `--bg-app` | `#0a0a0b` | fundo da aplicação / área de conteúdo |
| `--bg-chrome` | `#0c0c0e` | top bar |
| `--bg-panel` | `#0b0b0d` | nav lateral e rail direito |
| `--bg-card` | `#0f0f12` | cards, KPIs, painéis |
| `--bg-card-inset` | `#0b0b0d` | linhas/itens dentro de card (ex. alarmes) |
| `--bg-elevated` | `#121215` | command palette, popovers |
| `--bg-input` | `#0f0f12` | campo de busca |
| `--bg-pill` | `#1c1c20` | chips/avatares neutros |
| `--bg-pill-active` | `#26262b` | item ativo do segmented control (lentes) |

### Cores — bordas e texto
| Token | Valor |
|---|---|
| `--border-subtle` | `rgba(255,255,255,0.07)` (divisórias de chrome/card) |
| `--border-hairline` | `rgba(255,255,255,0.045)` (linhas de tabela) |
| `--border-input` | `rgba(255,255,255,0.08)` |
| `--border-dashed` | `rgba(255,255,255,0.10)` (módulos "Disponível") |
| `--text-primary` | `#ededef` |
| `--text-strong` | `#f4f4f6` (números/valores grandes) |
| `--text-secondary` | `#cfcfd6` |
| `--text-muted` | `#9b9ba3` |
| `--text-dim` | `#82828b` |
| `--text-faint` | `#6e6e77` |
| `--text-disabled` | `#56565e` (labels de seção uppercase) |

### Cores — marca e semânticas (OKLCH)
A marca e os estados usam OKLCH para manter lightness/chroma harmônicos. Cada "tom" tem 3 papéis:
**texto** (claro), **fundo** (mix translúcido) e **sólido** (dot/barra/preenchimento).

| Tom | Texto | Fundo (chip/badge) | Sólido |
|---|---|---|---|
| **brand** (azul) | `oklch(0.74 0.14 250)` | `color-mix(in oklch, oklch(0.62 0.17 250) 16%, transparent)` | `oklch(0.62 0.17 250)` |
| **green** (saúde ok / pago) | `oklch(0.84 0.13 150)` | `…oklch(0.74 0.16 150) 15%…` | `oklch(0.74 0.16 150)` |
| **amber** (alerta / pendente) | `oklch(0.86 0.13 80)` | `…oklch(0.8 0.14 80) 15%…` | `oklch(0.8 0.14 80)` |
| **red** (crítico / atraso) | `oklch(0.8 0.16 22)` | `…oklch(0.64 0.2 22) 17%…` | `oklch(0.64 0.2 22)` |
| **violet** (IA / copiloto) | `oklch(0.82 0.12 295)` | `…oklch(0.66 0.17 295) 15%…` | `oklch(0.66 0.17 295)` |
| **muted** (neutro) | `#9b9ba3` | `rgba(255,255,255,0.06)` | `#71717a` |

Regra de cor do brief: **cor de marca dominante + neutros; cores semânticas reservadas para estado.
Não decorar com cor.** O **violeta é exclusivo da IA** — é o que a distingue visualmente como
"proposta, não ação".

### Tipografia
- **UI:** `Geist` (300/400/500/550/600/700). `-webkit-font-smoothing: antialiased`.
- **Dados/números/IDs/timestamps:** `Geist Mono` (400/500/600).
- `letter-spacing` global do corpo: `-0.006em`; títulos: `-0.02em`.

| Papel | Família | Tamanho | Peso | Notas |
|---|---|---|---|---|
| Título de página (h1) | Geist | 23px | 600 | `letter-spacing:-0.02em` |
| Subtítulo de página | Geist | 13px | 400 | `#82828b` |
| Valor de KPI | Geist Mono | 21px | 550 | |
| Número grande (gráficos) | Geist Mono | 27px | 600 | |
| Título de card | Geist | 14px | 600 | |
| Corpo / célula de tabela | Geist | 12.5px | 450–500 | |
| Label de seção | Geist | 10px | 600 | uppercase, `letter-spacing:0.08em`, `#56565e` |
| Cabeçalho de tabela | Geist | 10.5px | 600 | uppercase, `letter-spacing:0.04em` |
| Badge / status | Geist | 10.5px | 600 | |
| Tecla / atalho (kbd) | Geist Mono | 11px | 400 | borda `1px`, radius 5px |

### Espaçamento, raios e sombra
- **Raios:** botões/inputs `8–9px`; cards `12–14px`; chips/badges `5–6px`; avatares `7–8px`;
  ícone de módulo `6px`; command palette `15px`.
- **Padding de card:** `18px`; KPI `13px 14px`; itens de nav `7px 9px`.
- **Gaps de grid/flex:** entre cards `16px`; entre KPIs `12px`; dentro de linha `8–12px`.
- **Sombra:** sutil. Item ativo do segmented control `0 1px 2px rgba(0,0,0,.3)`; command palette
  `0 24px 60px rgba(0,0,0,.6)`. Sem sombras pesadas em cards.
- **Seleção de texto:** `background: color-mix(in oklch, oklch(0.62 0.17 250) 40%, transparent)`.

### Dimensões do layout
| Elemento | Valor |
|---|---|
| Top bar (altura) | `54px` |
| Nav lateral (largura) | `236px` |
| Rail direito aberto | `344px` |
| Rail direito recolhido | `52px` |
| Campo de busca (max-width) | `440px` |
| Conteúdo central (max-width) | `1180px`, centralizado, padding `22px 26px 60px` |
| Command palette (largura) | `600px` (max 92vw), abre a `13vh` do topo |

---

## Layout geral (3 colunas + chrome)
Coluna fixa de chrome no topo (`54px`), depois uma faixa flex de 3 colunas ocupando o resto da altura:
```
┌──────────────────────────── TOP BAR (54px) ────────────────────────────┐
│ logo │ instância │ busca Cmd+K │  …  │ status rede │ sino │ avatar       │
├────────────┬───────────────────────────────────────┬────────────────────┤
│  NAV       │  CONTEÚDO (scroll, max 1180px)         │  RAIL IA (344px)   │
│  236px     │  header + lentes                       │  copiloto + feed   │
│  (scroll)  │  KPI strip (6, auto-fit)               │  (scroll)          │
│            │  painéis da lente ativa                │  ou recolhido 52px │
└────────────┴───────────────────────────────────────┴────────────────────┘
```
- A página inteira é `position:fixed; inset:0` com `overflow:hidden`; **cada coluna rola
  independentemente** (`overflow-y:auto`). Não há scroll do body.
- Scrollbars finas customizadas (`10px`, thumb `rgba(255,255,255,0.09)`, hover `0.16`).

---

## Screens / Views

### 1. Top bar
**Propósito:** identidade, navegação de contexto e busca global sempre acessíveis.
Da esquerda para a direita:
- **Logo slot** — placeholder com borda **tracejada** (`1px dashed rgba(255,255,255,0.14)`, radius 9px,
  altura 34px) contendo um quadrado de marca `20px` radius 6px em `oklch(0.62 0.17 250)` com um ícone
  de "linhas" (hambúrguer) branco, e o wordmark **"Net" + "X"** (o "X" em `oklch(0.7 0.16 250)`),
  15px/600. **O usuário vai anexar o logo real depois** — manter como slot.
- **Instance switcher** — botão com avatar quadrado "AT" (24px, `#1c1c20`), nome **"ASU Telecom"**
  (12.5px/550) + sublinha **"Asunción · PY"** (10.5px, `#6e6e77`), chevron. Hover
  `background:rgba(255,255,255,0.05)`. `white-space:nowrap`.
- **Busca global** — botão (não input) `flex:1; max-width:440px`, altura 34px, `#0f0f12`, borda
  `0.08`. Ícone de lupa + texto truncado "Buscar assinante, equipamento, fatura…" + kbd **⌘K**.
  Hover clareia borda. **Abre o command palette.**
- *(spacer flex)*
- **Status da rede** — chip verde: `background …oklch(0.74 0.16 150) 11%…`, borda `…24%…`, dot 7px
  **com pulso** (animação `nxLivePulse` 2.4s infinito), texto **"Rede operacional"** + **"99,2%"** mono.
- **Sino de notificações** — botão 34px quadrado com borda; dot vermelho `oklch(0.64 0.2 22)` no canto
  (badge de não-lida, com anel `1.5px` da cor do chrome).
- **Avatar de perfil** — 28px radius 8px, gradiente `135deg, oklch(0.62 0.17 250) → oklch(0.55 0.16 280)`,
  iniciais "JG".

### 2. Navegação lateral (composta por módulos) — `236px`
**Propósito:** mostrar que a UI se compõe dos módulos licenciados; o que não foi comprado vira upsell.
Estrutura (flex column, gap 3px, scroll):
- **Seção "NÚCLEO"** (label uppercase): `Dashboard` (item **ativo**), `Assinantes`,
  `Elementos de rede`, `Eventos`. Cada item: ícone 16px + label 13px, padding `7px 9px`, radius 8px.
  - **Item ativo** (Dashboard): `background: …oklch(0.62 0.17 250) 14%…`,
    `box-shadow: inset 2px 0 0 oklch(0.62 0.17 250)` (barra de acento à esquerda), ícone em
    `oklch(0.72 0.15 250)`, texto `#ededef`/550.
  - **Item inativo:** texto `#b6b6bd`. Hover `background:rgba(255,255,255,0.045); color:#ededef`.
- **Seção "MÓDULOS"** — cada módulo é um **grupo colapsável** (botão com chevron que rotaciona
  0→90° via `transform:rotate(); transition .15s`). Ícone do módulo num quadrado 22px radius 6px
  (`#161619`) com glyph em `oklch(0.78 0.13 250)`. Sub-itens aparecem indentados com **borda-guia
  vertical à esquerda** (`margin-left:10px; border-left:1px solid rgba(255,255,255,0.07)`).
  - **ERP** (expandido por padrão): Financeiro, Faturamento, Clientes, Provisionamento, Estoque.
  - **NMS**: Topologia, Dispositivos, Configurações.
  - **Monitor** (mostra badge âmbar **"3"** = alarmes): Monitoramento, Alarmes.
  - **CPE**: TR-069, OLTs.
  - **Call**: Atendimento, WhatsApp, Instagram.
- *(spacer flex empurra o resto para baixo)*
- **Seção "DISPONÍVEL"** (label + linha divisória) — módulos **não licenciados**, estado bloqueado
  elegante: botão com **borda tracejada** (`1px dashed rgba(255,255,255,0.1)`), texto `#6e6e77`,
  ícone em quadrado `#0f0f12`, e um **chip "Ativar"** à direita (`oklch(0.7 0.16 250)` sobre
  `…12%…`, radius 6px). Hover clareia a borda para o azul de marca. Itens: **Maps**, **RH**.
  *(Estes dois são o upsell — não confundir com módulos ativos.)*

### 3. Conteúdo central — header + lentes
- **Breadcrumb:** "ASU Telecom / Dashboard" (12px, `#6e6e77`).
- **Título + subtítulo** mudam por lente (ver tabela em *State*).
- **Lens switcher** (canto superior direito): label "LENTE" + **segmented control** — `#0f0f12`,
  borda `0.08`, radius 10px, padding 3px. Cada botão `padding:6px 14px`, radius 8px, 12.5px/550.
  **Ativo:** `background:#26262b; color:#f4f4f6; box-shadow:0 1px 2px rgba(0,0,0,.3)`.
  **Inativo:** transparente, `color:#82828b`, hover `color:#ededef`. `transition:all .12s`.
  Opções: **Operador · NOC · Financeiro**.

### 4. KPI strip
6 cards em grid `repeat(auto-fit, minmax(148px, 1fr))`, gap 12px. Cada card (`#0f0f12`, borda `0.07`,
radius 12px, padding `13px 14px`):
- dot 6px da cor do tom + label 11px/500 `#82828b`;
- valor em **Geist Mono 21px/550** `#f4f4f6`;
- delta: chip mono 11px com `badge(tom)` (cor+fundo) + sublabel 11px `#6e6e77`.

Os 6 KPIs **trocam de conteúdo conforme a lente** — ver *State / dados por lente*.

### 5. Painéis — Lente OPERADOR
Grid de 2 linhas:
- **Linha 1** (`grid-template-columns: 1.45fr 1fr`):
  - **Saúde da rede** — card com **donut conic-gradient** 128px (verde 95,1% / âmbar 3,3% / vermelho
    1,6%), furo central `#0f0f12` 100px mostrando "99,2%" (verde) + "2.341 nós". Ao lado, lista de
    **regiões** com barra de progresso por região (Asunción Centro 99,8% verde, Norte 97,4% âmbar,
    Central·Luque 99,9% verde, Encarnación 94,1% vermelho). Link "Ver topologia →".
  - **Faturamento do mês** — valor "R$ 1,84M" mono 27px, chip verde "+4,8%", subtexto
    "Meta R$ 1,90M · 88% recebido", e **sparkline de área** (linha `oklch(0.7 0.16 250)` + gradiente
    `nxRev` azul→transparente). Eixo jan/jun/dez.
- **Linha 2** (`1fr 1.45fr`):
  - **Base de assinantes** — dois números (18.432 ativos / 1.287 inadimpl.) com legenda quadrada
    verde/âmbar, e **gráfico de duas linhas** (ativos sólido verde, inadimplência tracejada âmbar
    `stroke-dasharray:3 3`).
  - **Incidentes abertos** — **tabela** `grid-template-columns: 1fr 92px 84px 60px`: Incidente
    (título + ID mono) · Região · SLA (mono, cor por urgência) · Severidade (badge P1 red / P2 amber /
    P3 muted). 5 linhas. Header uppercase 10.5px. Linhas separadas por `border-bottom hairline`.
    Link "Abrir NOC →".

### 6. Painéis — Lente NOC
- **Linha 1** (`1.45fr 1fr`):
  - **Tráfego agregado** — legenda Ingress (azul) / Egress (violeta `oklch(0.66 0.17 295)`),
    "428,6 Gbps pico", gráfico de **duas linhas + área** (ingress com gradiente `nxIng`). Eixo
    00h/12h/agora.
  - **Alarmes ativos** — lista de cards-linha (`#0b0b0d`, borda `0.06`, **borda-esquerda 2px da cor
    do alarme**): dot + texto + nó (mono) + "há Xm". 4 alarmes (red/amber).
- **Linha 2** (largura cheia):
  - **Elementos de rede** (multivendor, NMS) — tabela `1.4fr 90px 80px 1fr 80px`: Elemento (dot de
    status + nome mono + vendor) · Tipo · Status (badge) · **Carga** (barra de progresso + % mono) ·
    Uptime (mono). 5 linhas (OLT-ASU-01 down, SW-CORE-02 alerta 88%, RTR-BORDER-01 online, etc.).
    Link "Ver todos (2.341) →".

### 7. Painéis — Lente FINANCEIRO
- **Linha 1** (`1.45fr 1fr`):
  - **MRR** — "R$ 1,84M /mês", chip verde "+4,8%", **gráfico de barras** 12 meses (último mês em
    azul sólido `oklch(0.62 0.17 250)`, demais em mix 42%), label do mês mono 9px sob cada barra.
  - **Inadimplência por faixa** — "R$ 218k em 1.287 contratos", 4 barras de aging (1–15d âmbar 41%,
    16–30d 28%, 31–60d 20%, +60d vermelho 11%) com valor mono à direita.
- **Linha 2** (largura cheia):
  - **Faturas recentes** (ciclo atual, ERP) — tabela `1.3fr 1fr 100px 96px 90px`: Assinante (avatar
    iniciais + nome) · Fatura (ID mono) · Venc. (mono) · Valor (mono) · Status (badge:
    Pago green / Atraso red / Pendente amber / Aberta muted). 6 linhas. Link "Ver financeiro →".

### 8. Rail direito — Copiloto de IA "Conselheira" (`344px`)
**O elemento mais importante de UX.** Cor temática **violeta** em tudo. Recolhível.
- **Header:** ícone "sparkle" 28px em quadrado violeta (`…18%…`, borda `…32%…`), título
  **"Copilot NetX"**, sublinha **"Conselheira · sugere, você decide"**, botão de recolher (chevron →).
  Abaixo, faixa de aviso violeta com ícone "info": **"Nunca age sozinha — toda ação exige sua
  confirmação."**
- **Sugestões da IA** (label "SUGESTÕES DA IA · {lente}"): cards com **borda tracejada violeta**
  (`1px dashed …oklch(0.66 0.17 295) 38%…`) e fundo `…6%…` — o tracejado comunica "proposta, ainda
  não aplicada". Cada card:
  - linha de meta: badge **"SUGESTÃO"** (uppercase, violeta) + texto de correlação (ex. "ERP × Call")
    + % de confiança (mono, à direita, ex. "92%");
  - título 13px/600 + corpo 12px `#9b9ba3`;
  - **estado IDLE:** botão primário azul com label de ação (ex. "Preparar lembrete (47)", seta →) +
    botão "Dispensar".
- **Máquina de estados da sugestão (REQUISITO DE UX — humano sempre aplica):**
  `idle → confirm → done` (ou `idle → dismissed`).
  - **confirm:** aparece um bloco **âmbar** (`#0a0a0b`, borda `…oklch(0.8 0.14 80) 30%…`) com ícone
    de alerta e o texto **"Só você aplica esta ação"** + uma nota do que será feito (ex. "Vou
    enfileirar 47 mensagens… Nada é enviado até você confirmar aqui."). Botões: **"Confirmar e
    aplicar"** (verde, texto escuro `#06140c`) + "Cancelar".
  - **done:** bloco **verde** com check, **"Aplicado por você"** + "agora · registrado no log de
    auditoria".
  - As sugestões e suas notas de confirmação **mudam por lente** (ver *State*).
- **Eventos ao vivo** (label + dot verde pulsante + "tempo real"): **timeline** vertical (dot da cor
  do módulo + linha-guia), cada evento com chip de módulo colorido (ERP/CPE/NMS/Monitor/Call) +
  timestamp mono + texto. Novos eventos entram no topo a cada ~4,8s com animação `nxEventIn`
  (fade + slide-down 0.35s), lista limitada a ~22.
- **Rail recolhido (`52px`):** só o botão sparkle violeta (com badge de contagem "2") + dot verde
  pulsante. Clica para reabrir.

### 9. Command palette (Cmd/Ctrl+K)
Overlay `rgba(0,0,0,0.55)` + `backdrop-filter:blur(3px)`, z-index 90, modal `600px` a 13vh do topo,
`#121215`, radius 15px, sombra `0 24px 60px rgba(0,0,0,.6)`. Anima com `nxFadeIn`/`nxScaleIn`.
- **Input** com lupa + placeholder "Buscar assinante, equipamento, fatura, chamado ou ação…" + kbd "esc".
- **Resultados agrupados** (label de grupo uppercase): Assinantes, Equipamentos, Faturas, Chamados,
  **Ações** (Criar assinante, Abrir incidente, "Trocar lente → NOC"), **Ir para** (Dashboard,
  Topologia, Financeiro). Cada item: glyph/iniciais em quadrado 28px colorido por tipo + label +
  hint + seta →. Hover `rgba(255,255,255,0.06)`.
- **Filtragem:** por substring case-insensitive sobre `label + hint`; grupos vazios somem; se nada
  casar, mostra "Nenhum resultado para …".
- **Rodapé:** dicas de atalho (↑↓ navegar, ↵ abrir) + "Busca global NetX".

---

## Interactions & Behavior
- **Troca de lente:** clicar em Operador/NOC/Financeiro troca título, subtítulo, os 6 KPIs e o bloco
  de painéis, **e** o conjunto de sugestões da IA. Persistido em `localStorage` (`netx.ui.lens`).
- **Recolher/expandir rail:** botão no header (ou no strip recolhido). Persistido
  (`netx.ui.railOpen`).
- **Expandir/recolher módulo na nav:** chevron rotaciona 0↔90°, sub-itens entram/saem.
- **Command palette:** abre com **⌘K / Ctrl+K** (preventDefault) ou clicando na busca da top bar;
  fecha com **Esc** ou clique no backdrop (clique no modal não propaga). Input com autofocus.
- **Fluxo da sugestão de IA:** "propor" → estado **confirm** → "Confirmar e aplicar" → estado
  **done**; "Dispensar" remove o card; "Cancelar" volta a **idle**. **Nunca pular o passo de
  confirmação** — é o diferencial do produto.
- **Feed ao vivo:** novo evento a cada ~4.800ms no topo, animação de entrada, buffer máx. ~22.
- **Animações:** `nxLivePulse` (dot de status/feed, box-shadow expand 2.4s infinito), `nxEventIn`
  (evento entra, 0.35s), `nxFadeIn` (overlay, 0.12s), `nxScaleIn` (modal, 0.16s). Transições de
  hover/segmented `.12–.15s`. Microinterações sóbrias — sem skeuomorfismo, sem gradientes berrantes.
- **Responsivo:** os painéis são protótipo desktop-first (cockpit denso). O KPI strip já usa
  `auto-fit/minmax(148px)`; ao recriar, definir breakpoints para empilhar os grids `1.45fr/1fr` em
  uma coluna e recolher nav/rail em telas estreitas.

## State Management
Estado necessário (mapear para o store/hook do codebase):
| Estado | Tipo | Função |
|---|---|---|
| `lens` | `'operador' \| 'noc' \| 'financeiro'` | lente ativa; dirige título, KPIs, painéis e sugestões. Persistido. |
| `railOpen` | `boolean` | rail da IA aberto/recolhido. Persistido. |
| `paletteOpen` | `boolean` | command palette |
| `paletteQuery` | `string` | texto de busca do palette |
| `exp` | `{erp,nms,monitor,cpe,call: boolean}` | quais grupos de módulo estão expandidos na nav |
| `applied` | `Record<sugestaoId, 'idle'\|'confirm'\|'done'\|'dismissed'>` | estado de cada sugestão da IA |
| `events` | `Event[]` | feed ao vivo (buffer ~22), alimentado por timer/stream |

**Dados por lente** (no protótipo são mocks; no real virão de API):
- KPIs, regiões/incidentes (operador), tráfego/alarmes/elementos (noc), MRR/aging/faturas
  (financeiro), e o array de sugestões da IA — todos chaveados por `lens`. Ver `renderVals()` no
  arquivo para os valores exatos de mock.
- No sistema real: troca de lente NÃO deve refazer fetch desnecessário — idealmente os módulos
  licenciados e seus dados são carregados conforme o papel/seleção.

## Real-time / Data
- O feed de eventos e o status da rede são **tempo real** — conectar a WebSocket/SSE no codebase
  (no protótipo é um `setInterval`). Cada evento tem `{module, tone, text, time}`.
- Os módulos visíveis na nav devem vir das **licenças do cliente**; os não licenciados renderizam no
  estado "Disponível · ativar".

## Design Tokens (resumo rápido para colar)
Já listados acima em **Design Tokens**. Pontos não-negociáveis:
- Tema **escuro por padrão** (claro virá depois para telas de negócio).
- **Violeta = IA**, e somente IA.
- Verde/âmbar/vermelho **somente para estado** (saúde de rede, SLA, cobrança).
- Números/IDs/timestamps sempre em **Geist Mono**.

## Assets
- **Ícones:** todos são SVG inline desenhados com `stroke` (estilo lucide/feather, stroke 1.7–2.2).
  No codebase, substituir pela biblioteca de ícones de vocês (ex. lucide-react) — mapear por
  semântica (rede, router, OLT, sparkle/IA, lupa, sino, etc.).
- **Logo NetX:** **placeholder/slot** — o cliente fornecerá o logo real. Manter o espaço com as
  dimensões do slot atual.
- **Fontes:** Geist + Geist Mono via Google Fonts no protótipo; no codebase usar o pacote/Self-host
  de vocês.
- **Sem imagens raster** — toda visualização é SVG/CSS (donut conic-gradient, sparklines via path,
  barras via div).

## Files
- `NetX.dc.html` — protótipo completo (shell + dashboard + 3 lentes + copiloto + palette). A classe
  `Component` no final do arquivo contém todo o estado e os dados de mock por lente; o template acima
  dela é a estrutura/estilo. **Comece por aqui.**

## Próximas telas (planejadas, fora deste pacote)
Para contexto de arquitetura — não implementar agora, mas projetar pensando nelas:
Assinante 360 (financeiro+serviço+CPE+chamados+IA numa tela), NOC/topologia com correlação de
eventos, Mapa de rede (geo-first), Financeiro detalhado, e o modal do copiloto aplicando uma
sugestão com confirmação. Todas reaproveitam este shell e estes tokens.
