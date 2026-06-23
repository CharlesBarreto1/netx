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

// NMS — app importado (apps/nms), ainda dormente. Fronteira-alvo pra quando for
// ligado de verdade (roadmap item "wire NMS/Hub").
defineModule('netx-nms', { apiPrefixes: ['/nms'] });
