/**
 * Povoamento de dados fictícios para testes/demo.
 *
 * Gera 100 clientes com perfil paraguaio (CI/RUC, +595, ₲), cada um com:
 *   - 1–2 contratos PPPoE
 *   - Endereço(s) e contatos
 *   - 6–12 faturas espalhadas nos últimos meses (mix PAID/OPEN/OVERDUE)
 *   - Cobranças avulsas ocasionais (taxa de instalação, multa)
 *   - CashMovements automáticos pra cada fatura paga
 *
 * Modo aditivo: NÃO apaga dados existentes. Roda quantas vezes quiser; cada
 * execução adiciona +100 (com sufixos únicos pra não bater nos uniques).
 *
 * Uso:
 *   npm run db:seed:fake
 */
import {
  CashMovementSource,
  CashMovementType,
  CashRegisterRole,
  CashRegisterType,
  ContactType,
  ContractStatus,
  CustomerStatus,
  CustomerType,
  InvoiceStatus,
  PaymentMethod,
  PrismaClient,
  TaxIdType,
} from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Pool de dados realistas (Paraguai)
// ─────────────────────────────────────────────────────────────────────────────
const FIRST_NAMES_M = [
  'Carlos', 'Juan', 'Diego', 'Luis', 'Pedro', 'Miguel', 'Rodrigo', 'Andrés',
  'José', 'Hugo', 'Fernando', 'Ramón', 'Óscar', 'Gustavo', 'Roberto', 'Pablo',
  'Mauricio', 'Julio', 'Sergio', 'Marco', 'Adrián', 'Iván', 'Cristian',
  'Fabián', 'Néstor', 'Aldo', 'Hernán', 'Ricardo', 'Daniel', 'Eduardo',
];
const FIRST_NAMES_F = [
  'María', 'Lucía', 'Ana', 'Sofía', 'Camila', 'Valeria', 'Carolina', 'Patricia',
  'Andrea', 'Laura', 'Daniela', 'Gabriela', 'Mónica', 'Roxana', 'Adriana',
  'Beatriz', 'Cecilia', 'Diana', 'Florencia', 'Isabel', 'Marta', 'Rocío',
  'Silvia', 'Verónica', 'Alejandra', 'Romina', 'Natalia', 'Mariela',
];
const LAST_NAMES = [
  'González', 'Rodríguez', 'Benítez', 'Martínez', 'López', 'Fernández',
  'Sosa', 'Acosta', 'Rojas', 'Cabrera', 'Ortiz', 'Aquino', 'Villalba',
  'Cáceres', 'Ramírez', 'Vera', 'Romero', 'Duarte', 'Ayala', 'Ríos',
  'Ovelar', 'Galeano', 'Espínola', 'Insfrán', 'Mereles', 'Riveros',
  'Núñez', 'Alvarenga', 'Cardozo', 'Báez', 'Recalde', 'Centurión',
];
// PJ — razão social. Mistura de tipos comuns no Paraguai.
const COMPANY_PREFIXES = [
  'Constructora', 'Inmobiliaria', 'Comercial', 'Distribuidora', 'Importadora',
  'Servicios', 'Industrias', 'Agropecuaria', 'Tecnología', 'Soluciones',
];
const COMPANY_NAMES = [
  'del Sur', 'del Este', 'Asunción', 'Paraguay', 'Tres Fronteras', 'Guaraní',
  'San Roque', 'Trinidad', 'Itapúa', 'Misiones', 'Mariscal', 'Andresito',
  'Capiatá', 'Lambaré', 'Encarnación', 'Caaguazú', 'Yvy Mará', 'Real',
];
const COMPANY_SUFFIXES = ['S.A.', 'S.R.L.', 'EIRL', 'Cía. Ltda.'];

// Cidades por departamento. Peso = quanto provável aparece.
const CITIES: { city: string; state: string; weight: number }[] = [
  { city: 'Asunción', state: 'Distrito Capital', weight: 25 },
  { city: 'Lambaré', state: 'Central', weight: 8 },
  { city: 'Fernando de la Mora', state: 'Central', weight: 8 },
  { city: 'San Lorenzo', state: 'Central', weight: 10 },
  { city: 'Luque', state: 'Central', weight: 7 },
  { city: 'Capiatá', state: 'Central', weight: 6 },
  { city: 'Mariano Roque Alonso', state: 'Central', weight: 4 },
  { city: 'Ñemby', state: 'Central', weight: 3 },
  { city: 'Encarnación', state: 'Itapúa', weight: 8 },
  { city: 'Ciudad del Este', state: 'Alto Paraná', weight: 9 },
  { city: 'Pedro Juan Caballero', state: 'Amambay', weight: 3 },
  { city: 'Coronel Oviedo', state: 'Caaguazú', weight: 3 },
  { city: 'Villarrica', state: 'Guairá', weight: 3 },
  { city: 'Concepción', state: 'Concepción', weight: 3 },
];
// Bairros típicos de Asunción / áreas.
const DISTRICTS = [
  'Centro', 'Mburucuyá', 'Carmelitas', 'Trinidad', 'Villa Morra', 'Sajonia',
  'Las Mercedes', 'Recoleta', 'Mcal. López', 'Ñu Guazú', 'San Pablo',
  'Loma Pytã', 'Ytororó', 'Cerro Corá', 'Vista Alegre',
];
const STREETS = [
  'Avda. Mcal. López', 'Avda. España', 'Avda. Eusebio Ayala', 'Avda. Brasilia',
  'Avda. Boggiani', 'Avda. Aviadores del Chaco', 'Avda. San Martín',
  'Calle Palma', 'Calle Estrella', 'Calle Cerro Corá', 'Calle 25 de Mayo',
  'Calle Mcal. Estigarribia', 'Calle Iturbe', 'Calle Independencia Nacional',
];
// Planos comerciais típicos. Velocidade × valor.
const PLANS: { mbps: number; monthlyG: number }[] = [
  { mbps: 50, monthlyG: 150_000 },
  { mbps: 100, monthlyG: 220_000 },
  { mbps: 200, monthlyG: 320_000 },
  { mbps: 300, monthlyG: 420_000 },
  { mbps: 500, monthlyG: 580_000 },
  { mbps: 800, monthlyG: 750_000 },
  { mbps: 1_000, monthlyG: 980_000 },
];

const PAYMENT_METHODS: PaymentMethod[] = [
  'CASH', 'PIX', 'CARD', 'BANK_TRANSFER', 'OTHER',
];
// Distribuição realista (PIX é raro no Paraguai; SPI/transferência domina;
// cash ainda é forte). Usamos os mesmos enums por enquanto.
const PAYMENT_WEIGHTS: Record<PaymentMethod, number> = {
  CASH: 35,
  BANK_TRANSFER: 30,
  CARD: 20,
  PIX: 10,
  OTHER: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function pickPaymentMethod(): PaymentMethod {
  const entries = Object.entries(PAYMENT_WEIGHTS) as [PaymentMethod, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [m, w] of entries) {
    r -= w;
    if (r <= 0) return m;
  }
  return 'CASH';
}

function paraguayanCI(): string {
  // 7 dígitos. Não reproduz o algoritmo oficial — só formato.
  return String(randInt(1_000_000, 9_999_999));
}

function paraguayanRUC(): string {
  // CI + dígito verificador (sem cálculo real, gerado pseudo).
  return `${paraguayanCI()}-${randInt(1, 9)}`;
}

function paraguayanMobile(): string {
  // +595 9XX XXX XXX
  const op = rand(['981', '982', '983', '984', '985', '991', '992', '993', '994']);
  const part1 = String(randInt(100, 999));
  const part2 = String(randInt(100, 999));
  return `+595 ${op} ${part1} ${part2}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

function todayPlus(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function setDayOfMonth(d: Date, day: number): Date {
  const out = new Date(d);
  out.setDate(day);
  return out;
}

// Slugify simples pra construir email/PPPoE: remove acentos, lowercase.
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🇵🇾  Povoamento de dados fictícios — perfil Paraguai\n');

  const tenant = await prisma.tenant.findFirst({ where: { slug: 'default' } });
  if (!tenant) throw new Error('Tenant "default" não existe. Rode db:seed primeiro.');

  // Conta clientes existentes pra escolher offset de codes/PPPoE únicos.
  const existingCount = await prisma.customer.count({
    where: { tenantId: tenant.id },
  });
  const codeOffset = existingCount;
  console.log(
    `  → tenant ${tenant.slug} (${tenant.id})\n` +
      `  → já existem ${existingCount} clientes; codes começam em ${codeOffset + 1}\n`,
  );

  // Garante uma caixa default pra registrar pagamentos.
  let cashRegister = await prisma.cashRegister.findFirst({
    where: { tenantId: tenant.id, isActive: true },
  });
  if (!cashRegister) {
    console.log('  → criando caixa "Caja Principal" (default)');
    cashRegister = await prisma.cashRegister.create({
      data: {
        tenantId: tenant.id,
        name: 'Caja Principal',
        type: CashRegisterType.CASH,
        currency: tenant.currency ?? 'PYG',
        color: '#2563eb',
      },
    });
  }
  // Liga o admin do tenant a esse caixa pra ele aparecer na UI.
  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) {
    await prisma.cashRegisterMembership.upsert({
      where: {
        cashRegisterId_userId: {
          cashRegisterId: cashRegister.id,
          userId: admin.id,
        },
      },
      update: {},
      create: {
        cashRegisterId: cashRegister.id,
        userId: admin.id,
        role: CashRegisterRole.OPERATOR,
      },
    });
  }

  const TARGET = 100;
  let customersCreated = 0;
  let contractsCreated = 0;
  let invoicesCreated = 0;
  let chargesCreated = 0;
  let movementsCreated = 0;

  for (let i = 0; i < TARGET; i++) {
    const seq = codeOffset + i + 1;
    // 70% PF, 30% PJ
    const isCompany = Math.random() < 0.3;
    const cityInfo = pickWeighted(CITIES);

    let displayName: string;
    let firstName: string | null = null;
    let lastName: string | null = null;
    let companyName: string | null = null;
    let tradeName: string | null = null;
    let taxId: string;
    let taxIdType: TaxIdType;
    let primaryEmail: string;

    if (isCompany) {
      const prefix = rand(COMPANY_PREFIXES);
      const middle = rand(COMPANY_NAMES);
      const suffix = rand(COMPANY_SUFFIXES);
      companyName = `${prefix} ${middle} ${suffix}`;
      tradeName = `${prefix} ${middle}`;
      displayName = companyName;
      taxId = paraguayanRUC();
      taxIdType = TaxIdType.RUC;
      primaryEmail = `contacto+${seq}@${slugify(middle)}.com.py`;
    } else {
      const isFemale = Math.random() < 0.5;
      firstName = rand(isFemale ? FIRST_NAMES_F : FIRST_NAMES_M);
      lastName = `${rand(LAST_NAMES)} ${rand(LAST_NAMES)}`;
      displayName = `${firstName} ${lastName}`;
      taxId = paraguayanCI();
      taxIdType = TaxIdType.CI;
      primaryEmail = `${slugify(firstName)}.${slugify(lastName).slice(0, 12)}+${seq}@gmail.com`;
    }

    const primaryPhone = paraguayanMobile();
    // Distribuição de status: 78% ACTIVE, 6% LEAD, 6% PROSPECT, 5% SUSPENDED, 5% CHURNED
    const statusRoll = Math.random();
    const status: CustomerStatus =
      statusRoll < 0.78 ? CustomerStatus.ACTIVE
      : statusRoll < 0.84 ? CustomerStatus.LEAD
      : statusRoll < 0.90 ? CustomerStatus.PROSPECT
      : statusRoll < 0.95 ? CustomerStatus.SUSPENDED
      : CustomerStatus.CHURNED;

    const code = `CLI-${pad(seq, 6)}`;

    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        code,
        type: isCompany ? CustomerType.COMPANY : CustomerType.INDIVIDUAL,
        status,
        firstName,
        lastName,
        companyName,
        tradeName,
        displayName,
        taxId,
        taxIdType,
        taxIdCountry: 'PY',
        primaryEmail,
        primaryPhone,
        preferredLanguage: 'es-PY',
        timezone: 'America/Asuncion',
        // Endereço de instalação
        addresses: {
          create: [
            {
              tenantId: tenant.id,
              type: 'SERVICE',
              isPrimary: true,
              country: 'PY',
              state: cityInfo.state,
              city: cityInfo.city,
              district: rand(DISTRICTS),
              street: rand(STREETS),
              number: String(randInt(100, 9999)),
            },
          ],
        },
        // Contatos extras
        contacts: {
          create: [
            {
              tenantId: tenant.id,
              type: ContactType.WHATSAPP,
              value: primaryPhone,
              isPrimary: true,
              optIn: Math.random() < 0.7,
            },
            {
              tenantId: tenant.id,
              type: ContactType.EMAIL,
              value: primaryEmail,
              isPrimary: false,
              optIn: Math.random() < 0.5,
            },
          ],
        },
      },
    });
    customersCreated++;

    // Só cria contratos pra clientes que tipicamente teriam serviço.
    const shouldHaveContract =
      status === CustomerStatus.ACTIVE ||
      status === CustomerStatus.SUSPENDED ||
      status === CustomerStatus.CHURNED;
    if (!shouldHaveContract) continue;

    // 1 contrato em 80% dos casos; 2 em 20% (residencial + escritório).
    const numContracts = Math.random() < 0.2 ? 2 : 1;
    for (let c = 0; c < numContracts; c++) {
      const plan = pickWeighted(
        PLANS.map((p, idx) => ({
          ...p,
          // Planos baixos mais comuns; altos raros.
          weight: idx < 3 ? 30 : idx < 5 ? 15 : 5,
        })),
      );
      const dueDay = randInt(1, 28);
      const contractStatus: ContractStatus =
        status === CustomerStatus.SUSPENDED ? ContractStatus.SUSPENDED
        : status === CustomerStatus.CHURNED ? ContractStatus.CANCELLED
        : ContractStatus.ACTIVE;

      const baseCustomerSlug = isCompany
        ? slugify(companyName ?? '').slice(0, 16)
        : `${slugify(firstName ?? '')}.${slugify(lastName ?? '').split(' ')[0]}`.slice(0, 20);
      const pppoeUsername = `${baseCustomerSlug}${pad(seq, 4)}${c > 0 ? `b` : ''}`;

      // Idade do contrato — alguns clientes antigos, outros recentes.
      const ageMonths = randInt(1, 18);
      const activatedAt = daysAgo(ageMonths * 30 + randInt(0, 20));

      const contractCode = `CTR-${pad(seq, 6)}${c > 0 ? '-2' : ''}`;
      const contract = await prisma.contract.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          code: contractCode,
          pppoeUsername,
          pppoePassword: Math.random().toString(36).slice(2, 12),
          installationAddress: `${rand(STREETS)} ${randInt(100, 9999)}, ${rand(DISTRICTS)}, ${cityInfo.city}`,
          monthlyValue: plan.monthlyG,
          bandwidthMbps: plan.mbps,
          dueDay,
          status: contractStatus,
          activatedAt,
          suspendedAt:
            contractStatus === ContractStatus.SUSPENDED
              ? daysAgo(randInt(1, 45))
              : null,
          cancelledAt:
            contractStatus === ContractStatus.CANCELLED
              ? daysAgo(randInt(15, 90))
              : null,
          notes:
            Math.random() < 0.25
              ? rand([
                  'Cliente VIP — atendimento prioritário.',
                  'Roteador alugado.',
                  'Pediu sinal estendido com mesh.',
                  'Possui 2ª residência — ver com comercial.',
                  'Histórico de inadimplência leve.',
                ])
              : null,
        },
      });
      contractsCreated++;

      // ─── Faturas ─────────────────────────────────────────────────────────
      const monthsToBill = Math.min(ageMonths, 12);
      for (let m = 0; m < monthsToBill; m++) {
        // Mês de competência: ageMonths..1 (decrescente, do mais antigo pro mais novo)
        const monthOffset = ageMonths - m;
        const issueDate = daysAgo(monthOffset * 30);
        const dueDate = setDayOfMonth(issueDate, dueDay);
        const dueIsPast = dueDate < new Date();

        // Distribuição: 80% das faturas vencidas estão pagas, 15% open
        // (em atraso real) e 5% canceladas. As do mês corrente ficam OPEN.
        let inv: {
          status: InvoiceStatus;
          paidAt: Date | null;
          paidAmount: number | null;
          discountAmount: number | null;
          paidVia: PaymentMethod | null;
          cashRegisterId: string | null;
        } = {
          status: InvoiceStatus.OPEN,
          paidAt: null,
          paidAmount: null,
          discountAmount: null,
          paidVia: null,
          cashRegisterId: null,
        };

        if (dueIsPast) {
          const roll = Math.random();
          if (roll < 0.80) {
            // PAID — entre 5 dias antes do vencimento e 7 dias depois.
            const offset = randInt(-5, 7);
            const paidDate = new Date(dueDate);
            paidDate.setDate(paidDate.getDate() + offset);
            const discount = Math.random() < 0.10 ? Math.round(plan.monthlyG * 0.05) : 0;
            inv = {
              status: InvoiceStatus.PAID,
              paidAt: paidDate,
              paidAmount: plan.monthlyG - discount,
              discountAmount: discount || null,
              paidVia: pickPaymentMethod(),
              cashRegisterId: cashRegister.id,
            };
          } else if (roll < 0.95) {
            inv.status = InvoiceStatus.OVERDUE;
          } else {
            inv.status = InvoiceStatus.CANCELLED;
          }
        }

        const monthLabel = `${pad(dueDate.getMonth() + 1, 2)}/${dueDate.getFullYear()}`;
        const invoice = await prisma.contractInvoice.create({
          data: {
            tenantId: tenant.id,
            contractId: contract.id,
            amount: plan.monthlyG,
            dueDate,
            issuedAt: issueDate,
            status: inv.status,
            paidAt: inv.paidAt,
            paidAmount: inv.paidAmount,
            discountAmount: inv.discountAmount,
            paidVia: inv.paidVia,
            cashRegisterId: inv.cashRegisterId,
            reference: `Mensualidad ${monthLabel}`,
          },
        });
        invoicesCreated++;

        // CashMovement gerado pelo pagamento (replica o hook do service real)
        if (inv.status === InvoiceStatus.PAID && inv.paidAt && inv.paidAmount) {
          await prisma.cashMovement.create({
            data: {
              tenantId: tenant.id,
              cashRegisterId: cashRegister.id,
              type: CashMovementType.INCOME,
              source: CashMovementSource.INVOICE,
              sourceId: invoice.id,
              amount: inv.paidAmount,
              description: `Pago ${invoice.reference} — ${displayName}`,
              occurredAt: inv.paidAt,
            },
          });
          movementsCreated++;
        }
      }

      // ─── Cobrança avulsa ocasional (taxa de instalação no início) ──────
      if (c === 0 && Math.random() < 0.4) {
        const installCharge = randInt(80_000, 250_000);
        const installPaid = Math.random() < 0.85;
        const issuedAt = activatedAt;
        const chargeDueDate = new Date(activatedAt);
        chargeDueDate.setDate(chargeDueDate.getDate() + 10);
        const chargeCode = `CB-${pad(seq, 6)}`;

        const paid = installPaid
          ? {
              status: 'PAID' as const,
              paidAt: new Date(chargeDueDate.getTime() - randInt(0, 5) * 86400000),
              paidAmount: installCharge,
              paidVia: pickPaymentMethod(),
              cashRegisterId: cashRegister.id,
            }
          : { status: 'OPEN' as const };

        const charge = await prisma.oneTimeCharge.create({
          data: {
            tenantId: tenant.id,
            customerId: customer.id,
            contractId: contract.id,
            code: chargeCode,
            description: 'Tasa de instalación / activación',
            amount: installCharge,
            dueDate: chargeDueDate,
            issuedAt,
            ...paid,
          },
        });
        chargesCreated++;

        if (paid.status === 'PAID') {
          await prisma.cashMovement.create({
            data: {
              tenantId: tenant.id,
              cashRegisterId: cashRegister.id,
              type: CashMovementType.INCOME,
              source: CashMovementSource.CHARGE,
              sourceId: charge.id,
              amount: paid.paidAmount,
              description: `Cobro: ${charge.description} — ${displayName}`,
              occurredAt: paid.paidAt,
            },
          });
          movementsCreated++;
        }
      }
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  · ${i + 1}/${TARGET} clientes criados`);
    }
  }

  console.log('\n✅ Concluído');
  console.log(`   clientes:    ${customersCreated}`);
  console.log(`   contratos:   ${contractsCreated}`);
  console.log(`   faturas:     ${invoicesCreated}`);
  console.log(`   cobranças:   ${chargesCreated}`);
  console.log(`   movimentos:  ${movementsCreated}`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed-fake:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
