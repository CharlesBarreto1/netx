import { Injectable } from '@nestjs/common';

/** Considera o operador online se o último heartbeat foi há menos que isso. */
const TTL_MS = 60_000;

interface PresenceEntry {
  lastSeen: number;
  /** Conversa que o operador tem ABERTA agora (pra "quem está vendo este grupo"). */
  viewingConversationId: string | null;
}

/**
 * Presença de operadores no atendimento (quem está online + o que está vendo).
 *
 * Em memória, por processo — mesma premissa do WhatsappEventsBus (SSE também é
 * in-memory single-instance). O cliente do chat faz heartbeat periódico
 * (POST /whatsapp/presence) informando a conversa aberta; a UI mostra bolinha
 * verde nos membros online e "quem está vendo o grupo agora".
 */
@Injectable()
export class WhatsappPresenceService {
  // tenantId -> (userId -> entry)
  private readonly byTenant = new Map<string, Map<string, PresenceEntry>>();

  /** Marca o operador como online e registra qual conversa ele tem aberta. */
  touch(tenantId: string, userId: string, viewingConversationId: string | null) {
    let users = this.byTenant.get(tenantId);
    if (!users) {
      users = new Map();
      this.byTenant.set(tenantId, users);
    }
    users.set(userId, { lastSeen: Date.now(), viewingConversationId });
  }

  /** Operadores online do tenant (heartbeat recente). Faz prune dos expirados. */
  online(tenantId: string): Array<{ userId: string; viewingConversationId: string | null }> {
    const users = this.byTenant.get(tenantId);
    if (!users) return [];
    const now = Date.now();
    const out: Array<{ userId: string; viewingConversationId: string | null }> = [];
    for (const [userId, e] of users) {
      if (now - e.lastSeen > TTL_MS) {
        users.delete(userId);
        continue;
      }
      out.push({ userId, viewingConversationId: e.viewingConversationId });
    }
    return out;
  }
}
