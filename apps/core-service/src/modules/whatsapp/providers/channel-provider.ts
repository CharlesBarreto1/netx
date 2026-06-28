import type { WaChannel, WaMsgType } from '@prisma/client';

/**
 * Abstração de provider de canal WhatsApp.
 *
 * Dois canais hoje:
 *   - WAHA       — não-oficial (QR / Baileys), self-hosted, grátis.
 *   - META_CLOUD — oficial (WhatsApp Business Platform / Graph API).
 *
 * Os services de negócio (instances, conversations, messages) NÃO conhecem o
 * formato HTTP nem o payload de cada canal — falam só nesta interface e nos
 * tipos canônicos abaixo. Cada provider recebe a instância JÁ DECIFRADA
 * (`DecryptedInstance`) — nenhum provider toca o CryptoService.
 */

/** Instância com segredos já decifrados, pronta pra falar com o provider. */
export interface DecryptedInstance {
  id: string;
  tenantId: string;
  channel: WaChannel;
  instanceName: string;
  phoneE164: string | null;

  // --- WAHA ---
  baseUrl: string; // coluna evolution_url (reuso): base URL do WAHA
  apiKey: string; // decifrado: X-Api-Key do WAHA
  webhookSecret: string;

  // --- Meta Cloud ---
  wabaId: string | null;
  phoneNumberId: string | null;
  verifyToken: string | null;
  accessToken: string | null; // decifrado de apiCredentialsEnc
  appSecret: string | null; // decifrado de apiCredentialsEnc
}

/** Estado de conexão normalizado. QR só existe no WAHA. */
export interface CanonicalConnection {
  state: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR';
  phoneE164?: string | null;
  qrCode?: string | null; // base64 PNG (WAHA)
}

/** Mensagem normalizada vinda do webhook (in ou out-echo). */
export interface CanonicalMessage {
  providerMsgId: string;
  direction: 'IN' | 'OUT';
  /** Número do CONTATO (a outra ponta), E164 sem `+` ou com — normalizamos depois. */
  contactPhone: string;
  /**
   * JID/chatId real do canal (ex.: `5511...@c.us` ou `7117...@lid`). Guardamos
   * pra responder no destino EXATO — o WhatsApp às vezes entrega o remetente
   * como LID, e remontar `<digits>@c.us` não entrega.
   */
  chatId?: string | null;
  type: WaMsgType;
  body: string | null;
  /**
   * Mídia: `data` = base64 já pronto; `url`/`mediaId` = referência a baixar via
   * `downloadMedia` (WAHA serve por URL autenticada; Meta por media id).
   */
  media?: {
    data?: string | null;
    url?: string | null;
    mediaId?: string | null;
    mime: string;
    fileName?: string | null;
  } | null;
  pushName?: string | null;
  timestamp?: Date;

  // --- Grupos (WAHA) ---
  /** true quando a mensagem veio de um grupo (`from` termina em `@g.us`). */
  isGroup?: boolean;
  /** JID do grupo (ex.: `1203...@g.us`). Chave da conversa de grupo. */
  groupId?: string | null;
  /** Assunto/nome do grupo, se o payload trouxer. */
  groupName?: string | null;
  /** Telefone (E164, só dígitos) do participante que enviou. */
  authorPhone?: string | null;
  /** pushName do participante que enviou. */
  authorName?: string | null;
}

/** Grupo do WhatsApp (listagem via `listGroups`). */
export interface CanonicalGroup {
  /** JID do grupo (ex.: `1203...@g.us`). */
  id: string;
  /** Assunto/nome do grupo. */
  subject: string | null;
  /** Quantidade de participantes, se disponível. */
  participantsCount: number | null;
}

/** Atualização de status de entrega de uma mensagem já enviada. */
export interface CanonicalStatusUpdate {
  providerMsgId: string;
  status: 'DELIVERED' | 'READ' | 'FAILED';
}

export type CanonicalEvent =
  | { kind: 'message'; data: CanonicalMessage }
  | { kind: 'status'; data: CanonicalStatusUpdate }
  | { kind: 'connection'; data: CanonicalConnection };

/** Mídia de saída (sendMedia). `media` = URL pública ou dataURI base64. */
export interface OutboundMedia {
  mediatype: 'image' | 'video' | 'document' | 'audio';
  mimetype: string;
  caption?: string;
  fileName?: string;
  media: string;
}

/** Envio de template HSM (Meta, fora da janela de 24h). */
export interface TemplateSend {
  name: string;
  language: string;
  /** Parâmetros do corpo ({{1}}, {{2}}, ...) na ordem. */
  variables?: string[];
}

export interface SendResult {
  providerMsgId: string;
}

/**
 * Contrato implementado por WahaProvider e MetaCloudProvider.
 *
 * Métodos de lifecycle (`createSession`/`getQr`/`logout`/`deleteSession`) são
 * opcionais: fazem sentido só no WAHA (sessão por QR). No Meta a "sessão" é o
 * próprio token aprovado — `connectionState` valida o token.
 */
export interface ChannelProvider {
  readonly channel: WaChannel;

  // ---- lifecycle ----
  /** Cria a sessão remota. WAHA devolve QR; Meta apenas valida credenciais. */
  createSession(inst: DecryptedInstance, webhookUrl: string): Promise<CanonicalConnection>;
  /** Força refresh de QR (WAHA). Meta: no-op que devolve connectionState. */
  getQr(inst: DecryptedInstance): Promise<CanonicalConnection>;
  logout(inst: DecryptedInstance): Promise<void>;
  deleteSession(inst: DecryptedInstance): Promise<void>;
  connectionState(inst: DecryptedInstance): Promise<CanonicalConnection>;

  // ---- envio ----
  // `chatId` (opcional) = JID exato pra responder (ex.: @lid). Se ausente,
  // o provider monta a partir de `toE164`. Meta ignora (sempre usa telefone).
  sendText(inst: DecryptedInstance, toE164: string, text: string, chatId?: string | null): Promise<SendResult>;
  sendMedia(
    inst: DecryptedInstance,
    toE164: string,
    media: OutboundMedia,
    chatId?: string | null,
  ): Promise<SendResult>;
  /** Só Meta. WAHA lança (não usa template / sem janela 24h). */
  sendTemplate(inst: DecryptedInstance, toE164: string, tpl: TemplateSend): Promise<SendResult>;

  // ---- webhook ----
  /** Valida autenticidade do webhook (secret WAHA ou HMAC Meta). */
  verifyWebhook(
    inst: DecryptedInstance | null,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): boolean;
  /** Converte o payload cru do canal em eventos canônicos. */
  parseWebhook(body: unknown): CanonicalEvent[];
  /**
   * Baixa mídia referida por url (WAHA) ou mediaId (Meta) e devolve base64 +
   * mime. Retorna null se não conseguir (a mensagem ainda é persistida sem
   * mídia). Centraliza a auth do canal — messages.service só lida com base64.
   */
  downloadMedia(
    inst: DecryptedInstance,
    ref: { url?: string | null; mediaId?: string | null },
  ): Promise<{ base64: string; mime: string } | null>;

  /**
   * Lista os grupos da conta conectada. Só faz sentido no WAHA (sessão pessoal
   * via QR); o Meta Cloud não expõe os grupos do número. Opcional: providers
   * que não suportam simplesmente não implementam.
   */
  listGroups?(inst: DecryptedInstance): Promise<CanonicalGroup[]>;
}
