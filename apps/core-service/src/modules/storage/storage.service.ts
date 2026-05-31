import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { loadConfig } from '@netx/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * Storage de arquivos (MinIO / S3-compatível) — anexos de RH (documentos,
 * comprovantes, holerites) e, no futuro, fotos do mobile.
 *
 * Modelo presigned: o core NUNCA recebe os bytes. Ele assina uma URL
 * temporária (PUT pra subir, GET pra baixar) e o client fala direto com o
 * MinIO. Guardamos só a `storageKey` no banco.
 *
 * Convenção de chave:  {tenantId}/{scope}/{uuid}-{nomeArquivo}
 * Ex.:  3f.../employee-docs/9a...-atestado.pdf
 * O prefixo por tenant dá isolamento natural no bucket e facilita lifecycle.
 *
 * Sem config (STORAGE_ENDPOINT/keys ausentes) o serviço fica DESABILITADO:
 * qualquer chamada lança 503. O resto do sistema sobe normal.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly cfg = loadConfig().storage;
  private readonly client: S3Client | null;

  // TTL das URLs assinadas (segundos). Upload curto, download um pouco maior.
  private readonly uploadTtl = 60 * 10; // 10 min
  private readonly downloadTtl = 60 * 15; // 15 min

  constructor() {
    if (!this.cfg.enabled) {
      this.client = null;
      this.logger.warn(
        'StorageService DESABILITADO — defina STORAGE_ENDPOINT + STORAGE_ACCESS_KEY + STORAGE_SECRET_KEY pra habilitar uploads.',
      );
      return;
    }
    this.client = new S3Client({
      endpoint: this.cfg.endpoint,
      region: this.cfg.region,
      forcePathStyle: this.cfg.forcePathStyle,
      credentials: {
        accessKeyId: this.cfg.accessKey!,
        secretAccessKey: this.cfg.secretKey!,
      },
    });
    this.logger.log(
      `StorageService habilitado — bucket "${this.cfg.bucket}" em ${this.cfg.endpoint}`,
    );
  }

  isEnabled(): boolean {
    return this.cfg.enabled;
  }

  private assertEnabled(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Storage não configurado neste ambiente (MinIO/S3 ausente).',
      );
    }
    return this.client;
  }

  /**
   * Monta uma storageKey nova, isolada por tenant e escopo. Sanitiza o nome
   * do arquivo (mantém só o básico) e prefixa um uuid pra evitar colisão.
   */
  buildKey(tenantId: string, scope: string, fileName: string): string {
    const safe = (fileName || 'file')
      .normalize('NFKD')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(-120);
    return `${tenantId}/${scope}/${randomUUID()}-${safe}`;
  }

  /** URL presigned PUT pra o client subir o arquivo direto no bucket. */
  async presignUpload(
    key: string,
    contentType?: string,
  ): Promise<{ url: string; key: string; expiresIn: number }> {
    const client = this.assertEnabled();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: this.uploadTtl },
    );
    return { url, key, expiresIn: this.uploadTtl };
  }

  /** URL presigned GET pra download. `downloadName` força Content-Disposition. */
  async presignDownload(
    key: string,
    downloadName?: string,
  ): Promise<{ url: string; expiresIn: number }> {
    const client = this.assertEnabled();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentDisposition: downloadName
          ? `attachment; filename="${downloadName.replace(/"/g, '')}"`
          : undefined,
      }),
      { expiresIn: this.downloadTtl },
    );
    return { url, expiresIn: this.downloadTtl };
  }

  /**
   * Confere que o objeto existe (pós-upload) e devolve tamanho/mime reais.
   * Usado pra confirmar um upload antes de persistir a referência no banco.
   */
  async headObject(
    key: string,
  ): Promise<{ size: number; contentType?: string; etag?: string } | null> {
    const client = this.assertEnabled();
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return {
        size: out.ContentLength ?? 0,
        contentType: out.ContentType,
        etag: out.ETag?.replace(/"/g, ''),
      };
    } catch {
      return null;
    }
  }

  /** Remove o objeto. Idempotente — não falha se já não existir. */
  async deleteObject(key: string): Promise<void> {
    const client = this.assertEnabled();
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`Falha ao remover objeto ${key}: ${String(err)}`);
    }
  }
}
