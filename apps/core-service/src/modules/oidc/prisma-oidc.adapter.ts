/**
 * Adapter de persistência do oidc-provider sobre Prisma.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Implementa o contrato que o panva/node-oidc-provider espera. Ele instancia um
 * adapter POR TIPO de artefato (`new Adapter('Session')`, `new Adapter('Grant')`,
 * ...), então a fábrica aqui devolve uma classe já amarrada ao tenant e ao
 * client do Prisma.
 *
 * Contrato (oidc-provider v9):
 *   upsert, find, findByUserCode, findByUid, consume, destroy, revokeByGrantId
 *
 * Nada aqui interpreta o payload — ele é opaco por design. As únicas coisas
 * desnormalizadas em coluna são as que precisam de índice: grantId, userCode,
 * uid e sub.
 */
import type { Adapter, AdapterPayload } from 'oidc-provider';

import type { PrismaService } from '../prisma/prisma.service';

export interface OidcAdapterDeps {
  prisma: PrismaService;
  tenantId: string;
}

/**
 * Devolve a classe de adapter que o Provider vai instanciar.
 *
 * O oidc-provider guarda a referência da CLASSE e faz `new` internamente por
 * tipo, por isso a amarração com tenant precisa vir por closure e não por
 * parâmetro de construtor.
 */
export function createOidcAdapter({ prisma, tenantId }: OidcAdapterDeps): new (name: string) => Adapter {
  return class PrismaOidcAdapter implements Adapter {
    constructor(private readonly name: string) {}

    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

      const data = {
        tenantId,
        payload: payload as unknown as object,
        grantId: payload.grantId ?? null,
        userCode: payload.userCode ?? null,
        uid: payload.uid ?? null,
        sub: payload.accountId ?? null,
        expiresAt,
      };

      await prisma.oidcPayload.upsert({
        where: { type_id: { type: this.name, id } },
        create: { type: this.name, id, ...data },
        update: data,
      });
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const row = await prisma.oidcPayload.findUnique({
        where: { type_id: { type: this.name, id } },
      });
      return this.materialize(row);
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const row = await prisma.oidcPayload.findFirst({
        where: { type: this.name, userCode, tenantId },
      });
      return this.materialize(row);
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      const row = await prisma.oidcPayload.findFirst({
        where: { type: this.name, uid, tenantId },
      });
      return this.materialize(row);
    }

    /**
     * Marca como consumido sem apagar.
     *
     * O oidc-provider usa isso para detectar REUSO de authorization code: se o
     * mesmo code chegar duas vezes, ele precisa achar o registro e ver que já
     * foi consumido para então revogar o grant inteiro. Apagar aqui cegaria
     * essa detecção — o segundo uso pareceria apenas um code inválido.
     */
    async consume(id: string): Promise<void> {
      await prisma.oidcPayload.update({
        where: { type_id: { type: this.name, id } },
        data: { consumedAt: new Date() },
      });
    }

    async destroy(id: string): Promise<void> {
      await prisma.oidcPayload.deleteMany({ where: { type: this.name, id } });
    }

    /** Derruba tudo que pertence a um grant — usado no logout e na revogação. */
    async revokeByGrantId(grantId: string): Promise<void> {
      await prisma.oidcPayload.deleteMany({ where: { grantId, tenantId } });
    }

    /**
     * Converte a linha no payload que a lib espera.
     *
     * Vencido é tratado como inexistente: o índice em expires_at existe para a
     * limpeza em lote, mas a checagem por leitura precisa acontecer aqui, senão
     * uma linha vencida ainda não coletada seria aceita como válida.
     */
    private materialize(
      row: {
        payload: unknown;
        expiresAt: Date | null;
        consumedAt: Date | null;
      } | null,
    ): AdapterPayload | undefined {
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return undefined;

      const payload = row.payload as AdapterPayload;

      // Quem decide o que fazer com artefato consumido é a lib, não o adapter:
      // para authorization code ela revoga o grant inteiro ao ver reuso. Nosso
      // trabalho é só reportar QUANDO foi consumido, em epoch seconds.
      if (row.consumedAt) {
        return { ...payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) };
      }

      return payload;
    }
  };
}

/**
 * Remove artefatos vencidos. Idempotente (AGENTS.md §12).
 *
 * O oidc-provider não faz coleta de lixo — assume que o storage tem TTL nativo
 * (Redis, Mongo). Postgres não tem, então a limpeza é nossa.
 */
export async function pruneExpiredPayloads(
  prisma: PrismaService,
  tenantId?: string,
): Promise<number> {
  const { count } = await prisma.oidcPayload.deleteMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      expiresAt: { lt: new Date() },
    },
  });
  return count;
}
