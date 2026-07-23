/**
 * Tipos internos da integração Hubsoft (read-only).
 *
 * A API do Hubsoft (https://docs.hubsoft.com.br) devolve JSON em português com
 * formato relativamente solto e campos que variam por versão/contrato do ERP.
 * Por isso os DTOs crus abaixo são DEFENSIVOS (quase tudo opcional): o
 * HubsoftImportService normaliza com fallbacks. Valide contra o retorno real
 * do provedor (use o dry-run) antes de confiar 100% no mapeamento.
 */

export interface HubsoftCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface HubsoftResolvedConfig {
  host: string; // sem barra final, ex.: https://api.provedor.hubsoft.com.br
  credentials: HubsoftCredentials;
}

// -----------------------------------------------------------------------------
// Resposta do OAuth /oauth/token (grant_type=password)
// -----------------------------------------------------------------------------
export interface HubsoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  message?: string;
}

// -----------------------------------------------------------------------------
// Cliente — GET /api/v1/integracao/cliente (+ /cliente/all)
// Campos confirmados no docs oficial; o objeto já aninha `servicos[]`.
// -----------------------------------------------------------------------------
export interface HubsoftEndereco {
  completo?: string;
  endereco?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  referencia?: string;
  bairro?: string;
  cidade?: string;
  ibge_cidade?: string | number;
  uf?: string;
  estado?: string;
  pais?: string;
  cep?: string;
  // Coordenadas modernas vêm aninhadas em `coordenadas:{latitude,longitude}`.
  // Mantemos também os campos soltos por compat com versões antigas do payload.
  coordenadas?: { latitude?: string | number | null; longitude?: string | number | null };
  latitude?: string | number;
  longitude?: string | number;
}

/** Equipamento (BNG/roteador) que o Hubsoft anexa ao serviço via `relacoes`. */
export interface HubsoftEquipamento {
  nome?: string;
  ipv4?: string;
  ipv6?: string | null;
}

export interface HubsoftPacote {
  id_pacote?: number | string;
  codigo?: string;
  descricao?: string;
  valor?: string | number;
}

export interface HubsoftServico {
  id_cliente_servico?: number | string;
  id_servico?: number | string; // id do serviço/plano no Hubsoft (grupo)
  login?: string;
  senha?: string;
  status?: string;
  status_txt?: string;
  status_prefixo?: string; // código estável: servico_habilitado | servico_cancelado | ...
  // Nome do plano. ATENÇÃO: o shape varia por rota — em /cliente/all o nome vem
  // em `nome` e `numero_plano` é numérico; em /cliente o nome pode vir em
  // `numero_plano`. O mapeador trata os dois.
  numero_plano?: string | number;
  nome?: string;
  id_pacote?: number | string;
  pacotes?: HubsoftPacote[];
  valor?: string | number;
  tecnologia?: string;
  conectado?: string;
  ipv4?: string;
  ipv6?: string;
  // Campos técnicos ricos expostos pela rota /integracao/cliente/todos (base
  // nova da API): velocidade já em número/rótulo ("512 Mbits"), MAC do CPE, VLAN
  // do assinante. Preferidos sobre derivar do nome do plano quando presentes.
  velocidade_download?: string | number;
  velocidade_upload?: string | number;
  mac_addr?: string;
  phy_addr?: string;
  vlan?: string | number;
  vencimento?: string | number;
  equipamento_conexao?: HubsoftEquipamento | unknown;
  equipamento_roteamento?: HubsoftEquipamento | unknown;
  interface?: unknown;
  endereco_instalacao?: HubsoftEndereco | string;
}

export interface HubsoftCliente {
  id_cliente?: number | string;
  codigo_cliente?: number | string;
  tipo_pessoa?: string; // "Pessoa Física" | "Pessoa Jurídica" | "pf" | "pj" | ...
  nome_razaosocial?: string;
  nome_fantasia?: string;
  nome?: string;
  cpf_cnpj?: string;
  rg?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  data_nascimento?: string;
  data_nascmento?: string; // (sic) typo presente no docs oficial
  email_principal?: string;
  email_secundario?: string;
  telefone_primario?: string;
  telefone_secundario?: string;
  telefone_terciario?: string;
  status?: string;
  status_txt?: string;
  observacoes?: string;
  data_cadastro?: string;
  endereco_cadastral?: HubsoftEndereco;
  endereco_cobranca?: HubsoftEndereco;
  endereco_fiscal?: HubsoftEndereco;
  endereco_instalacao?: HubsoftEndereco;
  servicos?: HubsoftServico[];
  pacotes?: unknown[];
}

// -----------------------------------------------------------------------------
// Financeiro — GET /api/v1/integracao/cliente/financeiro
// Faturas (boletos) em aberto/liquidadas de um cliente.
// -----------------------------------------------------------------------------
export interface HubsoftFatura {
  id_fatura?: number | string;
  id_cliente_servico?: number | string;
  codigo_cliente?: number | string;
  valor?: string | number;
  valor_pago?: string | number;
  data_vencimento?: string;
  data_pagamento?: string;
  data_emissao?: string;
  status?: string; // "Em Aberto" | "Pago" | "Vencido" | ...
  status_fatura?: string;
  status_prefixo?: string;
  // Boleto / Pix já gerados no Hubsoft (p/ reimpressão, sem nova cobrança).
  linha_digitavel?: string;
  codigo_barras?: string;
  nosso_numero?: string;
  pix_copia_cola?: string;
  link?: string; // PDF do boleto
  descricao?: string;
}
