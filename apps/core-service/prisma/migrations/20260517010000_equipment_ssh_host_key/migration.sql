-- =============================================================================
-- NetworkEquipment.sshHostKey — defesa contra MITM no disconnect via SSH.
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Sem isso, `node-ssh` (via ssh2) aceita qualquer host key na primeira
-- conexão. Um atacante MITM entre core-service e o BNG/OLT captura sshPassword
-- decifrado em memória (ou pode executar comandos no equipamento atacante).
--
-- Formato armazenado: `SHA256:<base64>` (igual ssh-keygen -lf, igual known_hosts).
-- A camada de aplicação (SshDisconnectStrategy) compara com o hash da chave
-- apresentada pelo servidor durante connect.
-- =============================================================================

ALTER TABLE "network_equipment"
    ADD COLUMN "ssh_host_key" TEXT;

-- Comentário no banco pra documentar o formato.
COMMENT ON COLUMN "network_equipment"."ssh_host_key" IS
    'SSH host key fingerprint no formato SHA256:<base64>. NULL = strategy SSH desabilitada por segurança (operador precisa cadastrar via test-connectivity).';
