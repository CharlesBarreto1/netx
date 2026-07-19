/**
 * O Core como OIDC Provider.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Uma instância de Provider POR TENANT, porque cada tenant é um issuer distinto
 * (`.../v1/oidc/<slug>`). Instalações diferentes do NetX atendem tenants
 * diferentes e todas puxam este mesmo código pelo netx-update, então o issuer
 * não pode ser fixo em configuração.
 *
 * O que este módulo NÃO faz: autenticar o humano. O oidc-provider delega isso
 * ao fluxo de "interaction" — ele redireciona para uma tela nossa, que valida
 * as credenciais e devolve o resultado. Essa tela é peça separada.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { loadConfig } from '@netx/config';
import Provider, { type Configuration, type KoaContextWithOIDC } from 'oidc-provider';

import { PrismaService } from '../prisma/prisma.service';

import { OidcKeyService } from './oidc-key.service';
import { createOidcAdapter } from './prisma-oidc.adapter';

/** Segmento fixo sob o qual todos os issuers vivem. */
export const OIDC_MOUNT_PATH = '/v1/oidc';

@Injectable()
export class OidcProviderService {
  private readonly logger = new Logger(OidcProviderService.name);

  /**
   * Cache das instâncias. Construir um Provider lê chaves do banco e monta a
   * config inteira; refazer isso a cada request seria desperdício.
   *
   * A entrada é invalidada por `forget()` quando as chaves rotacionam.
   */
  private readonly cache = new Map<string, Provider>();

  /** Padrão do repo: config carregada e validada por Zod no @netx/config. */
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: OidcKeyService,
  ) {}

  /** Descarta a instância em cache — chamar após rotação de chave. */
  forget(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** Issuer público deste tenant. É o que aparece no discovery e no claim `iss`. */
  issuerFor(tenantSlug: string): string {
    const base = this.config.oidc.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/api${OIDC_MOUNT_PATH}/${tenantSlug}`;
  }

  /**
   * Trata a requisição HTTP crua com o Provider do tenant.
   *
   * A URL chega como `/v1/oidc/<slug>/<resto>` e o oidc-provider espera receber
   * só o `<resto>`, porque ele deriva as URLs absolutas do issuer. Reescrevemos
   * aqui em vez de confiar na semântica de mount do Express, que muda conforme
   * o middleware é registrado.
   */
  async handle(tenantSlug: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const provider = await this.forTenant(tenantSlug);

    const prefix = `${OIDC_MOUNT_PATH}/${tenantSlug}`;
    const original = req.url ?? '/';
    const idx = original.indexOf(prefix);
    const rest = idx === -1 ? original : original.slice(idx + prefix.length) || '/';

    // O oidc-provider descobre em que sub-caminho está montado comparando
    // `originalUrl` com `url`. Declaramos os dois com o caminho PÚBLICO
    // (`/api/v1/oidc/<slug>`), que inclui o `/api` acrescentado pelo gateway e
    // que o core nunca vê. Sem isto o discovery anunciaria `<base>/auth` em vez
    // de `<base>/api/v1/oidc/<slug>/auth`, e o cliente bateria no lugar errado.
    const publicMount = `/api${prefix}`;
    req.url = rest;
    (req as IncomingMessage & { originalUrl?: string }).originalUrl =
      rest === '/' ? `${publicMount}/` : `${publicMount}${rest}`;

    // O oidc-provider deriva TODAS as URLs absolutas (discovery, redirects) do
    // host da requisicao. Chegando via nginx -> api-gateway, o host e o interno
    // do core, e o gateway ainda remove x-forwarded-host/proto de proposito
    // (anti-spoof). Sem isto o discovery anunciaria 127.0.0.1 e o Nextcloud
    // falharia ao tentar alcancar os endpoints.
    //
    // Fixamos a partir da config em vez de confiar em cabecalho do cliente: e
    // deterministico e mais seguro do que reabrir a porta que o gateway fechou.
    const publicUrl = new URL(this.config.oidc.publicBaseUrl);
    req.headers['x-forwarded-proto'] = publicUrl.protocol.replace(':', '');
    req.headers['x-forwarded-host'] = publicUrl.host;

    await provider.callback()(req, res);
  }

  /** Instância do tenant, criando na primeira vez. */
  async forTenant(tenantSlug: string): Promise<Provider> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: tenantSlug, deletedAt: null },
      select: { id: true, slug: true, name: true, status: true },
    });

    if (!tenant || tenant.status === 'CHURNED') {
      throw new NotFoundException(`Tenant "${tenantSlug}" não existe ou está inativo.`);
    }

    const cached = this.cache.get(tenant.id);
    if (cached) return cached;

    const provider = await this.build(tenant.id, tenant.slug);
    this.cache.set(tenant.id, provider);
    this.logger.log(`OIDC Provider inicializado para o tenant "${tenant.slug}"`);
    return provider;
  }

  private async build(tenantId: string, tenantSlug: string): Promise<Provider> {
    // Garante que existe chave antes de montar — sem isso o provider sobe com
    // chave de desenvolvimento gerada pela lib, que some no restart.
    await this.keys.ensureActiveKey(tenantId);
    const jwks = await this.keys.getSigningJwks(tenantId);

    const cfg = this.config.oidc;

    const configuration: Configuration = {
      adapter: createOidcAdapter({ prisma: this.prisma, tenantId }),
      jwks: { keys: jwks },

      clients: [
        {
          client_id: cfg.nextcloudClientId,
          client_secret: cfg.nextcloudClientSecret,
          redirect_uris: cfg.nextcloudRedirectUris,
          post_logout_redirect_uris: cfg.nextcloudPostLogoutRedirectUris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_basic',
        },
      ],

      // PKCE obrigatório mesmo com client confidencial: protege contra
      // interceptação do code no canal do navegador.
      pkce: { required: () => true },

      claims: {
        openid: ['sub'],
        email: ['email', 'email_verified'],
        profile: ['name', 'given_name', 'family_name', 'preferred_username', 'locale'],
        groups: ['groups'],
      },

      scopes: ['openid', 'email', 'profile', 'groups', 'offline_access'],

      ttl: {
        // Curto de propósito: é o que limita o acesso residual de quem foi
        // desligado. A revogação ativa derruba o refresh na hora; o access
        // sobrevive no máximo esta janela.
        AccessToken: cfg.accessTokenTtlSeconds,
        IdToken: cfg.accessTokenTtlSeconds,
        AuthorizationCode: 60,
        Grant: cfg.refreshTokenTtlSeconds,
        Interaction: 600,
        Session: cfg.sessionTtlSeconds,
      },

      features: {
        devInteractions: { enabled: false },
        revocation: { enabled: true },
        introspection: { enabled: true },
        // Encerra a sessão no Nextcloud no ato do desligamento, sem esperar
        // o TTL vencer.
        backchannelLogout: { enabled: true },
        rpInitiatedLogout: { enabled: true },
        resourceIndicators: { enabled: false },
      },

      // Refresh rotativo. A lib detecta reuso e derruba o grant inteiro.
      rotateRefreshToken: true,

      findAccount: async (_ctx: KoaContextWithOIDC, id: string) => {
        const user = await this.prisma.user.findFirst({
          where: { id, tenantId, deletedAt: null },
          include: { userRoles: { include: { role: { select: { name: true } } } } },
        });

        // Usuário inexistente OU inativo não vira conta. É aqui que o
        // desligamento corta a emissão de token novo.
        if (!user || user.status !== 'ACTIVE') return undefined;

        return {
          accountId: user.id,
          async claims() {
            return {
              sub: user.id,
              email: user.email,
              email_verified: user.emailVerified,
              name: `${user.firstName} ${user.lastName}`.trim(),
              given_name: user.firstName,
              family_name: user.lastName,
              preferred_username: user.email,
              locale: user.locale ?? undefined,
              groups: user.userRoles.map((ur) => ur.role.name),
            };
          },
        };
      },

      interactions: {
        url(_ctx: KoaContextWithOIDC, interaction: { uid: string }) {
          return `/oidc/${tenantSlug}/interaction/${interaction.uid}`;
        },
      },

      cookies: {
        keys: [cfg.cookieSecret],
        short: { signed: true, sameSite: 'lax' },
        long: { signed: true, sameSite: 'lax' },
      },
    };

    const provider = new Provider(this.issuerFor(tenantSlug), configuration);

    // Estamos atrás do nginx e do api-gateway; sem isto o provider acha que a
    // conexão é http e recusa cookies seguros / monta URLs erradas.
    provider.proxy = true;

    return provider;
  }
}
