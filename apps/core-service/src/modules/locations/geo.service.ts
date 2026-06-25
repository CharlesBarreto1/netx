import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type {
  CepLookupResponse,
  IbgeMunicipalityResponse,
  IbgeSearchQuery,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { assertBrTenant } from './br-tenant.util';

const VIACEP_TIMEOUT_MS = 5000;

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Busca municípios na referência nacional do IBGE (autocomplete de cidade). */
  async searchIbge(
    tenantId: string,
    query: IbgeSearchQuery,
  ): Promise<IbgeMunicipalityResponse[]> {
    await assertBrTenant(this.prisma, tenantId);
    const rows = await this.prisma.ibgeMunicipality.findMany({
      where: {
        ...(query.uf ? { uf: query.uf } : {}),
        ...(query.q ? { nome: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ nome: 'asc' }],
      take: query.limit,
    });
    return rows.map((r) => ({ codigo: r.codigo, nome: r.nome, uf: r.uf }));
  }

  /**
   * Lookup de CEP via ViaCEP. Retorna logradouro/bairro/cidade/UF + código IBGE.
   * Cidades de CEP único trazem logradouro/bairro vazios — o front cai pro
   * cadastro manual da rua. `erro` do ViaCEP vira 404.
   */
  async lookupCep(tenantId: string, cep: string): Promise<CepLookupResponse> {
    await assertBrTenant(this.prisma, tenantId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIACEP_TIMEOUT_MS);
    let data: ViaCepRaw;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as ViaCepRaw;
    } catch (e) {
      this.logger.warn(`ViaCEP falhou para ${cep}: ${(e as Error).message}`);
      throw new BadGatewayException('Serviço de CEP (ViaCEP) indisponível');
    } finally {
      clearTimeout(timer);
    }

    if (data.erro) throw new NotFoundException('CEP não encontrado');

    return {
      cep,
      logradouro: emptyToNull(data.logradouro),
      complemento: emptyToNull(data.complemento),
      bairro: emptyToNull(data.bairro),
      localidade: emptyToNull(data.localidade),
      uf: emptyToNull(data.uf),
      ibge: emptyToNull(data.ibge),
    };
  }
}

interface ViaCepRaw {
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
  erro?: boolean;
}

function emptyToNull(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}
