-- Série temporal do painel do NMS: PPPoE ativos + tráfego agregado.
--
-- POR QUE EXISTE: o painel alarma "caiu vários PPPoE" e "queda/subida brusca
-- de tráfego". Os dois são comparações contra um baseline; sem histórico
-- persistido não há o que comparar — só dá pra exibir o valor instantâneo.
--
-- POR QUE NO CORE: a contagem de sessões vive em `radius.radacct`, banco do
-- Core. O NMS não coleta PPPoE por caminho nenhum (não há OID de sessão nos
-- perfis SNMP do Telegraf nem suporte nos drivers), então coletar do lado de
-- lá renderia painel vazio.
--
-- POR QUE TABELA COMUM E NÃO HYPERTABLE: o Postgres do Core não tem a extensão
-- TimescaleDB (ela é exclusiva do banco do NMS). O volume é baixo por
-- construção — 1 linha por tenant a cada poucos minutos — e a retenção poda o
-- excedente no próprio coletor.
CREATE TABLE "network_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "active_sessions" INTEGER NOT NULL,
    "active_contracts" INTEGER NOT NULL,
    -- Nullable de propósito: sem o módulo netx-nms (ou com a coleta falhando)
    -- o tráfego é DESCONHECIDO, não zero. Gravar 0 faria o alarme de queda
    -- disparar toda vez que o NMS ficasse indisponível.
    "total_in_bps" BIGINT,
    "total_out_bps" BIGINT,
    "devices_online" INTEGER,
    "devices_total" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_snapshots_pkey" PRIMARY KEY ("id")
);

-- Leitura quente do painel: "últimas N amostras deste tenant, mais recente
-- primeiro". Também serve a poda por retenção, que varre pelo mesmo par.
CREATE INDEX "network_snapshots_tenant_id_at_idx" ON "network_snapshots"("tenant_id", "at");

ALTER TABLE "network_snapshots" ADD CONSTRAINT "network_snapshots_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
