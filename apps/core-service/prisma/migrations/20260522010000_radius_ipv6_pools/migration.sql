-- =============================================================================
-- RADIUS — IPv6 dual-stack no grupo "ativos"
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Entrega IPv6 pros clientes ativos:
--   /64 na WAN  — via Framed-IPv6-Pool (pool de prefixos da interface WAN)
--   /56 na LAN  — via Delegated-IPv6-Prefix-Pool (DHCPv6-PD pro roteador
--                 do cliente sub-delegar /64s aos dispositivos)
--
-- Estratégia POOL-BASED (não IPAM no NetX): o RADIUS retorna o NOME de um
-- pool; o BNG Mikrotik faz a alocação individual. O NetX não rastreia cada
-- prefixo IPv6 — delega isso ao BNG, que é feito pra essa escala.
--
-- ⚠️ PRÉ-REQUISITO no Mikrotik (responsabilidade da arquitetura de rede):
--   /ipv6 pool add name=ipv6-wan prefix=<bloco>::/N prefix-length=64
--   /ipv6 pool add name=ipv6-pd  prefix=<bloco>::/N prefix-length=56
--   E o PPPoE server / RADIUS client com IPv6 habilitado.
--
-- Os NOMES dos pools (ipv6-wan / ipv6-pd) batem com o que o Mikrotik espera.
-- Pra usar outros nomes, ajuste os values abaixo.
--
-- Idempotente: limpa antes de inserir.
-- =============================================================================

-- Limpa atributos IPv6 antigos do grupo ativos (re-run seguro).
DELETE FROM radius.radgroupreply
 WHERE groupname = 'ativos'
   AND attribute IN ('Framed-IPv6-Pool', 'Delegated-IPv6-Prefix-Pool');

-- ativos: além do pool IPv4 (Framed-Pool, já existente), entrega IPv6:
INSERT INTO radius.radgroupreply (groupname, attribute, op, value) VALUES
    -- /64 pra interface WAN do cliente
    ('ativos', 'Framed-IPv6-Pool',            ':=', 'ipv6-wan'),
    -- /56 delegado (DHCPv6-PD) pra LAN do cliente
    ('ativos', 'Delegated-IPv6-Prefix-Pool',  ':=', 'ipv6-pd');

DO $$
BEGIN
  RAISE NOTICE 'radius IPv6: grupo ativos entrega Framed-IPv6-Pool=ipv6-wan + Delegated-IPv6-Prefix-Pool=ipv6-pd';
END $$;
