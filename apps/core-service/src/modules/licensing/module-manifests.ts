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

// TR-069 + OLTs — gateado por netx-cpe. ('/optical' saiu com o OSP v1 —
// a planta agora é o FiberMap.)
defineModule('netx-cpe', { apiPrefixes: ['/olts', '/provisioning', '/tr069'] });

// Mapa comercial de clientes — gateado por netx-maps. (O mapa de REDE legado
// foi aposentado; a planta vive no netx-fibermap.)
defineModule('netx-maps', { apiPrefixes: ['/mapping'] });

// FiberMap — documentação de planta externa OSP v2 (FIBERMAP-SPEC.md).
// Dono das tabelas public.fibermap_* (prefixo de tabela em vez de schema
// dedicado — ver README do módulo).
defineModule('netx-fibermap', {
  apiPrefixes: ['/fibermap'],
  ownedTables: ['public.fibermap_*'],
});

// Callcenter/Atendimento WhatsApp — gateado por netx-call. Dois canais (WAHA +
// Meta Cloud) sob abstração de provider. Os webhooks são @Public (não gateados),
// mas /webhooks é a fronteira HTTP deste módulo (invariante 2d).
defineModule('netx-call', { apiPrefixes: ['/whatsapp', '/webhooks'] });

// Motor de IA + copiloto agêntico (Nexus) — gateado por netx-ai. /ai = config/
// status do motor (AiController); /copilot = copiloto tool-using + insights
// (CopilotController).
defineModule('netx-ai', { apiPrefixes: ['/ai', '/copilot'] });

// NMS — módulo vivo (apps/nms), sub-build pnpm isolado atrás do gateway em /nms.
// Canais ligados: SSO (valida JWT do Core), entitlement (este gating),
// eventos (consome do bus) e HTTP (/nms via api-gateway). Dono exclusivo do
// schema Postgres `nms` (invariante 3). Ver INTEGRATION-RUNBOOK.md §A.
defineModule('netx-nms', {
  apiPrefixes: ['/nms'],
  ownedTables: ['nms.*'],
  // Publica eventos próprios no bus (canal 3, lado produtor) — consumidos pelo
  // NetX (NmsEventsHandler) p/ inventário/alarmes.
  emits: ['netx-nms.device.registered', 'netx-nms.device.unreachable'],
  consumes: [
    'netx-erp.contract.created',
    'netx-erp.contract.installed',
    'netx-erp.contract.cancelled',
    'netx-cpe.ont.swapped',
  ],
});
