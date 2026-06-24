/**
 * NfcomConfigService — config NFCom por tenant (tabela NfcomConfig).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Espelha EfiConfigService (tabela dedicada + segredos cifrados write-only) e
 * reusa o parse de certificado do SIFEN (node-forge). Os segredos (apiKey do
 * agregador e senha do .pfx) nunca voltam crus no response.
 *
 * CryptoModule é @Global — não precisa importar no módulo.
 */
import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  NfcomCertificateInfoResponse,
  NfcomConfigResponse,
  UpdateNfcomConfigRequest,
} from '@netx/shared';
import type { NfcomConfig } from '@prisma/client';
import forge from 'node-forge';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { NfcomTransmitterRegistry } from './transmitter/nfcom-transmitter.registry';
import type { NfcomStatusResult } from './transmitter/nfcom-transmitter.port';

/** Config NFCom com segredos DECIFRADOS — uso interno do transmissor. */
export interface NfcomEffectiveConfig {
  environment: NfcomConfig['environment'];
  transmitter: NfcomConfig['transmitter'];
  enabled: boolean;
  emitente: {
    cnpj: string;
    inscricaoEstadual: string | null;
    razaoSocial: string;
    nomeFantasia: string | null;
    crt: string | null;
    uf: string;
    codMunicipio: string | null;
    endLogradouro: string | null;
    endNumero: string | null;
    endComplemento: string | null;
    endBairro: string | null;
    endMunicipioNome: string | null;
    endCep: string | null;
    fone: string | null;
    email: string | null;
    serie: string;
  };
  taxDefaults: {
    cstIcms: string | null;
    aliquotaIcms: number | null;
    cfop: string | null;
    cClass: string | null;
    tpServ: string | null;
  };
  /** Chave/token do agregador (decifrada). */
  apiKey: string | null;
  /** Certificado A1 decifrado (quando enviado). */
  certificate: { pfx: Buffer; passphrase: string } | null;
}

@Injectable()
export class NfcomConfigService {
  private readonly logger = new Logger(NfcomConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly transmitters: NfcomTransmitterRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async getConfig(tenantId: string): Promise<NfcomConfigResponse> {
    const cfg = await this.findRaw(tenantId);
    return this.toResponse(cfg);
  }

  private findRaw(tenantId: string): Promise<NfcomConfig | null> {
    return this.prisma.nfcomConfig.findUnique({ where: { tenantId } });
  }

  /** Resolve config a partir do token do webhook (rota pública). */
  findByWebhookToken(token: string): Promise<NfcomConfig | null> {
    if (!token) return Promise.resolve(null);
    return this.prisma.nfcomConfig.findFirst({ where: { webhookToken: token } });
  }

  // ---------------------------------------------------------------------------
  // SAVE (admin) — PATCH semântico, saves parciais por seção
  // ---------------------------------------------------------------------------
  async saveConfig(
    tenantId: string,
    actorUserId: string,
    input: UpdateNfcomConfigRequest,
  ): Promise<NfcomConfigResponse> {
    const existing = await this.findRaw(tenantId);
    const em = input.emitente ?? {};
    const tax = input.taxDefaults ?? {};

    // apiKey é write-only: só sobrescreve quando vem valor não-vazio.
    let credentialsEnc = existing?.credentialsEnc ?? null;
    let credsChanged = false;
    const apiKey = input.credentials?.apiKey?.trim();
    if (apiKey) {
      credentialsEnc = this.crypto.encrypt(JSON.stringify({ apiKey }));
      credsChanged = true;
    }

    const enabled = input.enabled ?? existing?.enabled ?? false;
    const cnpj = em.cnpj ?? existing?.cnpj ?? null;
    const razaoSocial = em.razaoSocial ?? existing?.razaoSocial ?? null;
    const uf = em.uf ?? existing?.uf ?? null;

    // Pra habilitar, exige identidade mínima do emitente.
    if (enabled && (!cnpj || !razaoSocial || !uf)) {
      throw new BadRequestException(
        'Para habilitar a NFCom, informe CNPJ, razão social e UF do emitente.',
      );
    }

    const webhookToken =
      existing?.webhookToken ?? randomBytes(24).toString('hex');

    const data = {
      environment: input.environment ?? existing?.environment ?? 'HOMOLOGACAO',
      enabled,
      transmitter: input.transmitter ?? existing?.transmitter ?? 'NUVEM_FISCAL',
      credentialsEnc,
      cnpj: cnpj ?? '',
      inscricaoEstadual:
        em.inscricaoEstadual !== undefined
          ? em.inscricaoEstadual
          : (existing?.inscricaoEstadual ?? null),
      razaoSocial: razaoSocial ?? '',
      nomeFantasia:
        em.nomeFantasia !== undefined
          ? em.nomeFantasia
          : (existing?.nomeFantasia ?? null),
      crt: em.crt !== undefined ? em.crt : (existing?.crt ?? null),
      uf: uf ?? '',
      codMunicipio:
        em.codMunicipio !== undefined
          ? em.codMunicipio
          : (existing?.codMunicipio ?? null),
      endLogradouro:
        em.endLogradouro !== undefined ? em.endLogradouro : (existing?.endLogradouro ?? null),
      endNumero: em.endNumero !== undefined ? em.endNumero : (existing?.endNumero ?? null),
      endComplemento:
        em.endComplemento !== undefined ? em.endComplemento : (existing?.endComplemento ?? null),
      endBairro: em.endBairro !== undefined ? em.endBairro : (existing?.endBairro ?? null),
      endMunicipioNome:
        em.endMunicipioNome !== undefined
          ? em.endMunicipioNome
          : (existing?.endMunicipioNome ?? null),
      endCep: em.endCep !== undefined ? em.endCep : (existing?.endCep ?? null),
      fone: em.fone !== undefined ? em.fone : (existing?.fone ?? null),
      email: em.email !== undefined ? em.email : (existing?.email ?? null),
      serie: em.serie ?? existing?.serie ?? '1',
      cstIcms:
        tax.cstIcms !== undefined ? tax.cstIcms : (existing?.cstIcms ?? null),
      aliquotaIcms:
        tax.aliquotaIcms !== undefined
          ? tax.aliquotaIcms
          : (existing?.aliquotaIcms ?? null),
      cfop: tax.cfop !== undefined ? tax.cfop : (existing?.cfop ?? null),
      cClass:
        tax.cClass !== undefined ? tax.cClass : (existing?.cClass ?? null),
      tpServ:
        tax.tpServ !== undefined ? tax.tpServ : (existing?.tpServ ?? null),
      autoGenerate: input.autoGenerate ?? existing?.autoGenerate ?? false,
      webhookToken,
    };

    const saved = await this.prisma.nfcomConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'nfcom.config.updated',
      resource: 'nfcom_config',
      resourceId: saved.id,
      metadata: {
        environment: saved.environment,
        transmitter: saved.transmitter,
        enabled: saved.enabled,
        credsChanged,
      },
    });

    return this.toResponse(saved);
  }

  // ---------------------------------------------------------------------------
  // CERTIFICADO (.pfx A1)
  // ---------------------------------------------------------------------------
  async uploadCertificate(
    tenantId: string,
    actorUserId: string,
    fileBuffer: Buffer,
    password: string,
  ): Promise<NfcomCertificateInfoResponse> {
    if (fileBuffer.length > 100 * 1024) {
      throw new BadRequestException('Certificado maior que 100KB — arquivo inesperado.');
    }
    let extracted: {
      commonName: string | null;
      validFrom: string;
      validTo: string;
      fingerprint: string;
    };
    try {
      extracted = this.parseP12(fileBuffer, password);
    } catch (e) {
      throw new BadRequestException(
        'Falha ao abrir o certificado .pfx — verifique a senha e o arquivo. ' +
          (e instanceof Error ? e.message : String(e)),
      );
    }

    await this.prisma.nfcomConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        cnpj: '',
        razaoSocial: '',
        uf: '',
        certificateEnc: this.crypto.encrypt(fileBuffer.toString('base64')),
        certificatePasswordEnc: this.crypto.encrypt(password),
        webhookToken: randomBytes(24).toString('hex'),
      },
      update: {
        certificateEnc: this.crypto.encrypt(fileBuffer.toString('base64')),
        certificatePasswordEnc: this.crypto.encrypt(password),
      },
    });

    // Audit guarda fingerprint pra rastreio de troca de cert. NUNCA a senha.
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'nfcom.certificate.uploaded',
      resource: 'nfcom_config',
      resourceId: tenantId,
      metadata: {
        commonName: extracted.commonName,
        validTo: extracted.validTo,
        fingerprint: extracted.fingerprint,
        sizeBytes: fileBuffer.length,
      },
    });

    return this.certInfoFrom(extracted, true);
  }

  async deleteCertificate(
    tenantId: string,
    actorUserId: string,
  ): Promise<{ removed: boolean }> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg?.certificateEnc) return { removed: false };
    await this.prisma.nfcomConfig.update({
      where: { tenantId },
      data: { certificateEnc: null, certificatePasswordEnc: null },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'nfcom.certificate.deleted',
      resource: 'nfcom_config',
      resourceId: tenantId,
    });
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // RESOLVE (segredos decifrados, pronto pro transmissor)
  // ---------------------------------------------------------------------------
  async loadEffectiveConfig(tenantId: string): Promise<NfcomEffectiveConfig | null> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg) return null;
    return {
      environment: cfg.environment,
      transmitter: cfg.transmitter,
      enabled: cfg.enabled,
      emitente: {
        cnpj: cfg.cnpj,
        inscricaoEstadual: cfg.inscricaoEstadual,
        razaoSocial: cfg.razaoSocial,
        nomeFantasia: cfg.nomeFantasia,
        crt: cfg.crt,
        uf: cfg.uf,
        codMunicipio: cfg.codMunicipio,
        endLogradouro: cfg.endLogradouro,
        endNumero: cfg.endNumero,
        endComplemento: cfg.endComplemento,
        endBairro: cfg.endBairro,
        endMunicipioNome: cfg.endMunicipioNome,
        endCep: cfg.endCep,
        fone: cfg.fone,
        email: cfg.email,
        serie: cfg.serie,
      },
      taxDefaults: {
        cstIcms: cfg.cstIcms,
        aliquotaIcms: cfg.aliquotaIcms != null ? Number(cfg.aliquotaIcms) : null,
        cfop: cfg.cfop,
        cClass: cfg.cClass,
        tpServ: cfg.tpServ,
      },
      apiKey: this.readApiKey(cfg),
      certificate: this.readCertificate(cfg),
    };
  }

  /**
   * DIAGNÓSTICO — "Testar conexão SVRS". Faz o handshake mTLS real
   * (NFComStatusServico) sem emitir documento. Não exige `enabled`.
   */
  async diagnose(tenantId: string): Promise<
    NfcomStatusResult & { environment: string; transmitter: string; hasCertificate: boolean }
  > {
    const cfg = await this.loadEffectiveConfig(tenantId);
    if (!cfg) {
      throw new BadRequestException('Configure a NFCom antes de diagnosticar.');
    }
    const base = {
      environment: cfg.environment,
      transmitter: cfg.transmitter,
      hasCertificate: !!cfg.certificate,
    };
    if (!this.transmitters.has(cfg.transmitter)) {
      return { ok: false, error: `Transmissor ${cfg.transmitter} indisponível.`, ...base };
    }
    const result = await this.transmitters.resolve(cfg.transmitter).status(cfg);
    return { ...result, ...base };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private readApiKey(cfg: NfcomConfig | null): string | null {
    if (!cfg?.credentialsEnc) return null;
    try {
      const obj = JSON.parse(this.crypto.decrypt(cfg.credentialsEnc));
      return typeof obj?.apiKey === 'string' ? obj.apiKey : null;
    } catch (e) {
      this.logger.error(
        `Falha ao decifrar credenciais NFCom do tenant ${cfg.tenantId}: ${String(e)}`,
      );
      return null;
    }
  }

  private readCertificate(
    cfg: NfcomConfig | null,
  ): { pfx: Buffer; passphrase: string } | null {
    if (!cfg?.certificateEnc) return null;
    const base64 = this.crypto.decrypt(cfg.certificateEnc);
    return {
      pfx: Buffer.from(base64, 'base64'),
      passphrase: this.crypto.decryptOptional(cfg.certificatePasswordEnc) ?? '',
    };
  }

  private toResponse(cfg: NfcomConfig | null): NfcomConfigResponse {
    let certificate: NfcomCertificateInfoResponse | null = null;
    if (cfg?.certificateEnc) {
      const cred = this.readCertificate(cfg);
      try {
        const ext = this.parseP12(cred!.pfx, cred!.passphrase);
        certificate = this.certInfoFrom(ext, true);
      } catch {
        // Cert salvo mas senha mudou/corrompeu — sinaliza existência sem metadata.
        certificate = {
          exists: true,
          commonName: null,
          validFrom: null,
          validTo: null,
          fingerprint: null,
          daysUntilExpiry: null,
          hasPassword: !!cfg.certificatePasswordEnc,
        };
      }
    }

    return {
      enabled: cfg?.enabled ?? false,
      environment: cfg?.environment ?? 'HOMOLOGACAO',
      transmitter: cfg?.transmitter ?? 'NUVEM_FISCAL',
      emitente: cfg?.cnpj
        ? {
            cnpj: cfg.cnpj,
            inscricaoEstadual: cfg.inscricaoEstadual ?? undefined,
            razaoSocial: cfg.razaoSocial,
            nomeFantasia: cfg.nomeFantasia ?? undefined,
            crt: (cfg.crt as '1' | '2' | '3' | null) ?? undefined,
            uf: cfg.uf,
            codMunicipio: cfg.codMunicipio ?? undefined,
            endLogradouro: cfg.endLogradouro ?? undefined,
            endNumero: cfg.endNumero ?? undefined,
            endComplemento: cfg.endComplemento ?? undefined,
            endBairro: cfg.endBairro ?? undefined,
            endMunicipioNome: cfg.endMunicipioNome ?? undefined,
            endCep: cfg.endCep ?? undefined,
            fone: cfg.fone ?? undefined,
            email: cfg.email ?? undefined,
            serie: cfg.serie,
          }
        : null,
      taxDefaults: {
        cstIcms: cfg?.cstIcms ?? undefined,
        aliquotaIcms: cfg?.aliquotaIcms != null ? Number(cfg.aliquotaIcms) : undefined,
        cfop: cfg?.cfop ?? undefined,
        cClass: cfg?.cClass ?? undefined,
        tpServ: cfg?.tpServ ?? undefined,
      },
      credentials: { hasValue: !!cfg?.credentialsEnc },
      certificate,
      autoGenerate: cfg?.autoGenerate ?? false,
      nextNumero: cfg?.nextNumero ?? 1,
      updatedAt: cfg?.updatedAt?.toISOString() ?? null,
    };
  }

  private certInfoFrom(
    ext: {
      commonName: string | null;
      validFrom: string;
      validTo: string;
      fingerprint: string;
    },
    hasPassword: boolean,
  ): NfcomCertificateInfoResponse {
    const days = Math.floor(
      (new Date(ext.validTo).getTime() - Date.now()) / 86_400_000,
    );
    return {
      exists: true,
      commonName: ext.commonName,
      validFrom: ext.validFrom,
      validTo: ext.validTo,
      fingerprint: ext.fingerprint,
      daysUntilExpiry: days,
      hasPassword,
    };
  }

  /**
   * Abre o .pfx (PKCS#12) com node-forge e extrai metadata do certificado
   * X.509: CN, validade, fingerprint SHA-256. Lança em senha errada/corrompido.
   * Reusa exatamente o parse do SifenConfigService.
   */
  private parseP12(
    buffer: Buffer,
    password: string,
  ): {
    commonName: string | null;
    validFrom: string;
    validTo: string;
    fingerprint: string;
  } {
    const binary = buffer.toString('binary');
    const p12Asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const list = certBags[forge.pki.oids.certBag] ?? [];
    const certBag = list.find((b) => b.cert);
    if (!certBag?.cert) {
      throw new Error('Nenhum certificado encontrado no .pfx');
    }
    const cert = certBag.cert;

    const cnAttr = cert.subject.getField('CN');
    const commonName =
      cnAttr && typeof cnAttr.value === 'string' ? cnAttr.value : null;

    const derBytes = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    const md = forge.md.sha256.create();
    md.update(derBytes);
    const fingerprint = md
      .digest()
      .toHex()
      .toUpperCase()
      .match(/.{2}/g)!
      .join(':');

    return {
      commonName,
      validFrom: cert.validity.notBefore.toISOString(),
      validTo: cert.validity.notAfter.toISOString(),
      fingerprint,
    };
  }
}
