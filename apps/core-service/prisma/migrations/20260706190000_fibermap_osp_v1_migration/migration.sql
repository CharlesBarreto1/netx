-- Migração de dados OSP v1 → FiberMap (OSP v2).
--
-- O módulo `optical` (OpticalEnclosure/OpticalPort/FiberCable/FiberSplice) foi
-- aposentado — o FiberMap é a fonte de verdade da planta. Esta migração copia
-- os dados vivos do v1 pra dentro do FiberMap. As TABELAS v1 permanecem
-- intactas (somente leitura de fato — o código não escreve mais nelas);
-- o drop fica pra uma migração futura, após validação em produção.
--
-- Estratégia de idempotência: ids v1 são REUSADOS nos registros equivalentes
-- (elemento ← enclosure, porta ← porta, cabo ← cabo) e ids derivados são
-- determinísticos (md5 com prefixo 'mig-osp1-*'). Re-rodar não duplica nada.
--
-- Mapeamento de tipos:
--   CTO/NAP/SPLITTER → elemento CTO (+ device SPLITTER com portas OUT)
--   EMENDA           → elemento CEO
--   RESERVA          → elemento SLACK_COIL
--   FiberCable       → fibermap_cables sem produto ("sem modelo", spec §14.9),
--                      1 tubo × N fibras ABNT, 1 segmento com o path original
--   FiberSplice      → FUSION quando os dois cabos terminam no mesmo elemento
--                      migrado (fusões "no meio do cabo" exigiriam corte — os
--                      registros ficam no v1 pra re-documentação manual)
--   OpticalPort.contractId → contracts.fibermap_port_id (sem sobrescrever
--                      vínculo já feito no FiberMap; contratos cancelados fora)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pasta destino por tenant com dados v1
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "fibermap_folders" ("id", "tenant_id", "name", "sort_order", "notes", "created_at", "updated_at")
SELECT gen_random_uuid(), t.tenant_id, 'Importado OSP v1', 900,
       'Migração automática do módulo óptico legado (CTOs, cabos e fusões do estúdio antigo).',
       now(), now()
  FROM (SELECT DISTINCT "tenant_id" FROM "optical_enclosures" WHERE "deleted_at" IS NULL
        UNION
        SELECT DISTINCT "tenant_id" FROM "fiber_cables" WHERE "deleted_at" IS NULL) t
 WHERE NOT EXISTS (
         SELECT 1 FROM "fibermap_folders" f
          WHERE f."tenant_id" = t.tenant_id AND f."name" = 'Importado OSP v1'
            AND f."deleted_at" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enclosures → elementos (id preservado)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "fibermap_elements"
      ("id", "tenant_id", "folder_id", "type", "product_id", "name",
       "latitude", "longitude", "address", "description", "metadata",
       "created_by_id", "created_at", "updated_at")
SELECT e."id", e."tenant_id", f."id",
       CASE e."type"::text
         WHEN 'EMENDA'  THEN 'CEO'
         WHEN 'RESERVA' THEN 'SLACK_COIL'
         ELSE 'CTO'                             -- CTO, NAP, SPLITTER
       END::"FibermapElementType",
       NULL, e."code", e."latitude", e."longitude", e."location_label", e."notes",
       jsonb_strip_nulls(jsonb_build_object(
         'migratedFrom',         'optical_enclosure',
         'legacyType',           e."type"::text,
         'legacySplitterRatio',  e."splitter_ratio"::text,
         'legacyMountType',      e."mount_type"::text,
         'legacyOltId',          e."olt_id"::text,
         'legacyPonPortId',      e."pon_port_id"::text,
         'legacyParentId',       e."parent_id"::text,
         'legacyImportBatchId',  e."import_batch_id"::text,
         'legacyIsActive',       e."is_active"
       )),
       e."created_by_id", e."created_at", now()
  FROM "optical_enclosures" e
  JOIN "fibermap_folders" f
    ON f."tenant_id" = e."tenant_id" AND f."name" = 'Importado OSP v1' AND f."deleted_at" IS NULL
 WHERE e."deleted_at" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "fibermap_elements" fe WHERE fe."id" = e."id")
   -- Não duplica caixa já desenhada manualmente no FiberMap com o mesmo nome
   -- (o nome é o código da CTO — é ele que vira CTO_PORT na Ufinet).
   AND NOT EXISTS (SELECT 1 FROM "fibermap_elements" fe
                    WHERE fe."tenant_id" = e."tenant_id" AND fe."name" = e."code"
                      AND fe."deleted_at" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Splitter de atendimento (CTO/NAP/SPLITTER com capacidade)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "fibermap_devices"
      ("id", "tenant_id", "element_id", "parent_device_id", "product_id", "type",
       "name", "netx_olt_id", "metadata", "created_by_id", "created_at", "updated_at")
SELECT md5('mig-osp1-splitter:' || e."id"::text)::uuid, e."tenant_id", e."id", NULL, NULL,
       'SPLITTER'::"FibermapDeviceType",
       COALESCE('SP ' || replace(e."splitter_ratio"::text, 'ONE_TO_', '1x'), 'Splitter'),
       NULL,
       jsonb_strip_nulls(jsonb_build_object(
         'ratio',        replace(e."splitter_ratio"::text, 'ONE_TO_', '1x'),
         'topology',     'BALANCED',
         'migratedFrom', 'optical_enclosure'
       )),
       e."created_by_id", e."created_at", now()
  FROM "optical_enclosures" e
 WHERE e."deleted_at" IS NULL
   AND e."type"::text IN ('CTO', 'NAP', 'SPLITTER')
   AND e."capacity" > 0
   -- Só pra elementos que ESTA migração criou (id preservado do v1).
   AND EXISTS (SELECT 1 FROM "fibermap_elements" fe WHERE fe."id" = e."id")
   AND NOT EXISTS (SELECT 1 FROM "fibermap_devices" d
                    WHERE d."id" = md5('mig-osp1-splitter:' || e."id"::text)::uuid);

-- Porta IN do splitter (alimentação — ponta upstream do grafo).
INSERT INTO "fibermap_optical_ports" ("id", "tenant_id", "device_id", "role", "port_number", "label", "created_at")
SELECT md5('mig-osp1-splitter-in:' || e."id"::text)::uuid, e."tenant_id",
       md5('mig-osp1-splitter:' || e."id"::text)::uuid, 'IN'::"FibermapPortRole", 1, NULL, e."created_at"
  FROM "optical_enclosures" e
 WHERE EXISTS (SELECT 1 FROM "fibermap_devices" d
                WHERE d."id" = md5('mig-osp1-splitter:' || e."id"::text)::uuid)
   AND NOT EXISTS (SELECT 1 FROM "fibermap_optical_ports" p
                    WHERE p."id" = md5('mig-osp1-splitter-in:' || e."id"::text)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Portas v1 → portas OUT do splitter (id preservado)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "fibermap_optical_ports" ("id", "tenant_id", "device_id", "role", "port_number", "label", "created_at")
SELECT p."id", p."tenant_id", md5('mig-osp1-splitter:' || p."enclosure_id"::text)::uuid,
       'OUT'::"FibermapPortRole", p."number", left(p."notes", 80), p."created_at"
  FROM "optical_ports" p
 WHERE EXISTS (SELECT 1 FROM "fibermap_devices" d
                WHERE d."id" = md5('mig-osp1-splitter:' || p."enclosure_id"::text)::uuid)
   AND NOT EXISTS (SELECT 1 FROM "fibermap_optical_ports" fp WHERE fp."id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "fibermap_optical_ports" fp
                    WHERE fp."device_id" = md5('mig-osp1-splitter:' || p."enclosure_id"::text)::uuid
                      AND fp."role" = 'OUT' AND fp."port_number" = p."number");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Vínculo comercial: OpticalPort.contract_id → contracts.fibermap_port_id
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "contracts" c
   SET "fibermap_port_id" = p."id"
  FROM "optical_ports" p
 WHERE p."contract_id" = c."id"
   AND c."deleted_at" IS NULL
   AND c."status" <> 'CANCELLED'
   AND c."fibermap_port_id" IS NULL
   AND EXISTS (SELECT 1 FROM "fibermap_optical_ports" fp WHERE fp."id" = p."id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Cabos → fibermap_cables "sem modelo" (1 tubo × N fibras, ABNT)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "fibermap_cables"
      ("id", "tenant_id", "folder_id", "name", "product_id", "fiber_count",
       "tube_count", "fibers_per_tube", "color_standard", "excess_factor",
       "display_color", "notes", "created_by_id", "created_at", "updated_at")
SELECT cb."id", cb."tenant_id", f."id", cb."code", NULL, cb."fiber_count",
       1, cb."fiber_count", 'ABNT'::"FibermapColorStandard", 1.0200,
       CASE cb."type"::text
         WHEN 'BACKBONE'     THEN '#ef4444'
         WHEN 'DISTRIBUTION' THEN '#3b82f6'
         ELSE '#10b981'
       END,
       cb."notes", cb."created_by_id", cb."created_at", now()
  FROM "fiber_cables" cb
  JOIN "fibermap_folders" f
    ON f."tenant_id" = cb."tenant_id" AND f."name" = 'Importado OSP v1' AND f."deleted_at" IS NULL
 WHERE cb."deleted_at" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "fibermap_cables" fc WHERE fc."id" = cb."id")
   AND NOT EXISTS (SELECT 1 FROM "fibermap_cables" fc
                    WHERE fc."tenant_id" = cb."tenant_id" AND fc."name" = cb."code"
                      AND fc."deleted_at" IS NULL);

INSERT INTO "fibermap_cable_tubes" ("cable_id", "tube_number", "color")
SELECT cb."id", 1, 'Verde'
  FROM "fiber_cables" cb
 WHERE EXISTS (SELECT 1 FROM "fibermap_cables" fc WHERE fc."id" = cb."id")
ON CONFLICT ("cable_id", "tube_number") DO NOTHING;

-- Fibras: ciclo ABNT NBR 14700 (12 cores), fiber_number global 1..N.
INSERT INTO "fibermap_fibers"
      ("id", "tenant_id", "cable_id", "tube_number", "fiber_number", "color", "status", "created_at", "updated_at")
SELECT md5('mig-osp1-fiber:' || cb."id"::text || ':' || gs::text)::uuid, cb."tenant_id", cb."id", 1, gs,
       (ARRAY['Verde','Amarela','Branca','Azul','Vermelha','Violeta',
              'Marrom','Rosa','Preta','Cinza','Laranja','Água-marinha'])[((gs - 1) % 12) + 1],
       'DARK'::"FibermapFiberStatus", now(), now()
  FROM "fiber_cables" cb
 CROSS JOIN LATERAL generate_series(1, cb."fiber_count") AS gs
 WHERE cb."deleted_at" IS NULL
   AND EXISTS (SELECT 1 FROM "fibermap_cables" fc WHERE fc."id" = cb."id")
   AND NOT EXISTS (SELECT 1 FROM "fibermap_fibers" ff
                    WHERE ff."cable_id" = cb."id" AND ff."fiber_number" = gs);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Pontas soltas → POLE sintético nas extremidades do path
-- ─────────────────────────────────────────────────────────────────────────────
-- Nome derivado do id do cabo (sem risco de colisão no unique(folder, name));
-- o código humano do cabo fica no metadata.
INSERT INTO "fibermap_elements"
      ("id", "tenant_id", "folder_id", "type", "name", "latitude", "longitude", "metadata", "created_at", "updated_at")
SELECT md5('mig-osp1-pole-a:' || cb."id"::text)::uuid, cb."tenant_id", f."id",
       'POLE'::"FibermapElementType", 'PONTA-A ' || left(cb."id"::text, 8),
       (cb."path"->0->>1)::numeric(9,6), (cb."path"->0->>0)::numeric(9,6),
       jsonb_build_object('migratedFrom', 'fiber_cable_endpoint', 'cableCode', cb."code"),
       now(), now()
  FROM "fiber_cables" cb
  JOIN "fibermap_folders" f
    ON f."tenant_id" = cb."tenant_id" AND f."name" = 'Importado OSP v1' AND f."deleted_at" IS NULL
 WHERE cb."deleted_at" IS NULL
   AND EXISTS (SELECT 1 FROM "fibermap_cables" fc WHERE fc."id" = cb."id")
   AND jsonb_typeof(cb."path") = 'array' AND jsonb_array_length(cb."path") >= 2
   AND jsonb_typeof(cb."path"->0) = 'array'
   AND (cb."endpoint_a_id" IS NULL
        OR NOT EXISTS (SELECT 1 FROM "fibermap_elements" fe WHERE fe."id" = cb."endpoint_a_id"))
   AND NOT EXISTS (SELECT 1 FROM "fibermap_elements" fe
                    WHERE fe."id" = md5('mig-osp1-pole-a:' || cb."id"::text)::uuid);

INSERT INTO "fibermap_elements"
      ("id", "tenant_id", "folder_id", "type", "name", "latitude", "longitude", "metadata", "created_at", "updated_at")
SELECT md5('mig-osp1-pole-b:' || cb."id"::text)::uuid, cb."tenant_id", f."id",
       'POLE'::"FibermapElementType", 'PONTA-B ' || left(cb."id"::text, 8),
       (cb."path"->(jsonb_array_length(cb."path") - 1)->>1)::numeric(9,6),
       (cb."path"->(jsonb_array_length(cb."path") - 1)->>0)::numeric(9,6),
       jsonb_build_object('migratedFrom', 'fiber_cable_endpoint', 'cableCode', cb."code"),
       now(), now()
  FROM "fiber_cables" cb
  JOIN "fibermap_folders" f
    ON f."tenant_id" = cb."tenant_id" AND f."name" = 'Importado OSP v1' AND f."deleted_at" IS NULL
 WHERE cb."deleted_at" IS NULL
   AND EXISTS (SELECT 1 FROM "fibermap_cables" fc WHERE fc."id" = cb."id")
   AND jsonb_typeof(cb."path") = 'array' AND jsonb_array_length(cb."path") >= 2
   AND jsonb_typeof(cb."path"->0) = 'array'
   AND (cb."endpoint_b_id" IS NULL
        OR NOT EXISTS (SELECT 1 FROM "fibermap_elements" fe WHERE fe."id" = cb."endpoint_b_id"))
   AND NOT EXISTS (SELECT 1 FROM "fibermap_elements" fe
                    WHERE fe."id" = md5('mig-osp1-pole-b:' || cb."id"::text)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Segmento único por cabo (path original; geom/comprimento via trigger)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "fibermap_cable_segments"
      ("id", "tenant_id", "cable_id", "seq", "from_element_id", "to_element_id",
       "path", "measured_length_m", "created_at", "updated_at")
SELECT md5('mig-osp1-seg:' || cb."id"::text)::uuid, cb."tenant_id", cb."id", 1,
       COALESCE(ea."id", pa."id"),
       COALESCE(eb."id", pb."id"),
       cb."path",
       NULLIF(cb."length_meters", 0),
       now(), now()
  FROM "fiber_cables" cb
  LEFT JOIN "fibermap_elements" ea ON ea."id" = cb."endpoint_a_id"
  LEFT JOIN "fibermap_elements" pa ON pa."id" = md5('mig-osp1-pole-a:' || cb."id"::text)::uuid
  LEFT JOIN "fibermap_elements" eb ON eb."id" = cb."endpoint_b_id"
  LEFT JOIN "fibermap_elements" pb ON pb."id" = md5('mig-osp1-pole-b:' || cb."id"::text)::uuid
 WHERE cb."deleted_at" IS NULL
   AND EXISTS (SELECT 1 FROM "fibermap_cables" fc WHERE fc."id" = cb."id")
   AND jsonb_typeof(cb."path") = 'array' AND jsonb_array_length(cb."path") >= 2
   AND jsonb_typeof(cb."path"->0) = 'array'
   AND COALESCE(ea."id", pa."id") IS NOT NULL
   AND COALESCE(eb."id", pb."id") IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "fibermap_cable_segments" s WHERE s."cable_id" = cb."id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Fusões: splices onde os DOIS cabos terminam no mesmo elemento migrado
-- ─────────────────────────────────────────────────────────────────────────────
-- Splices "no meio do cabo" (sem elemento comum de terminação) ficam no v1 —
-- em FiberMap exigiriam corte de fibra; re-documentar pelo estúdio.
WITH candidates AS (
  SELECT DISTINCT ON (s."id")
         s."id" AS splice_id, s."tenant_id", s."loss_db", s."notes",
         fa."id" AS fiber_a_id, fb."id" AS fiber_b_id,
         ce."id" AS element_id,
         CASE WHEN ca."endpoint_a_id" = ce."id" THEN 'A' ELSE 'B' END AS side_a,
         CASE WHEN cbx."endpoint_a_id" = ce."id" THEN 'A' ELSE 'B' END AS side_b
    FROM "fiber_splices" s
    JOIN "fiber_cables" ca  ON ca."id" = s."cable_a_id" AND ca."deleted_at" IS NULL
    JOIN "fiber_cables" cbx ON cbx."id" = s."cable_b_id" AND cbx."deleted_at" IS NULL
    JOIN "fibermap_elements" ce
      ON ce."id" IN (ca."endpoint_a_id", ca."endpoint_b_id")
     AND ce."id" IN (cbx."endpoint_a_id", cbx."endpoint_b_id")
    JOIN "fibermap_fibers" fa ON fa."cable_id" = ca."id"  AND fa."fiber_number" = s."fiber_a_index"
    JOIN "fibermap_fibers" fb ON fb."cable_id" = cbx."id" AND fb."fiber_number" = s."fiber_b_index"
   WHERE s."deleted_at" IS NULL
   ORDER BY s."id", ce."id"
), dedup AS (
  -- Uma ponta de fibra só participa de UMA conexão: entre splices concorrentes
  -- pela mesma ponta, vence o de menor id (determinístico).
  SELECT c.*
    FROM candidates c
   WHERE NOT EXISTS (
           SELECT 1 FROM candidates c2
            WHERE c2.splice_id < c.splice_id
              AND ((c2.fiber_a_id = c.fiber_a_id AND c2.side_a = c.side_a)
                OR (c2.fiber_b_id = c.fiber_b_id AND c2.side_b = c.side_b)
                OR (c2.fiber_a_id = c.fiber_b_id AND c2.side_a = c.side_b)
                OR (c2.fiber_b_id = c.fiber_a_id AND c2.side_b = c.side_a)))
)
INSERT INTO "fibermap_optical_connections"
      ("id", "tenant_id", "element_id", "kind",
       "a_type", "a_fiber_id", "a_fiber_side",
       "b_type", "b_fiber_id", "b_fiber_side",
       "loss_db", "notes", "created_at", "updated_at")
SELECT md5('mig-osp1-splice:' || d.splice_id::text)::uuid, d."tenant_id", d.element_id,
       'FUSION'::"FibermapConnectionKind",
       'FIBER_END'::"FibermapEndpointType", d.fiber_a_id, d.side_a::"FibermapFiberSide",
       'FIBER_END'::"FibermapEndpointType", d.fiber_b_id, d.side_b::"FibermapFiberSide",
       d."loss_db", d."notes", now(), now()
  FROM dedup d
 WHERE NOT EXISTS (SELECT 1 FROM "fibermap_optical_connections" oc
                    WHERE oc."id" = md5('mig-osp1-splice:' || d.splice_id::text)::uuid)
   AND NOT EXISTS (SELECT 1 FROM "fibermap_connection_endpoints" ep
                    WHERE ep."endpoint_key" IN ('FIBER:' || d.fiber_a_id::text || ':' || d.side_a,
                                                'FIBER:' || d.fiber_b_id::text || ':' || d.side_b));

-- Chaves de ocupação das fusões migradas (2 por conexão — trava de unicidade).
INSERT INTO "fibermap_connection_endpoints" ("id", "tenant_id", "connection_id", "endpoint_key")
SELECT md5('mig-osp1-ep-a:' || oc."id"::text)::uuid, oc."tenant_id", oc."id",
       'FIBER:' || oc."a_fiber_id"::text || ':' || oc."a_fiber_side"::text
  FROM "fibermap_optical_connections" oc
 WHERE oc."id" IN (SELECT md5('mig-osp1-splice:' || s."id"::text)::uuid FROM "fiber_splices" s)
   AND NOT EXISTS (SELECT 1 FROM "fibermap_connection_endpoints" ep
                    WHERE ep."connection_id" = oc."id"
                      AND ep."endpoint_key" = 'FIBER:' || oc."a_fiber_id"::text || ':' || oc."a_fiber_side"::text)
ON CONFLICT ("endpoint_key") DO NOTHING;

INSERT INTO "fibermap_connection_endpoints" ("id", "tenant_id", "connection_id", "endpoint_key")
SELECT md5('mig-osp1-ep-b:' || oc."id"::text)::uuid, oc."tenant_id", oc."id",
       'FIBER:' || oc."b_fiber_id"::text || ':' || oc."b_fiber_side"::text
  FROM "fibermap_optical_connections" oc
 WHERE oc."id" IN (SELECT md5('mig-osp1-splice:' || s."id"::text)::uuid FROM "fiber_splices" s)
   AND NOT EXISTS (SELECT 1 FROM "fibermap_connection_endpoints" ep
                    WHERE ep."connection_id" = oc."id"
                      AND ep."endpoint_key" = 'FIBER:' || oc."b_fiber_id"::text || ':' || oc."b_fiber_side"::text)
ON CONFLICT ("endpoint_key") DO NOTHING;
