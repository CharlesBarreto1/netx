import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT ?? '/var/lib/netx/whatsapp/media';
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';
const WHISPER_BIN = process.env.WHISPER_BIN ?? '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? '/opt/whisper.cpp/models/ggml-small.bin';

/**
 * Transcrição de áudio sob demanda via whisper.cpp local (sem nuvem/key).
 * Pipeline: ffmpeg converte o áudio (ogg/mp3/...) → wav 16kHz mono → whisper-cli
 * (idioma auto, sem timestamps) → texto. Tudo local na VM.
 */
@Injectable()
export class WhatsappTranscriptionService {
  private readonly logger = new Logger(WhatsappTranscriptionService.name);

  /** Transcreve um arquivo de mídia local (nome do arquivo em MEDIA_ROOT). */
  async transcribeFile(filename: string): Promise<string> {
    if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
      throw new BadRequestException('Arquivo inválido');
    }
    const src = join(MEDIA_ROOT, filename);
    try {
      await fs.access(src);
    } catch {
      throw new BadRequestException('Áudio não encontrado no servidor.');
    }

    const wav = join(tmpdir(), `wa-tr-${randomUUID()}.wav`);
    try {
      // 1) áudio → wav 16kHz mono (formato exigido pelo whisper.cpp)
      await exec(FFMPEG, ['-y', '-i', src, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], {
        timeout: 60_000,
      });
      // 2) whisper.cpp: -nt (sem timestamps) -np (sem logs) -l auto (detecta idioma)
      const { stdout } = await exec(
        WHISPER_BIN,
        ['-m', WHISPER_MODEL, '-f', wav, '-nt', '-np', '-l', 'auto'],
        { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const text = stdout.replace(/\s+/g, ' ').trim();
      if (!text) throw new BadRequestException('Não consegui transcrever (áudio vazio ou inaudível).');
      return text;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(`Transcrição falhou (${filename}): ${(e as Error).message}`);
      throw new BadRequestException('Falha ao transcrever o áudio. Tente novamente.');
    } finally {
      await fs.unlink(wav).catch(() => {});
    }
  }

  /**
   * Converte um áudio gravado no navegador (webm/opus, mp4...) para OGG/Opus —
   * formato de NOTA DE VOZ aceito pela Meta. Re-encoda em opus mono 48kHz.
   */
  async toVoiceOgg(input: Buffer): Promise<Buffer> {
    const inPath = join(tmpdir(), `wa-vin-${randomUUID()}`);
    const outPath = join(tmpdir(), `wa-vout-${randomUUID()}.ogg`);
    await fs.writeFile(inPath, input);
    try {
      await exec(
        FFMPEG,
        ['-y', '-i', inPath, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', outPath],
        { timeout: 60_000 },
      );
      return await fs.readFile(outPath);
    } catch (e) {
      this.logger.warn(`Conversão de áudio falhou: ${(e as Error).message}`);
      throw new BadRequestException('Não consegui processar o áudio gravado.');
    } finally {
      await fs.unlink(inPath).catch(() => {});
      await fs.unlink(outPath).catch(() => {});
    }
  }
}
