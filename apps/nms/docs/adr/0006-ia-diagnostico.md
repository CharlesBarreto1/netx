# ADR 0006 — IA de diagnóstico (anomalia estatística + LLM read-only)

- Status: aceito
- Data: 2026-06-19

## Contexto

Pilar 5 (AGENTS.md): IA "começa humilde" e evolui em três degraus — (1) anomalia estatística
sobre o TSDB, (2) LLM resume mudança de config, (3) copiloto grounded. Trava inegociável: a
**IA nunca executa nada** (§1) — só explica e sugere; humano age.

## Decisão

- **4.1 Anomalia (sem LLM)**: z-score sobre baseline móvel (3h) por (device, entidade) para luz
  óptica RX, temperatura e CPU. |z| ≥ 3 → cria `Event(type=anomaly)` com severidade pelo |z|
  (≥5 critical, ≥4 error, senão warning). Dedup de 30 min por entidade. Scheduler
  (`ANOMALY_CRON`, 10 min) + endpoint manual. Aparece no painel de eventos unificado.
- **Provedor LLM**: Anthropic (Claude), via `@anthropic-ai/sdk`. Modelos configuráveis:
  resumo de diff = `claude-haiku-4-5` (barato/rápido), copiloto = `claude-sonnet-4-6` (capaz).
  `ANTHROPIC_API_KEY` é **opcional**: sem ela, 4.1 segue funcionando e 4.2/4.3 ficam desligados
  (degradação graciosa, nunca quebra).
- **4.2 Resumo de diff**: ao detectar mudança no backup, o LLM explica o diff em PT-BR; vira a
  mensagem do `Event(config-change)`. Fallback para o shortstat do git se a IA estiver off.
- **4.3 Copiloto grounded**: `POST /devices/:id/copilot` monta um dossiê factual (métricas,
  eventos, config coletados) e pede ao Claude uma resposta ancorada nas evidências, citando-as.

## Segurança — a IA é read-only por design

- O copiloto e o resumo **não recebem nenhuma ferramenta** (sem tool use): são texto→texto.
  Não existe caminho de código pelo qual o LLM dispare ação em equipamento. O system prompt
  reforça read-only, mas a garantia real é arquitetural (nenhum tool exposto).
- O hook PreToolUse (§1/§3/§4) continua barrando, em tempo de escrita, qualquer código que
  daria à IA capacidade de agir.

## Consequências

- 4.1 roda sem custo/segredo e é o detector primário (CRC/óptica/temp/CPU fora da curva).
- 4.2/4.3 dependem de chave + custo por token; o produto funciona sem eles.
- Evolução: anomalia de erros de interface (CRC) por taxa; copiloto com mais contexto histórico;
  citações estruturadas. Mantida a trava: nenhuma ação automática.
