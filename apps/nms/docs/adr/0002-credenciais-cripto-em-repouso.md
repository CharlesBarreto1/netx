# ADR 0002 — Credenciais de equipamento: cripto em repouso (AES-256-GCM)

- Status: aceito
- Data: 2026-06-19

## Contexto

A §4 do AGENTS.md é não-negociável: **apenas o `device-gateway` pode acessar credenciais
de equipamento**; nunca em código, `.env` commitado, log ou banco em texto claro. O AGENTS.md
aceita "Vault ou, no mínimo, cripto em repouso com chave por instância". Alvo: instância
on-prem por cliente, provedor pequeno.

## Decisão

Usar **cripto em repouso AES-256-GCM**, espelhando o `CryptoService` do NetX principal
(formato `v1:iv:tag:ct`), **sem** adicionar um serviço de Vault no MVP.

Ponto-chave para honrar a §4 **criptograficamente** (não só por convenção):

- A **chave-mestra** (`NETX_NMS_MASTER_KEY`, 32 bytes base64, por instância) vive **somente
  no ambiente do `device-gateway`**. A API **nunca** tem a chave.
- **Cifrar/decifrar acontece só no Python** (`device-gateway`). A API guarda e devolve o
  **ciphertext**, mas não consegue lê-lo.
- **Fluxo de gravar credencial**: a API recebe o segredo do usuário (input HTTP), enfileira
  um job `store-credential` para o gateway; o gateway cifra com a chave-mestra e persiste o
  blob. A API só vê o ciphertext resultante.
- **Uso**: ao rodar um job contra equipamento, só o gateway decifra, em memória, na hora.

## Consequências

- Zero serviço novo; alinhado ao alvo on-prem. A chave é responsabilidade operacional
  (provisionada por instância, fora do repositório).
- O segredo em texto claro transita **uma vez** pela fila interna (Redis) no momento da
  gravação. Aceitável no MVP (rede interna); migrar para Vault (ADR futuro) elimina isso.
- `Device.credentialsRef` deixa de ser ponteiro p/ Vault e passa a referenciar o registro
  `DeviceCredential` (blob cifrado) no próprio banco.

## Alternativas

- **HashiCorp Vault**: rotação e auditoria nativas, porém serviço e operação a mais. Pode
  entrar depois sem reescrever o resto (a fronteira "só o gateway lê segredo" já isola isso).
- **Chave simétrica compartilhada API+gateway**: mais simples, mas a API poderia decifrar —
  enfraquece a §4. Rejeitado.
