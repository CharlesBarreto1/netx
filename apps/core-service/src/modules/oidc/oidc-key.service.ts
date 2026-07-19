/**
 * Chaves de assinatura do OIDC Provider.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por que chave própria e não o segredo do JWT interno: o JWT serviço-a-serviço
 * do Core é HS256 simétrico. Simétrico não serve para OIDC — o cliente (o
 * Nextcloud) precisa VERIFICAR o token sem poder EMITIR um. Daí RS256 e um
 * JWKS público. O HS256 interno continua exatamente como está; esta é uma
 * camada nova ao lado, não uma substituição.
 *
 * Por que uma chave por tenant: cada tenant é um issuer OIDC distinto. Chave
 * compartilhada faria um tenant conseguir forjar token de outro caso a privada
 * vazasse por qualquer caminho.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto';

import type { OidcSigningKey } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/** Chave pública em formato JWK, como sai no endpoint /jwks. */
export interface PublicJwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
  alg: string;
  use: 'sig';
}

/** O que o provider precisa para assinar. */
export interface SigningMaterial {
  kid: string;
  alg: string;
  privateKeyPem: string;
}

const ALG = 'RS256';
const MODULUS_LENGTH = 2048;

/**
 * Quanto tempo uma chave aposentada continua no JWKS.
 *
 * Tem que ser MAIOR que o TTL do maior token que ela assinou, senão um token
 * ainda válido deixa de verificar no meio da vida útil. 7 dias cobre com folga
 * o refresh token; o access é de minutos.
 */
const RETIRED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OidcKeyService {
  private readonly logger = new Logger(OidcKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Devolve a chave que assina para este tenant, criando na primeira vez.
   *
   * Duas chamadas simultâneas num tenant sem chave vão as duas tentar inserir;
   * o índice parcial do banco derruba a perdedora com violação de unicidade e
   * ela relê a vencedora. É a corrida resolvida pelo banco, não por lock na
   * aplicação.
   */
  async ensureActiveKey(tenantId: string): Promise<SigningMaterial> {
    const existing = await this.findActive(tenantId);
    if (existing) return this.toSigningMaterial(existing);

    try {
      const created = await this.createKey(tenantId);
      await this.audit.log({
        tenantId,
        action: 'oidc.signing_key.created',
        resource: 'OidcSigningKey',
        resourceId: created.id,
        level: 'INFO',
        metadata: { kid: created.kid, alg: created.alg, reason: 'primeira chave do tenant' },
      });
      this.logger.log(`chave OIDC criada para tenant ${tenantId} (kid=${created.kid})`);
      return this.toSigningMaterial(created);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Outro processo criou primeiro. Relê — não é erro.
      const winner = await this.findActive(tenantId);
      if (!winner) throw err;
      return this.toSigningMaterial(winner);
    }
  }

  /**
   * Rotaciona: a atual vira RETIRED com prazo de validade no JWKS, e uma nova
   * entra como ACTIVE.
   *
   * Numa transação porque o índice parcial só admite uma ACTIVE por tenant — a
   * antiga TEM que sair antes de a nova entrar, e as duas coisas precisam
   * acontecer juntas ou nenhuma.
   */
  async rotate(tenantId: string, actorUserId?: string): Promise<SigningMaterial> {
    const now = new Date();
    const previous = await this.findActive(tenantId);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.oidcSigningKey.updateMany({
        where: { tenantId, status: 'ACTIVE' },
        data: {
          status: 'RETIRED',
          retiredAt: now,
          expiresAt: new Date(now.getTime() + RETIRED_GRACE_MS),
        },
      });
      return tx.oidcSigningKey.create({ data: buildKeyData(tenantId, this.crypto) });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId ?? null,
      action: 'oidc.signing_key.rotated',
      resource: 'OidcSigningKey',
      resourceId: created.id,
      level: 'WARNING',
      metadata: {
        novoKid: created.kid,
        kidAposentado: previous?.kid ?? null,
        aposentadaSaiDoJwksEm: new Date(now.getTime() + RETIRED_GRACE_MS).toISOString(),
      },
    });
    this.logger.warn(
      `chave OIDC rotacionada no tenant ${tenantId}: ${previous?.kid ?? '(nenhuma)'} -> ${created.kid}`,
    );

    return this.toSigningMaterial(created);
  }

  /**
   * Conjunto público servido em /jwks.
   *
   * Inclui a ACTIVE e as RETIRED ainda no prazo: um token assinado ontem com a
   * chave antiga precisa continuar verificável hoje.
   */
  async getJwks(tenantId: string): Promise<{ keys: PublicJwk[] }> {
    const now = new Date();
    const keys = await this.prisma.oidcSigningKey.findMany({
      where: {
        tenantId,
        OR: [{ status: 'ACTIVE' }, { status: 'RETIRED', expiresAt: { gt: now } }],
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return { keys: keys.map((k) => k.publicJwk as unknown as PublicJwk) };
  }

  /**
   * JWKs PRIVADOS para alimentar a config `jwks` do oidc-provider.
   *
   * A lib precisa da privada para assinar. Devolvemos a ACTIVE mais as RETIRED
   * ainda no prazo — ela assina com a primeira compatível e consegue verificar
   * token emitido com qualquer uma do conjunto.
   *
   * A privada sai cifrada do banco e só existe em memória a partir daqui. Nunca
   * exponha o retorno disto em endpoint — o público é getJwks().
   */
  async getSigningJwks(tenantId: string): Promise<Record<string, unknown>[]> {
    const now = new Date();
    const keys = await this.prisma.oidcSigningKey.findMany({
      where: {
        tenantId,
        OR: [{ status: 'ACTIVE' }, { status: 'RETIRED', expiresAt: { gt: now } }],
      },
      // ACTIVE antes de RETIRED: a lib assina com a primeira que servir.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return keys.map((k) => {
      const pem = this.crypto.decrypt(k.privateKeyEnc);
      const jwk = createPrivateKey(pem).export({ format: 'jwk' }) as Record<string, unknown>;
      return { ...jwk, kid: k.kid, alg: k.alg, use: 'sig' };
    });
  }

  /** Material de assinatura por kid — usado ao verificar token já emitido. */
  async getByKid(kid: string): Promise<SigningMaterial | null> {
    const key = await this.prisma.oidcSigningKey.findUnique({ where: { kid } });
    return key ? this.toSigningMaterial(key) : null;
  }

  /**
   * Apaga chaves aposentadas cujo prazo venceu. Idempotente — pode rodar
   * quantas vezes quiser (AGENTS.md §12).
   */
  async pruneExpired(tenantId?: string): Promise<number> {
    const { count } = await this.prisma.oidcSigningKey.deleteMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: 'RETIRED',
        expiresAt: { lt: new Date() },
      },
    });
    if (count > 0) this.logger.log(`${count} chave(s) OIDC vencida(s) removida(s)`);
    return count;
  }

  private async findActive(tenantId: string): Promise<OidcSigningKey | null> {
    return this.prisma.oidcSigningKey.findFirst({ where: { tenantId, status: 'ACTIVE' } });
  }

  private async createKey(tenantId: string): Promise<OidcSigningKey> {
    return this.prisma.oidcSigningKey.create({ data: buildKeyData(tenantId, this.crypto) });
  }

  private toSigningMaterial(key: OidcSigningKey): SigningMaterial {
    return {
      kid: key.kid,
      alg: key.alg,
      privateKeyPem: this.crypto.decrypt(key.privateKeyEnc),
    };
  }
}

/** Gera o par e monta a linha pronta para inserir, já com a privada cifrada. */
function buildKeyData(tenantId: string, crypto: CryptoService) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const raw = createPublicKey(publicKey).export({ format: 'jwk' }) as {
    kty: string;
    n: string;
    e: string;
  };
  const kid = jwkThumbprint(raw);

  const publicJwk: PublicJwk = { ...raw, kid, alg: ALG, use: 'sig' };

  return {
    tenantId,
    kid,
    alg: ALG,
    publicJwk: publicJwk as unknown as object,
    privateKeyEnc: crypto.encrypt(privateKey),
    status: 'ACTIVE' as const,
  };
}

/**
 * JWK Thumbprint (RFC 7638).
 *
 * O kid vem do conteúdo da própria chave, não de um contador ou uuid. Assim ele
 * é estável e não colide entre tenants sem precisar de coordenação. Para RSA os
 * membros obrigatórios são e, kty, n — nesta ordem lexicográfica, sem espaços.
 */
export function jwkThumbprint(jwk: { kty: string; n: string; e: string }): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return createHash('sha256').update(canonical).digest('base64url');
}

/** Violação de índice único no Prisma. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
