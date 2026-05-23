/**
 * SifenConfigService — config SIFEN por tenant + upload do certificado .p12.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Armazenamento:
 *   - Config "humana" (RUC, timbrado, emisor, ambiente, CSC id) → TenantSetting
 *     key='sifen.config' value=JSON. Multi-tenant safe.
 *   - Secrets (senha .p12 + valor CSC) → cifrados com CryptoService
 *     (AES-256-GCM com KMS_MASTER_KEY) DENTRO do mesmo JSON.
 *   - Cert binário .p12 → arquivo em /etc/netx/sifen/cert-<tenantId>.p12,
 *     chmod 640, owner root:netx (assumindo systemd unit roda como netx).
 *
 * Fallback compat: se o tenant não tem TenantSetting, `loadEffectiveConfig`
 * devolve null → SifenService cai pra env vars (modo single-tenant legado).
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import forge from 'node-forge';
import {
  SifenConfigSchema,
  type SifenCertificateInfoResponse,
  type SifenConfig,
  type SifenConfigResponse,
  type SifenEmisor,
  type UpdateSifenConfigRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

const SETTING_KEY = 'sifen.config';
const CERT_DIR = process.env.SIFEN_CERT_DIR ?? '/etc/netx/sifen';
const MAX_CERT_BYTES = 100 * 1024; // 100KB — .p12 típicos ficam abaixo

/**
 * Forma interna persistida em TenantSetting.value. Os campos `*Enc` são
 * ciphertexts gerados pelo CryptoService. Sempre que sair pra fora desta
 * classe, os secrets viram null/hasValue:boolean (resposta) OU já decifrados
 * (effectiveConfig pra emitter).
 */
interface StoredConfig {
  enabled: boolean;
  environment: 'test' | 'prod';
  emisor?: SifenEmisor;
  csc?: {
    id?: string;
    /** Ciphertext do valor CSC. null = vazio. */
    valueEnc: string | null;
  };
  certificate?: {
    /** Path absoluto do arquivo .p12 (em /etc/netx/sifen). */
    path: string;
    /** Ciphertext da senha .p12. */
    passwordEnc: string;
    /** Metadados do cert extraídos no upload (cache pra evitar abrir o p12 sempre). */
    commonName: string | null;
    validFrom: string | null;  // ISO
    validTo: string | null;    // ISO
    fingerprint: string | null;
  };
  updatedAt: string;
}

export interface SifenEffectiveConfig {
  enabled: boolean;
  environment: 'test' | 'prod';
  emisor: SifenEmisor | null;
  certificate: {
    path: string;
    password: string; // DECIFRADO — só pra passar pro emitter, nunca log
  } | null;
  csc: {
    id: string;
    value: string; // DECIFRADO
  } | null;
}

@Injectable()
export class SifenConfigService {
  private readonly logger = new Logger(SifenConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public — usado pelo controller (UI)
  // ---------------------------------------------------------------------------

  async getConfig(tenantId: string): Promise<SifenConfigResponse> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const stored = setting ? (setting.value as unknown as StoredConfig) : null;

    const certInfo = await this.getCertificateInfo(tenantId);

    if (!stored) {
      return {
        enabled: false,
        environment: 'test',
        emisor: null,
        csc: { id: null, hasValue: false },
        certificate: certInfo,
        source: this.hasEnvFallback() ? 'env' : 'unconfigured',
        updatedAt: null,
      };
    }

    return {
      enabled: stored.enabled,
      environment: stored.environment,
      emisor: stored.emisor ?? null,
      csc: {
        id: stored.csc?.id ?? null,
        hasValue: !!stored.csc?.valueEnc,
      },
      certificate: certInfo,
      source: 'tenantSetting',
      updatedAt: stored.updatedAt,
    };
  }

  async saveConfig(
    tenantId: string,
    actorUserId: string,
    input: UpdateSifenConfigRequest,
  ): Promise<SifenConfigResponse> {
    // Lê config atual pra fazer merge (PATCH semântico).
    const existing = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const current: StoredConfig =
      (existing?.value as unknown as StoredConfig) ?? {
        enabled: false,
        environment: 'test',
        updatedAt: new Date().toISOString(),
      };

    // Merge superficial: substitui blocos quando vierem; mantém o resto.
    const next: StoredConfig = {
      enabled: input.enabled ?? current.enabled,
      environment: input.environment ?? current.environment,
      emisor: input.emisor
        ? ({ ...(current.emisor ?? {}), ...input.emisor } as SifenEmisor)
        : current.emisor,
      csc: input.csc
        ? {
            id: input.csc.id ?? current.csc?.id,
            // Só re-cifra se veio valor novo; senão preserva o ciphertext.
            valueEnc:
              input.csc.value && input.csc.value.length > 0
                ? this.crypto.encrypt(input.csc.value)
                : (current.csc?.valueEnc ?? null),
          }
        : current.csc,
      certificate: current.certificate,
      updatedAt: new Date().toISOString(),
    };

    // Se vai marcar enabled=true, valida que tem o mínimo configurado.
    if (next.enabled) {
      const missing: string[] = [];
      if (!next.emisor) missing.push('emisor');
      else {
        const required: Array<keyof SifenEmisor> = [
          'ruc', 'timbrado', 'timbradoFecha', 'razonSocial',
          'tipoContribuyente', 'tipoRegimen',
          'actividadCodigo', 'actividadDescripcion',
          'establecimiento', 'puntoExpedicion', 'direccion',
          'departamento', 'distrito', 'ciudad',
        ];
        for (const k of required) {
          if (!next.emisor[k] && next.emisor[k] !== 0) missing.push(`emisor.${k}`);
        }
      }
      if (!next.certificate) missing.push('certificate (faça upload do .p12)');
      if (!next.csc?.id || !next.csc?.valueEnc) missing.push('csc.id + csc.value');
      if (missing.length > 0) {
        throw new BadRequestException(
          'Não dá pra habilitar SIFEN sem os campos: ' + missing.join(', '),
        );
      }
    }

    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      create: {
        tenantId,
        key: SETTING_KEY,
        value: next as unknown as object,
      },
      update: { value: next as unknown as object },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'sifen.config.updated',
      resource: 'tenant_settings',
      resourceId: SETTING_KEY,
      metadata: {
        enabled: next.enabled,
        environment: next.environment,
        hasEmisor: !!next.emisor,
        hasCertificate: !!next.certificate,
        hasCsc: !!next.csc?.valueEnc,
      },
    });

    return this.getConfig(tenantId);
  }

  async getCertificateInfo(
    tenantId: string,
  ): Promise<SifenCertificateInfoResponse> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      select: { value: true },
    });
    const stored = setting ? (setting.value as unknown as StoredConfig) : null;
    const certPath = stored?.certificate?.path ?? this.tenantCertPath(tenantId);
    const exists = await this.fileExists(certPath);

    if (!exists) {
      return {
        exists: false,
        commonName: null,
        validFrom: null,
        validTo: null,
        fingerprint: null,
        daysUntilExpiry: null,
        hasPassword: !!stored?.certificate?.passwordEnc,
      };
    }

    // Cache no TenantSetting é a fonte da verdade — evita reabrir o p12 toda
    // request (e exigiria a senha decifrada). Se o cache estiver vazio
    // (cert subido fora do upload normal), devolve metadata mínima.
    const cached = stored?.certificate;
    const validTo = cached?.validTo ?? null;
    const daysUntilExpiry =
      validTo != null
        ? Math.floor(
            (new Date(validTo).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          )
        : null;

    return {
      exists: true,
      commonName: cached?.commonName ?? null,
      validFrom: cached?.validFrom ?? null,
      validTo,
      fingerprint: cached?.fingerprint ?? null,
      daysUntilExpiry,
      hasPassword: !!cached?.passwordEnc,
    };
  }

  async uploadCertificate(
    tenantId: string,
    actorUserId: string,
    fileBuffer: Buffer,
    password: string,
  ): Promise<SifenCertificateInfoResponse> {
    if (fileBuffer.byteLength > MAX_CERT_BYTES) {
      throw new BadRequestException(
        `Certificado muito grande (${fileBuffer.byteLength} > ${MAX_CERT_BYTES} bytes)`,
      );
    }

    // Validação: tenta abrir o .p12 com a senha — confirma cert válido e
    // senha correta ANTES de gravar no disco. Erro de senha é o caso mais
    // comum, melhor pegar aqui com mensagem clara.
    let extracted: {
      commonName: string | null;
      validFrom: string;
      validTo: string;
      fingerprint: string;
    };
    try {
      extracted = this.parseP12(fileBuffer, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Certificado .p12 inválido ou senha errada: ${msg}`,
      );
    }

    // Garante diretório existe (idempotente).
    await fsp.mkdir(CERT_DIR, { recursive: true, mode: 0o750 });
    const certPath = this.tenantCertPath(tenantId);
    await fsp.writeFile(certPath, fileBuffer, { mode: 0o640 });

    // Atualiza TenantSetting com path + senha cifrada + metadata.
    const existing = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const current: StoredConfig =
      (existing?.value as unknown as StoredConfig) ?? {
        enabled: false,
        environment: 'test',
        updatedAt: new Date().toISOString(),
      };
    const next: StoredConfig = {
      ...current,
      certificate: {
        path: certPath,
        passwordEnc: this.crypto.encrypt(password),
        commonName: extracted.commonName,
        validFrom: extracted.validFrom,
        validTo: extracted.validTo,
        fingerprint: extracted.fingerprint,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      create: { tenantId, key: SETTING_KEY, value: next as unknown as object },
      update: { value: next as unknown as object },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'sifen.certificate.uploaded',
      resource: 'tenant_settings',
      resourceId: SETTING_KEY,
      // Audit guarda fingerprint pra rastreio de troca de cert. NUNCA senha.
      metadata: {
        commonName: extracted.commonName,
        validFrom: extracted.validFrom,
        validTo: extracted.validTo,
        fingerprint: extracted.fingerprint,
        sizeBytes: fileBuffer.byteLength,
      },
    });

    return this.getCertificateInfo(tenantId);
  }

  async deleteCertificate(
    tenantId: string,
    actorUserId: string,
  ): Promise<{ removed: boolean }> {
    const certPath = this.tenantCertPath(tenantId);
    const existed = await this.fileExists(certPath);
    if (existed) {
      try {
        await fsp.unlink(certPath);
      } catch (err) {
        this.logger.warn(
          `[SIFEN] falha ao remover ${certPath}: ${(err as Error).message}`,
        );
      }
    }

    const existing = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    if (existing) {
      const current = existing.value as unknown as StoredConfig;
      const next: StoredConfig = {
        ...current,
        certificate: undefined,
        // Desliga SIFEN automaticamente — sem cert não dá pra emitir.
        enabled: false,
        updatedAt: new Date().toISOString(),
      };
      await this.prisma.tenantSetting.update({
        where: { tenantId_key: { tenantId, key: SETTING_KEY } },
        data: { value: next as unknown as object },
      });
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'sifen.certificate.removed',
      resource: 'tenant_settings',
      resourceId: SETTING_KEY,
      level: 'WARNING',
      metadata: { existed, certPath },
    });
    return { removed: existed };
  }

  // ---------------------------------------------------------------------------
  // Internal — consumido pelo SifenService antes de chamar o emitter
  // ---------------------------------------------------------------------------

  async loadEffectiveConfig(
    tenantId: string,
  ): Promise<SifenEffectiveConfig | null> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    if (!setting) return null;
    const stored = setting.value as unknown as StoredConfig;

    return {
      enabled: stored.enabled,
      environment: stored.environment,
      emisor: stored.emisor ?? null,
      certificate: stored.certificate
        ? {
            path: stored.certificate.path,
            password: this.crypto.decrypt(stored.certificate.passwordEnc),
          }
        : null,
      csc:
        stored.csc?.id && stored.csc.valueEnc
          ? {
              id: stored.csc.id,
              value: this.crypto.decrypt(stored.csc.valueEnc),
            }
          : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private tenantCertPath(tenantId: string): string {
    return path.join(CERT_DIR, `cert-${tenantId}.p12`);
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fsp.access(p, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private hasEnvFallback(): boolean {
    return !!(process.env.SIFEN_RUC && process.env.SIFEN_TIMBRADO);
  }

  /**
   * Abre o .p12 com node-forge, extrai metadata do certificado X.509:
   * CN, validade, fingerprint SHA-256. Lança em senha errada ou arquivo
   * corrompido.
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
    // node-forge espera binary string, não Buffer direto.
    const binary = buffer.toString('binary');
    const p12Asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    // Procura cert bag (oid certBag = 1.2.840.113549.1.12.10.1.3)
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const list = certBags[forge.pki.oids.certBag] ?? [];
    const certBag = list.find((b) => b.cert);
    if (!certBag?.cert) {
      throw new Error('Nenhum certificado encontrado no .p12');
    }
    const cert = certBag.cert;

    // CN do subject
    const cnAttr = cert.subject.getField('CN');
    const commonName = cnAttr && typeof cnAttr.value === 'string' ? cnAttr.value : null;

    // Fingerprint SHA-256 do DER
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

// Re-export SifenConfigSchema pra controller fazer validate (evita import circular)
export { SifenConfigSchema };
