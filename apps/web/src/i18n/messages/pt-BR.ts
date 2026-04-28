/**
 * Dicionário pt-BR — formato compatível com next-intl (chaves aninhadas,
 * ICU MessageFormat).
 *
 * Convenções de namespace:
 *   common       — botões, ações, status genéricos
 *   nav          — itens da sidebar/topbar
 *   customers    — telas de cliente (lista, formulário, detalhe)
 *   contracts    — telas de contrato
 *   finance      — aba financeira do cliente
 *   deals        — pipeline / vendas
 *   settings     — parametrizações da operação
 *   validation   — mensagens de erro de campo
 *
 * Quando um string aparece em vários lugares, prefira movê-lo pra `common`.
 */
const messages = {
  common: {
    appName: 'NetX',
    save: 'Salvar',
    cancel: 'Cancelar',
    delete: 'Excluir',
    edit: 'Editar',
    create: 'Criar',
    back: 'Voltar',
    skip: 'Pular',
    confirm: 'Confirmar',
    close: 'Fechar',
    loading: 'Carregando…',
    error: 'Erro',
    success: 'Sucesso',
    yes: 'Sim',
    no: 'Não',
    optional: 'opcional',
    required: 'obrigatório',
    search: 'Buscar',
    filter: 'Filtrar',
    actions: 'Ações',
    status: 'Status',
    open: 'Abrir',
    download: 'Baixar',
    print: 'Imprimir',
    selectFolder: 'Selecione…',
    notFound: 'Não encontrado',
    pageNotFound: 'Página não encontrada',
  },
  nav: {
    dashboard: 'Dashboard',
    sales: 'Vendas',
    customers: 'Clientes',
    contracts: 'Contratos',
    tags: 'Tags',
    settings: 'Configurações',
    users: 'Usuários',
    logout: 'Sair',
    language: 'Idioma',
    tenantDefault: 'Padrão da operação',
  },
  customers: {
    title: 'Clientes',
    new: 'Novo cliente',
    breadcrumbHere: 'Aqui',
    type: { individual: 'Pessoa Física', company: 'Pessoa Jurídica' },
    tabs: {
      data: 'Dados',
      addresses: 'Endereços',
      contacts: 'Contatos',
      contracts: 'Contratos',
      finance: 'Financeiro',
      tags: 'Tags',
      consents: 'Consentimentos',
      notes: 'Anotações',
    },
    fields: {
      firstName: 'Nome',
      lastName: 'Sobrenome',
      birthDate: 'Data de nascimento',
      gender: 'Gênero',
      motherName: 'Nome da mãe',
      companyName: 'Razão social',
      tradeName: 'Nome fantasia',
      foundedAt: 'Fundação',
      taxIdType: 'Tipo de documento',
      taxIdCountry: 'País',
      taxIdValue: 'Número',
      primaryEmail: 'Email',
      primaryPhone: 'Telefone',
    },
  },
  contracts: {
    title: 'Contratos',
    new: 'Novo contrato',
    fields: {
      pppoeUsername: 'Usuário PPPoE',
      pppoePassword: 'Senha PPPoE',
      installationAddress: 'Endereço de instalação',
      installationMapsUrl: 'Link de localização (Google Maps)',
      monthlyValue: 'Mensalidade',
      bandwidthMbps: 'Velocidade (Mbps)',
      dueDay: 'Dia de vencimento',
      code: 'Código do contrato',
      firstDueDate: '1ª fatura vence em',
      notes: 'Observações',
    },
    helps: {
      mapsUrl: 'Cole o link compartilhável do Google Maps. Útil pro técnico abrir no celular.',
      pppoeRule: 'Use apenas letras, números, "." "_" "-"',
      dueDayRange: '1 a 28',
      firstDueDateOptional: 'Se vazio, usa o próximo dia de vencimento.',
    },
    status: { active: 'Ativo', suspended: 'Suspenso', cancelled: 'Cancelado' },
  },
  finance: {
    summary: {
      open: 'Em aberto',
      overdue: 'Em atraso',
      paidTotal: 'Total recebido',
    },
    invoice: {
      status: {
        OPEN: 'Em aberto',
        PAID: 'Paga',
        OVERDUE: 'Em atraso',
        CANCELLED: 'Cancelada',
      },
      payConfirmTitle: 'Dar baixa na fatura?',
      payAction: 'Dar baixa',
      downloadAction: 'Baixar',
    },
  },
  deals: {
    title: 'Vendas',
    subtitle: 'Pipeline de oportunidades — arraste cards entre colunas para mover de estágio.',
    new: 'Novo deal',
    convert: 'Converter em cliente',
    convertWithCustomer: 'Gerar contrato e marcar como ganho',
    markLost: 'Marcar como perdido',
    reopen: 'Reabrir',
  },
  settings: {
    title: 'Configurações',
    tenant: {
      title: 'Operação',
      country: 'País da operação',
      locale: 'Idioma padrão',
      currency: 'Moeda',
      timezone: 'Fuso horário',
      applyDefaults: 'Aplicar padrões do país (idioma, moeda, fuso)',
      legalNote:
        'Cada operação NetX é vinculada a um país e segue a regulação local. Você pode trocar o país, mas a sincronização fiscal e financeira pode exigir migração de dados.',
    },
  },
  validation: {
    required: 'Campo obrigatório',
    invalidEmail: 'Email inválido',
    invalidUrl: 'URL inválida',
    invalidDocument: 'Documento inválido',
    minLength: 'Mínimo {n} caracteres',
    maxLength: 'Máximo {n} caracteres',
  },
};

export default messages;
export type Messages = typeof messages;
