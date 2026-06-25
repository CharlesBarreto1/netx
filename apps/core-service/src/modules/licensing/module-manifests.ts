import { defineModule } from '@netx/core-sdk';

/**
 * Registro central dos manifestos de módulo (Fase 2/4): declara a FRONTEIRA
 * HTTP de cada módulo (`apiPrefixes`, invariante 2d). Os eventos (`emits`) são
 * declarados perto de onde nascem (modules/events/event-types.ts); `defineModule`
 * faz merge, então os dois lados convivem.
 *
 * Importado uma vez no LicensingModule (side-effect) pra popular o registry,
 * exposto em GET /v1/license/modules. NÃO muda runtime — é metadado declarativo.
 */

// ERP base — núcleo; muitos prefixos, sem gating (token vazio ⇒ tudo on).
defineModule('netx-erp', {
  apiPrefixes: [
    '/customers',
    '/contracts',
    '/deals',
    '/finance',
    '/service-orders',
    '/stock',
    '/fleet',
    '/reports',
    '/tenants',
    '/users',
    '/roles',
    '/sifen',
  ],
});

// RH/portal — gateado por netx-rh.
defineModule('netx-rh', { apiPrefixes: ['/hr', '/me'] });

// TR-069 + OLTs — gateado por netx-cpe.
defineModule('netx-cpe', { apiPrefixes: ['/olts', '/provisioning', '/tr069', '/optical'] });

// Mapas de rede — gateado por netx-maps.
defineModule('netx-maps', { apiPrefixes: ['/mapping'] });

// NMS — módulo vivo (apps/nms), sub-build pnpm isolado atrás do gateway em /nms.
// Canais ligados: SSO (valida JWT do Core), entitlement (este gating),
// eventos (consome do bus) e HTTP (/nms via api-gateway). Dono exclusivo do
// schema Postgres `nms` (invariante 3). Ver INTEGRATION-RUNBOOK.md §A.
defineModule('netx-nms', {
  apiPrefixes: ['/nms'],
  ownedTables: ['nms.*'],
  // Publica eventos próprios no bus (canal 3, lado produtor) — consumidos pelo
  // NetX (NmsEventsHandler) p/ inventário/alarmes.
  emits: ['netx-nms.device.registered'],
  consumes: [
    'netx-erp.contract.created',
    'netx-erp.contract.installed',
    'netx-erp.contract.cancelled',
    'netx-cpe.ont.swapped',
  ],
});
