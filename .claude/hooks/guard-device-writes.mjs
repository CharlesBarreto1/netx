#!/usr/bin/env node
/**
 * Hook PreToolUse — trava de segurança em código (AGENTS.md §1, §3, §4).
 *
 * "Texto não é trava": este hook BLOQUEIA escritas de código que violem as regras
 * não-negociáveis, em vez de confiar que o agente lembrou delas.
 *
 *   §3  SSH/NETCONF/SNMP só no device-gateway (Python). apps/api e apps/web NUNCA
 *       importam lib que fala com equipamento.
 *   §4  Nenhuma credencial hardcoded (senha/chave privada) em código.
 *   §1  A IA nunca executa ação em equipamento (sem auto-apply).
 *
 * Protocolo: lê JSON do stdin (tool_name, tool_input), responde com permissionDecision.
 */

import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'));
  } catch {
    return null;
  }
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function allow() {
  process.exit(0);
}

const input = readStdin();
if (!input) allow();

const tool = input.tool_name;
if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) allow();

const ti = input.tool_input ?? {};
const filePath = ti.file_path ?? '';

// Texto que está sendo escrito (cobre Write / Edit / MultiEdit).
const chunks = [];
if (typeof ti.content === 'string') chunks.push(ti.content);
if (typeof ti.new_string === 'string') chunks.push(ti.new_string);
if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e?.new_string) chunks.push(e.new_string);
const text = chunks.join('\n');
if (!text) allow();

const isNodeApp = /\/apps\/(api|web)\//.test(filePath);
const isTsJs = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);

// §3 — libs que falam com equipamento são proibidas fora do device-gateway.
if (isNodeApp && isTsJs) {
  const deviceLibs = [
    'ssh2',
    'ssh2-promise',
    'node-ssh',
    'netconf',
    'node-netconf',
    'net-snmp',
    'snmp-native',
    'telnet-client',
  ];
  const importRe = new RegExp(
    `(?:import|require)\\s*(?:[^'"\`]*['"\`]|\\(\\s*['"\`])(${deviceLibs.join('|')})['"\`]`,
  );
  const m = text.match(importRe);
  if (m) {
    deny(
      `Bloqueado (AGENTS.md §3): "${filePath}" está em apps/api|web e importa "${m[1]}", ` +
        `que fala com equipamento. SSH/NETCONF/SNMP só no apps/device-gateway, sempre via fila.`,
    );
  }
}

// §4 — credenciais hardcoded em qualquer código fonte.
if (isTsJs || /\.(py)$/.test(filePath)) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    deny(`Bloqueado (AGENTS.md §4): chave privada embutida em "${filePath}". Use o cofre.`);
  }
  const secretRe =
    /\b(password|passwd|secret|api[_-]?key|private[_-]?key)\b\s*[:=]\s*['"][^'"]{6,}['"]/i;
  const sm = text.match(secretRe);
  // Permite placeholders óbvios (.example, env, vault://).
  if (sm && !/example|process\.env|os\.environ|vault:\/\/|<|\$\{/.test(sm[0])) {
    deny(
      `Bloqueado (AGENTS.md §4): possível credencial hardcoded em "${filePath}" (${sm[1]}). ` +
        `Credenciais só no cofre; nunca em código.`,
    );
  }
}

allow();
