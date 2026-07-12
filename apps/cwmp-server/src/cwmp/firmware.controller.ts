/**
 * GET /fw/{id} — serve a imagem de firmware pro CPE (RPC Download).
 *
 * Mora AQUI (cwmp-server, :7547) de propósito: é a mesma origem HTTP que o
 * CPE já alcança pro ACS — sem nginx, sem MinIO, sem TLS (CPE antigo não
 * valida certificado mesmo). O core-service grava os arquivos no MESMO
 * TR069_FIRMWARE_DIR (default /var/lib/netx/firmware, nome <uuid>.bin) —
 * os dois serviços rodam no mesmo host; se um dia separarem, vira NFS/objeto.
 *
 * Sem auth: o UUID aleatório no path é o token (mesma postura do MinIO
 * presigned). res.sendFile cuida de Range (a ZTE baixa por ranges) e
 * Content-Length.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { existsSync } from 'node:fs';

import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

const FIRMWARE_DIR = process.env.TR069_FIRMWARE_DIR ?? '/var/lib/netx/firmware';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class FirmwareController {
  private readonly logger = new Logger(FirmwareController.name);

  @Get('/fw/:id')
  serve(@Param('id') id: string, @Res() res: Response): void {
    // UUID estrito = também é o sanitizador do path (nada de ../ ou nomes).
    if (!UUID_RE.test(id)) {
      res.status(404).send('not found');
      return;
    }
    const fileName = `${id.toLowerCase()}.bin`;
    if (!existsSync(`${FIRMWARE_DIR}/${fileName}`)) {
      res.status(404).send('not found');
      return;
    }
    this.logger.log(`[FW] servindo ${fileName} pra ${res.req.ip ?? '?'}`);
    res.sendFile(fileName, {
      root: FIRMWARE_DIR,
      headers: { 'Content-Type': 'application/octet-stream' },
      dotfiles: 'deny',
    });
  }
}
