# Handoff: Gerenciador de CPEs TR-069 (Atendimento N1)

## Overview
Painel de gerenciamento e diagnóstico de CPEs (ONUs/roteadores) via TR-069/CWMP, voltado ao **atendimento N1 de um provedor de internet**. O atendente busca um assinante, abre a ficha do equipamento, faz diagnóstico profundo (sinal óptico GPON, WiFi, PPPoE, recursos do CPE, ping/traceroute) e executa ações remotas (reboot, WiFi, firmware, reprovisionamento). Inclui um dashboard com fila de CPEs com problema.

## About the Design Files
O arquivo `Gerenciador CPE TR-069.dc.html` deste bundle é uma **referência de design feita em HTML** — um protótipo que mostra a aparência e o comportamento pretendidos. **Não é código de produção para copiar diretamente.**

A tarefa é **recriar este design no codebase do NetX**, usando os padrões, componentes e bibliotecas já estabelecidos lá (React/Vue/etc., biblioteca de charts, design system interno). Os charts no protótipo são SVG desenhados à mão em JS apenas para demonstração — no NetX, prefira a lib de gráficos já adotada (Recharts, ECharts, Chart.js, etc.).

> O HTML usa um runtime de "Design Components" (`support.js`, tags `<x-dc>`, `<sc-for>`, `<sc-if>`). Isso é só o ambiente de prototipagem — **ignore essa camada** e reimplemente a UI com os componentes do NetX. Para abrir e olhar o protótipo, basta abrir o `.html` num navegador.

## Fidelity
**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos e interações são finais e devem ser reproduzidos fielmente — adaptados aos componentes do NetX. Os **dados são mockados**; ligar aos dados reais do ACS é parte da implementação.

---

## Layout global
- **App shell** ocupando 100vh, `overflow:hidden`, fonte base `IBM Plex Sans`, fundo de página `#eef1f6`, cor de texto `#0f1726`.
- Estrutura: **Top bar** (altura 58px, fixa) → abaixo um flex row com **Sidebar** (62px, fixa) + **Main** (`flex:1`, `overflow:auto`).
- Largura de conteúdo das telas: `max-width:1480px` (busca: 1100px), centralizado, padding ~22px 26px.

### Top bar (`#0e1726`, texto `#eaeef6`, borda inferior `#1d2940`)
- Logo: quadrado 30px, `border-radius:7px`, gradiente `linear-gradient(135deg,#1565ff,#3b82f6)`, letra "F" branca 700. Ao lado: "FibraACS" (600, 14px) + "TR-069 · CWMP" (`IBM Plex Mono`, 10px, `#7f8da6`). **Trocar "FibraACS" pela marca NetX.**
- Busca global: input `flex:1` (max 540px), altura 36px, fundo `#16223a`, borda `#25324c`, `border-radius:9px`, ícone ⌕ à esquerda. Placeholder: "Buscar assinante, CPF, contrato, MAC, serial ou IP…". Ao digitar/focar → navega para a tela de Busca.
- Status ACS: dot verde `#12b886` + "ACS online · 18.204 CPEs" (`IBM Plex Mono`, 11px).
- Usuário: avatar circular 30px `#243149` com iniciais + nome (12px) e papel "N1 · Suporte" (10px `#7f8da6`).

### Sidebar (`#11192a`, 62px)
Botões verticais 46×48px, `border-radius:11px`, ícone 18px + label 9px. Ativo: fundo `#1d2b48`, texto `#fff`; inativo texto `#6b7791`. Itens: Início (▦), Busca (⌕), Alertas (⚠, badge vermelho `#fa5252` "12"), Rede (⤳), Relat. (▤). Engrenagem ⚙ no rodapé.

---

## Telas / Views

### 1. Dashboard — "Fila de diagnóstico" (tela inicial)
**Propósito:** visão geral da operação e fila de CPEs que precisam de atenção.

- **Header:** kicker "OPERAÇÃO · ATENDIMENTO N1" (`IBM Plex Mono`, 12px, uppercase, `#6b7585`) + título "Fila de diagnóstico" (23px, 600). À direita: **segmented control** com 3 modos da tela principal (Fila / Cards / Mapa OLT) + botão "↻ Atualizar".
  - Segmented: container branco, borda `#e2e7ef`, `border-radius:10px`, padding 3px. Botão ativo: fundo `#1565ff`, texto branco; inativo texto `#6b7585`.
- **KPI row:** grid de 4 cards (branco, borda `#e6eaf1`, `border-radius:13px`, padding 14px 16px). Cada um: label (12px `#6b7585`) + trend (`IBM Plex Mono`, 11px, verde/vermelho) + valor grande (30px, 600, `IBM Plex Mono`, cor por métrica) + sparkline SVG 60×26 à direita.
  - CPEs online `17.9k` (`#12b886`, ▲99.2%); Offline `214` (`#fa5252`, ▲12); Em alerta `88` (`#f59f00`, ▼6); Chamados N1 `31` (`#1565ff`).
- **Corpo:** grid `1fr 360px` (conteúdo + right rail).
  - **Modo Fila** (default): card branco com tabela. Header com título "CPEs com problema · N" + chips de filtro (Todos/Crítico/Alerta/Óptico — chip ativo fundo `#eaf1ff` texto `#1565ff` borda `#1565ff`). Linhas em grid de 6 colunas `14px 1.6fr 1.2fr 90px 84px 92px`: dot de severidade, Assinante+meta (nome 13.5px 600 + meta em mono `#8a93a3`), Sintoma (tag colorida + texto), Sinal (sparkline 50×20 + valor em mono colorido), Visto ("há X min"), "Abrir →" (`#1565ff`). Hover linha: `background:#f7f9fc`. Linha inteira clicável → abre a ficha.
  - **Modo Cards:** grid 2 colunas de cards (borda esquerda 3px na cor da severidade); hover eleva (`translateY(-2px)` + sombra).
  - **Modo Mapa OLT:** painel escuro `#0e1726`; grid 8 colunas de células quadradas (uma por OLT), cor de fundo = verde→amarelo→vermelho conforme % de CPEs degradados; legenda gradiente embaixo.
  - **Right rail:**
    - Painel escuro "Tráfego agregado": valor `428.6 Gbps` (mono, branco) + line chart (down `#3b82f6`, up `#12b886`) + legenda.
    - Card branco "Sintomas mais comuns (hoje)": lista com label + contagem + barra de progresso colorida (`Sinal óptico baixo` 82% vermelho, `WiFi/interferência` 64% âmbar, `PPPoE` 34% azul, `Offline/LOS` 22% roxo).

### 2. Busca de assinante
**Propósito:** localizar o CPE por nome/CPF/contrato/MAC/IP.
- Header: kicker "BUSCA DE ASSINANTE" + título dinâmico ("N resultado(s) para …" ou "Resultados recentes").
- Tabela (card branco) em grid de 6 colunas `14px 1.5fr 1fr 1fr 110px 84px`: dot severidade, Assinante (nome + doc em mono), Plano/Contrato, Equipamento (modelo + MAC), Status (tag), "Abrir →". Filtragem client-side conforme o texto da busca global.

### 3. Ficha do CPE (detalhe + diagnóstico)
**Propósito:** diagnóstico profundo + ações. Acessada ao clicar uma linha da fila ou da busca.
- Botão "← Voltar para a fila".
- **Header card** (branco, `border-radius:16px`, padding 18px 22px): ícone 📡 (quadrado 50px, gradiente escuro) + nome do assinante (21px, 600) + tag de status. Linha de metadados em mono `#6b7585`: plano · contrato · modelo · SN · IP. À direita, **botões de ação**: "⟳ Reboot" (primário azul `#1565ff`, sombra), "WiFi", "Firmware", "Reprovisionar" (secundários: borda `#e2e7ef`, fundo branco).
- **Banner de alerta** (quando crítico): fundo `#fff4f4`, borda `#ffd4d4`, ícone "!" em círculo vermelho + texto: "Sinal óptico crítico: RX em −26.8 dBm (limite −25 dBm). Provável atenuação na fibra/conector…".
- **Tabs** (borda inferior `#e2e7ef`): Visão geral / Diagnóstico / WiFi / Histórico. Aba ativa: texto `#1565ff` + borda inferior 2px `#1565ff`.

**Aba Visão geral:** grid de 4 metric cards (Uptime, PPPoE=Conectado em verde, Latência 8ms, Perda 2.1% em âmbar) + grid 2 colunas: painel escuro "Throughput WAN" (line chart down/up, 24h) + card "Recursos do CPE" com **3 gauges semicirculares** (CPU 23%, Memória 61%, Temp 54°). Gauge fica vermelho acima do limite (CPU>80, Mem>85, Temp>65).

**Aba Diagnóstico:** grid 2 colunas:
- Card "Sinal óptico GPON": 2 gauges (RX power −26.8 dBm faixa −30..−8, vermelho se < −25; TX power 2.1 dBm faixa 0..5). Rodapé: distância OLT 1.84 km, atenuação 28.6 dB (vermelho).
- Painel escuro "RX power · histórico" (line chart vermelho mostrando a queda, anotação "↓ Queda de −18.9 → −26.8 dBm às 19:40").
- Segunda linha: card "Conexão WAN" (lista chave/valor: Estado PPPoE UP, WAN IP, gateway, DNS, VLAN 2102, reautenticações 24h=3) + **terminal "Ping & Traceroute remoto"** (painel `#0b1220`, fonte mono, botão "Executar" que dispara estado running→done após ~2.2s e imprime saída de ping com um salto de jitter alto + resumo do traceroute).

**Aba WiFi:** grid 2 colunas de cards de rádio (2.4 GHz "Congestionado" / 5 GHz "Bom") com SSID, Canal (cor por estado), Largura, Clientes, botão "Editar". Abaixo, painel escuro **"Ocupação de canais 2.4 GHz"** (heatmap de barras por canal 1–11; canal atual 6 em vermelho; sugestão de migrar p/ canal 1). Por fim, tabela "Dispositivos conectados" em grid 5 colunas: dispositivo (ícone+nome), banda (tag 5G azul / 2.4G roxo), IP/MAC (mono), tráfego, **RSSI** (mini-barras de sinal 1–4 níveis + valor dBm colorido por faixa).

**Aba Histórico:** grid 2 colunas: card "Reboots & quedas · 7 dias" (mini bar chart 14 barras) + card "Disponibilidade" (98.2%, grade de 30 dias coloridos verde/âmbar/vermelho). Abaixo, "Linha do tempo de eventos" (timeline vertical com dot colorido + título + descrição + horário em mono).

---

## Interactions & Behavior
- **Navegação:** estado `screen` ('dashboard' | 'search' | 'detail'). Sidebar Início→dashboard, Busca→search. Clicar linha da fila/busca → `screen='detail'`, define `activeId`, reseta tab para 'geral'. "Voltar" → dashboard.
- **Segmented dashboard:** estado `dashView` ('fila' | 'cards' | 'mapa').
- **Filtros da fila:** estado `filter` ('todos' | 'crit' | 'warn' | 'optico') filtrando o array da fila.
- **Busca:** input atualiza `query`; resultados filtrados client-side por nome/doc/contrato/modelo/MAC quando `query.length > 1`.
- **Tabs da ficha:** estado `tab` ('geral' | 'diag' | 'wifi' | 'hist').
- **Ping/traceroute:** estado `pingState` ('idle' | 'running' | 'done'); botão dispara running e após ~2200ms vai para done exibindo as linhas de saída.
- **Ações remotas (modais):** Reboot, Firmware, Reprovisionar, WiFi. Cada um abre modal (overlay `rgba(14,23,38,.45)` + blur, card branco 440px). Modal WiFi tem form (SSID, senha, seletor de canal 1/6/11). Confirmar → fecha modal + dispara **toast** (canto inferior, `#0e1726`, auto-some em ~3.2s). Clicar fora do card fecha o modal.
- **Hover states:** linhas de tabela `#f7f9fc`; cards no modo Cards elevam com sombra `0 8px 22px rgba(16,23,38,.09)`.
- **Animações (keyframes definidos):** `toastin` (slide-up + fade), `spin`, `pulse`, `blip` (não todos usados — `toastin` é o principal).

## State Management
Variáveis de estado: `screen`, `dashView`, `filter`, `query`, `activeId`, `tab`, `toast`, `modal`, `wifiSsid`, `wifiPass`, `wifiChannel`, `pingState`. No NetX, mapear para o gerenciamento de estado local da tela (hooks/store) + dados reais vindos do ACS.

### Dados a buscar do ACS (substituir os mocks)
- Lista/fila de CPEs com problema (id, assinante, modelo, severidade, sintoma, sinal, último visto).
- Por CPE: dados ópticos GPON (RX/TX power, atenuação, distância), PPPoE/DHCP (estado, IP, gateway, DNS, VLAN, reautenticações, uptime), recursos (CPU/mem/temp), WiFi (SSIDs, canais, largura, clientes), dispositivos LAN/WiFi (nome, banda, IP, MAC, tráfego, RSSI), histórico (reboots, disponibilidade, eventos), séries temporais (RX power, throughput WAN).
- Ações TR-069: reboot, set SSID/senha, set canal, push firmware, reprovisionar perfil.

## Design Tokens
**Cores**
- Página `#eef1f6`; card `#fff`; borda card `#e6eaf1` / `#e2e7ef`; linhas tabela `#f3f5f9` / `#f0f2f7`.
- Texto forte `#0f1726` / `#1f2733`; texto médio `#39414f`; texto suave `#6b7585` / `#8a93a3`; texto fraco `#9aa3b2`.
- Painéis escuros `#0e1726` (chart) e `#0b1220` (terminal); shell escuro `#11192a` / `#16223a`.
- **Accent primário** `#1565ff`; accent claro `#eaf1ff`; azul chart `#3b82f6`.
- Status: ok/verde `#12b886` (bg `#eafaf3`); alerta/âmbar `#f59f00` (bg `#fff7e8`); crítico/vermelho `#fa5252` (bg `#fff0f0`); roxo `#7c3aed` (bg `#f3eaff`).

**Tipografia**
- UI: `IBM Plex Sans` (400/500/600/700). Números/técnico: `IBM Plex Mono` (400/500/600).
- Títulos de tela 23px/600 (`letter-spacing:-.3px`); nome na ficha 21px/600; valores KPI 30px/600 mono; valores gauge 19px/600 mono; corpo 12.5–13.5px; labels 11–12px; micro 10–11px.

**Raio / sombra / espaçamento**
- Radius: cards 13–16px; inputs/botões 9–11px; chips 6–8px; pills 6px.
- Sombra card: `0 1px 2px rgba(16,23,38,.04)`; hover card: `0 8px 22px rgba(16,23,38,.09)`; modal `0 24px 60px rgba(16,23,38,.35)`; toast `0 12px 30px rgba(16,23,38,.35)`.
- Gaps de grid: 14–16px; padding de card 14–18px.

## Charts (recriar com a lib do NetX)
- **Sparkline** (linha + área com gradiente) — KPIs e células da fila.
- **Line chart** (multi-série, grid horizontal, gradiente de área, dot no último ponto) — throughput WAN, tráfego agregado, histórico RX power.
- **Gauge semicircular** (track + arco colorido + valor central) — CPU, memória, temperatura, RX/TX óptico. Limiares mudam a cor para vermelho.
- **Heatmap de barras** — ocupação de canais WiFi 2.4 GHz (1–11), canal atual destacado.
- **Mini bar chart** — reboots por dia (7 dias).
- **Grade de status** — disponibilidade 30 dias (1 célula/dia).
- **Barras de RSSI** — 4 níveis por dispositivo.

## Assets
Nenhum asset binário. Ícones são emoji/glyphs como placeholders — substituir pelo icon set do NetX. A logo "FibraACS" é placeholder; usar a marca real do NetX.

## Files
- `Gerenciador CPE TR-069.dc.html` — protótipo de alta fidelidade com todas as telas, charts e interações. Abra no navegador para inspecionar. A camada de runtime (`support.js`, `<x-dc>`, `<sc-for>`, `<sc-if>`) é só do ambiente de prototipagem e deve ser ignorada na reimplementação.
