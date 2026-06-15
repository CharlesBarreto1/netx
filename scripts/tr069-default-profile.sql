-- =============================================================================
-- Seed: profile TR-069 padrão Huawei EG8145 (motor de conformidade — Fase 2).
-- Idempotente. Cria 1 profile por tenant + as regras. Rode no servidor:
--   sudo -u postgres psql netx -f scripts/tr069-default-profile.sql
--
-- Regras (só params LEGÍVEIS — senhas WiFi/PPPoE ficam de fora porque o GET
-- Huawei as devolve vazias; são aplicadas no provisionamento, não no reconcile):
--   - IPv6 IP Acquisition Mode (Origin) = AutoConfigured  → ENFORCE + reboot
--   - SSID 2.4G / 5G  (do cadastro do contrato)           → ENFORCE
--   - PPPoE username  (do contrato)                       → ENFORCE
--   - VLAN PPPoE = 1010                                   → REPORT_ONLY
--
-- ⚠️ Os paths usam WANConnectionDevice.2 (HUAWEI_PPPOE_WAN_INDEX default).
--    Se a sua planta usa outro índice, ajuste antes de rodar.
-- productClass NULL = curinga (vale p/ V5 e X6/X10; o SSID-5G usa o
-- wifiBandMode da ONT pra decidir sufixo -5G).
-- =============================================================================

-- 1) Profile por tenant
INSERT INTO tr069_profiles
  (id, tenant_id, name, manufacturer, product_class, version, active, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'Huawei EG8145 — padrão', 'Huawei', NULL, 1, true, now(), now()
FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 2) Regras (uma por (profile, param))
WITH p AS (
  SELECT id FROM tr069_profiles WHERE name = 'Huawei EG8145 — padrão'
)
INSERT INTO tr069_profile_rules
  (id, profile_id, param, value_type, source, static_value, mode, requires_reboot, enabled, sort_order, created_at, updated_at)
SELECT gen_random_uuid(), p.id, x.param, x.vtype,
       x.source::"Tr069RuleSource", x.sval, x.mode::"Tr069RuleMode",
       x.reboot, true, x.ord, now(), now()
FROM p CROSS JOIN (VALUES
  ('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.X_HW_IPv6.IPv6Address.1.Origin',
     'xsd:string',      'STATIC',               'AutoConfigured', 'ENFORCE',     true,  1),
  ('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
     'xsd:string',      'CONTRACT_WIFI_SSID',    NULL,            'ENFORCE',     false, 2),
  ('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
     'xsd:string',      'CONTRACT_WIFI_SSID_5G', NULL,            'ENFORCE',     false, 3),
  ('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
     'xsd:string',      'CONTRACT_PPPOE_USER',   NULL,            'ENFORCE',     false, 4),
  ('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.X_HW_VLAN',
     'xsd:unsignedInt', 'STATIC',                '1010',          'REPORT_ONLY', false, 5)
) AS x(param, vtype, source, sval, mode, reboot, ord)
ON CONFLICT (profile_id, param) DO NOTHING;
