/**
 * Povoamento de dados fictícios para testes/demo (escala alta).
 *
 * Gera N clientes paraguaios (CI/RUC, +595, ₲) com:
 *   - Endereço(s) e contatos
 *   - 1 contrato (~98% IPoE com circuit-id Huawei + MAC, ~2% PPPoE legado)
 *   - Faturas mensais espalhadas no histórico (PAID/OPEN/OVERDUE)
 *   - Cobranças avulsas ocasionais (taxa de instalação)
 *   - CashMovements automáticos para cada pagamento
 *   - 0–3 ordens de serviço (instalação, mudança de plano, manutenção)
 *
 * Distribuição temporal: operação desde 2024-11 (~18 meses retroativos).
 *
 * Performance: usa createMany em batches (faturas, cobranças, movimentos,
 * O.S) — ~3-5 min pra 8000 clientes em VPS modesto.
 *
 * Modo aditivo: NÃO apaga dados existentes.
 *
 * Uso:  npm run db:seed:fake [N]   (default 8000)
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
  Prisma,
  PrismaClient,
  ServiceOrderStatus,
  TaxIdType,
} from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Pool de dados realistas (Paraguai)
// ─────────────────────────────────────────────────────────────────────────────
const FIRST_NAMES_M = [
  'Carlos', 'Juan', 'Diego', 'Luis', 'Pedro', 'Miguel', 'Rodrigo', 'Andrés',
  'José', 'Hugo', 'Fernando', 'Ramón', 'Óscar', 'Gustavo', 'Roberto', 'Pablo',
  'Mauricio', 'Julio', 'Sergio', 'Marco', 'Adrián', 'Iván', 'Cristian',
  'Fabián', 'Néstor', 'Aldo', 'Hernán', 'Ricardo', 'Daniel', 'Eduardo',
  'Víctor', 'Alejandro', 'Felipe', 'Marcelo', 'Lucas', 'Tomás', 'Matías',
];
const FIRST_NAMES_F = [
  'María', 'Lucía', 'Ana', 'Sofía', 'Camila', 'Valeria', 'Carolina', 'Patricia',
  'Andrea', 'Laura', 'Daniela', 'Gabriela', 'Mónica', 'Roxana', 'Adriana',
  'Beatriz', 'Cecilia', 'Diana', 'Florencia', 'Isabel', 'Marta', 'Rocío',
  'Silvia', 'Verónica', 'Alejandra', 'Romina', 'Natalia', 'Mariela',
  'Liliana', 'Sandra', 'Estela', 'Karina', 'Paola', 'Vanessa', 'Mercedes',
];
const LAST_NAMES = [
  'González', 'Rodríguez', 'Benítez', 'Martínez', 'López', 'Fernández',
  'Sosa', 'Acosta', 'Rojas', 'Cabrera', 'Ortiz', 'Aquino', 'Villalba',
  'Cáceres', 'Ramírez', 'Vera', 'Romero', 'Duarte', 'Ayala', 'Ríos',
  'Ovelar', 'Galeano', 'Espínola', 'Insfrán', 'Mereles', 'Riveros',
  'Núñez', 'Alvarenga', 'Cardozo', 'Báez', 'Recalde', 'Centurión',
  'Servín', 'Britos', 'Mendoza', 'Salinas', 'Torres', 'Frutos', 'Maciel',
];
const COMPANY_PREFIXES = [
  'Constructora', 'Inmobiliaria', 'Comercial', 'Distribuidora', 'Importadora',
  'Servicios', 'Industrias', 'Agropecuaria', 'Tecnología', 'Soluciones',
  'Corporación', 'Grupo', 'Mayorista',
];
const COMPANY_NAMES = [
  'del Sur', 'del Este', 'Asunción', 'Paraguay', 'Tres Fronteras', 'Guaraní',
  'San Roque', 'Trinidad', 'Itapúa', 'Misiones', 'Mariscal', 'Andresito',
  'Capiatá', 'Lambaré', 'Encarnación', 'Caaguazú', 'Yvy Mará', 'Real',
  'Central', 'Río Paraná', 'Yguazú',
];
const COMPANY_SUFFIXES = ['S.A.', 'S.R.L.', 'EIRL', 'Cía. Ltda.'];

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
const PLANS: { mbps: number; monthlyG: number }[] = [
  { mbps: 50, monthlyG: 150_000 },
  { mbps: 100, monthlyG: 220_000 },
  { mbps: 200, monthlyG: 320_000 },
  { mbps: 300, monthlyG: 420_000 },
  { mbps: 500, monthlyG: 580_000 },
  { mbps: 800, monthlyG: 750_000 },
  { mbps: 1_000, monthlyG: 980_000 },
];
const PAYMENT_WEIGHTS: Record<PaymentMethod, number> = {
  CASH: 35,
  BANK_TRANSFER: 30,
  CARD: 20,
  PIX: 10,
  OTHER: 5,
};
const SO_REASONS = [
  { name: 'Instalación', description: 'Instalación inicial del servicio.', order: 1 },
  { name: 'Mudanza', description: 'Traslado del servicio a nueva dirección.', order: 2 },
  { name: 'Cambio de plan', description: 'Upgrade/downgrade de velocidad.', order: 3 },
  { name: 'Falla técnica', description: 'Sin servicio o lentitud reportada.', order: 4 },
  { name: 'Mantenimiento preventivo', description: 'Revisión programada.', order: 5 },
  { name: 'Retiro de equipo', description: 'Cancelación o cambio de equipo.', order: 6 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const rand = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.weight; if (r <= 0) return item; }
  return items[items.length - 1];
}
function pickPaymentMethod(): PaymentMethod {
  const entries = Object.entries(PAYMENT_WEIGHTS) as [PaymentMethod, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [m, w] of entries) { r -= w; if (r <= 0) return m; }
  return 'CASH';
}
const pad = (n: number, w: number) => String(n).padStart(w, '0');
// CI/RUC determinísticos via `seq` — garante unicidade até 9.999.999 clientes.
// Random com pool de 8M tem colisão real em 8000 amostras (paradoxo do
// aniversário). Determinístico via offset elimina o problema.
//
// Formato CI paraguaio: 7 dígitos, sem zero à esquerda → começa em 1_000_000.
const paraguayanCIFromSeq = (seq: number) => String(1_000_000 + seq);
const paraguayanRUCFromSeq = (seq: number) =>
  `${paraguayanCIFromSeq(seq)}-${(seq % 9) + 1}`;
// Versão random ainda exposta pra usos esporádicos (não conflitam com seq).
const paraguayanCI = () => String(randInt(1_000_000, 9_999_999));
const paraguayanRUC = () => `${paraguayanCI()}-${randInt(1, 9)}`;
const paraguayanMobile = () => {
  const op = rand(['981', '982', '983', '984', '985', '991', '992', '993', '994']);
  return `+595 ${op} ${randInt(100, 999)} ${randInt(100, 999)}`;
};
const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const daysAgo = (d: number) => {
  const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - d); return x;
};
const setDayOfMonth = (d: Date, day: number) => {
  const out = new Date(d); out.setDate(day); return out;
};

// MAC único — embute (seq, c) no espaço locally-administered (02:CE:...).
// (seq * 8 + c) cabe em 32 bits até ~536M clientes; mais que suficiente.
function macFromSeq(seq: number, c: number): string {
  const n = (seq * 8 + c) >>> 0;
  const h = (b: number) => b.toString(16).padStart(2, '0');
  return `02:CE:${h((n >> 24) & 0xff)}:${h((n >> 16) & 0xff)}:${h((n >> 8) & 0xff)}:${h(n & 0xff)}`.toUpperCase();
}

// Circuit-id estilo Huawei. seq é embutido literalmente → unicidade
// trivial. Distribuímos OLTs e PON cards pra parecer realista.
function circuitIdFromSeq(seq: number, c: number): string {
  const olt = ((seq - 1) % 4) + 1;                 // OLT 1..4
  const slot = (Math.floor((seq - 1) / 1000) % 8) + 1; // 8 cards/OLT
  const pon = (Math.floor((seq - 1) / 100) % 16) + 1;  // 16 PONs/card
  return `OLT${olt}/${slot}/${pon}:${seq}.${c + 1}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  // CLI: `npm run db:seed:fake -- 8000`
  const argTarget = Number(process.argv[2]);
  const TARGET = Number.isFinite(argTarget) && argTarget > 0 ? argTarget : 8000;

  // Operação iniciou em 2024-11-01. Limita activatedAt mínimo nessa data.
  const OPERATION_START = new Date('2024-11-01T00:00:00Z');
  const MAX_AGE_DAYS = Math.floor((Date.now() - OPERATION_START.getTime()) / 86_400_000);

  console.log(`🇵🇾  Seed-fake — ${TARGET} clientes (98% IPoE / 2% PPPoE) desde ${OPERATION_START.toISOString().slice(0, 10)}\n`);
  const t0 = Date.now();

  // Resolução do tenant alvo (em ordem):
  //   1) Argumento CLI: --tenant-slug=foo  OU  segundo posicional
  //   2) Env DEFAULT_TENANT_SLUG (vem do .env do installer)
  //   3) Slug 'default' (fallback do db:seed canônico)
  //
  // Em prod single-tenant o item 2 é o que sempre vai usar — o `.env` aponta
  // pro slug real do ISP (ex: 'netx-dev', 'zux-paraguay-sa'), e os clientes
  // populam onde o operador efetivamente loga.
  const argTenantFlag = process.argv.find((a) => a.startsWith('--tenant-slug='));
  const argTenantPos = process.argv[3]; // após N
  const targetSlug =
    (argTenantFlag ? argTenantFlag.split('=')[1] : null) ??
    argTenantPos ??
    process.env.DEFAULT_TENANT_SLUG ??
    'default';

  const tenant = await prisma.tenant.findFirst({ where: { slug: targetSlug } });
  if (!tenant) {
    throw new Error(
      `Tenant slug='${targetSlug}' não existe. Tenants disponíveis: ` +
        (await prisma.tenant.findMany({ select: { slug: true } }))
          .map((t) => t.slug)
          .join(', '),
    );
  }
  console.log(`  → populando tenant '${tenant.slug}' (${tenant.name})\n`);

  const existingCustomers = await prisma.customer.count({ where: { tenantId: tenant.id } });
  const codeOffset = existingCustomers;
  console.log(`  → tenant ${tenant.slug} (${existingCustomers} clientes existentes)\n`);

  // Caixa default
  let cashRegister = await prisma.cashRegister.findFirst({
    where: { tenantId: tenant.id, isActive: true },
  });
  if (!cashRegister) {
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
  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) {
    await prisma.cashRegisterMembership.upsert({
      where: { cashRegisterId_userId: { cashRegisterId: cashRegister.id, userId: admin.id } },
      update: {},
      create: { cashRegisterId: cashRegister.id, userId: admin.id, role: CashRegisterRole.OPERATOR },
    });
  }

  // Service Order Reasons (cria os 6 padrão se não existirem)
  console.log('  → Garantindo motivos de O.S');
  const reasons: { id: string; name: string }[] = [];
  for (const r of SO_REASONS) {
    const existing = await prisma.serviceOrderReason.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: r.name } },
      update: {},
      create: { tenantId: tenant.id, ...r },
    });
    reasons.push({ id: existing.id, name: existing.name });
  }
  const reasonByName = (n: string) => reasons.find((r) => r.name === n)!;

  // Buffers de createMany — flush em batches.
  const INVOICE_BUFFER_SIZE = 1000;
  const invoiceBuffer: Prisma.ContractInvoiceCreateManyInput[] = [];
  const movementBuffer: Prisma.CashMovementCreateManyInput[] = [];
  const chargeBuffer: Prisma.OneTimeChargeCreateManyInput[] = [];
  const soBuffer: Prisma.ServiceOrderCreateManyInput[] = [];

  async function flush() {
    if (invoiceBuffer.length) {
      await prisma.contractInvoice.createMany({ data: invoiceBuffer, skipDuplicates: true });
      invoiceBuffer.length = 0;
    }
    if (chargeBuffer.length) {
      await prisma.oneTimeCharge.createMany({ data: chargeBuffer, skipDuplicates: true });
      chargeBuffer.length = 0;
    }
    if (movementBuffer.length) {
      await prisma.cashMovement.createMany({ data: movementBuffer, skipDuplicates: true });
      movementBuffer.length = 0;
    }
    if (soBuffer.length) {
      await prisma.serviceOrder.createMany({ data: soBuffer, skipDuplicates: true });
      soBuffer.length = 0;
    }
  }

  let customersCreated = 0;
  let contractsCreated = 0;
  let invoicesCreated = 0;
  let chargesCreated = 0;
  let movementsCreated = 0;
  let osCreated = 0;

  for (let i = 0; i < TARGET; i++) {
    const seq = codeOffset + i + 1;
    const isCompany = Math.random() < 0.25;
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
      taxId = paraguayanRUCFromSeq(seq);
      taxIdType = TaxIdType.RUC;
      primaryEmail = `contacto+${seq}@${slugify(middle)}.com.py`;
    } else {
      const isFemale = Math.random() < 0.5;
      firstName = rand(isFemale ? FIRST_NAMES_F : FIRST_NAMES_M);
      lastName = `${rand(LAST_NAMES)} ${rand(LAST_NAMES)}`;
      displayName = `${firstName} ${lastName}`;
      taxId = paraguayanCIFromSeq(seq);
      taxIdType = TaxIdType.CI;
      primaryEmail = `${slugify(firstName)}.${slugify(lastName).slice(0, 12)}+${seq}@gmail.com`;
    }

    const primaryPhone = paraguayanMobile();
    const statusRoll = Math.random();
    const status: CustomerStatus =
      statusRoll < 0.78 ? CustomerStatus.ACTIVE
      : statusRoll < 0.84 ? CustomerStatus.LEAD
      : statusRoll < 0.90 ? CustomerStatus.PROSPECT
      : statusRoll < 0.95 ? CustomerStatus.SUSPENDED
      : CustomerStatus.CHURNED;

    const code = `CLI-${pad(seq, 6)}`;

    // Customer + addresses + contacts em uma chamada.
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        code,
        type: isCompany ? CustomerType.COMPANY : CustomerType.INDIVIDUAL,
        status,
        firstName, lastName, companyName, tradeName, displayName,
        taxId, taxIdType, taxIdCountry: 'PY',
        primaryEmail, primaryPhone,
        preferredLanguage: 'es-PY',
        timezone: 'America/Asuncion',
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
      select: { id: true },
    });
    customersCreated++;

    const shouldHaveContract =
      status === CustomerStatus.ACTIVE ||
      status === CustomerStatus.SUSPENDED ||
      status === CustomerStatus.CHURNED;
    if (!shouldHaveContract) {
      if ((i + 1) % 500 === 0) {
        await flush();
        console.log(`  · ${i + 1}/${TARGET} clientes`);
      }
      continue;
    }

    // 1 contrato por cliente (95%); 5% têm 2 (matriz + filial).
    const numContracts = Math.random() < 0.05 ? 2 : 1;
    for (let c = 0; c < numContracts; c++) {
      const plan = pickWeighted(
        PLANS.map((p, idx) => ({ ...p, weight: idx < 3 ? 30 : idx < 5 ? 15 : 5 })),
      );
      const dueDay = randInt(1, 28);
      const contractStatus: ContractStatus =
        status === CustomerStatus.SUSPENDED ? ContractStatus.SUSPENDED
        : status === CustomerStatus.CHURNED ? ContractStatus.CANCELLED
        : ContractStatus.ACTIVE;

      // Idade do contrato — distribuição realista (mais clientes recentes que
      // antigos pra simular crescimento). Clampa em MAX_AGE_DAYS (operação
      // não pode ser antes de 2024-11-01).
      const ageDaysRaw = randInt(1, 540); // 1d a ~18 meses
      const ageDays = Math.min(ageDaysRaw, MAX_AGE_DAYS);
      const ageMonths = Math.max(1, Math.floor(ageDays / 30));
      const activatedAt = daysAgo(ageDays);
      const contractCode = `CTR-${pad(seq, 6)}${c > 0 ? '-2' : ''}`;

      // 98% IPoE / 2% PPPoE — distribuição realista de migração.
      // Os PPPoE são "legados" da operação antiga; novos contratos vão pra IPoE.
      const isPPPoE = Math.random() < 0.02;
      const authMethod = isPPPoE ? 'PPPOE' : 'IPOE';

      const circuitId = isPPPoE ? null : circuitIdFromSeq(seq, c);
      const macAddress = isPPPoE ? null : macFromSeq(seq, c);
      // PPPoE: gera username único por seq + sufixo da residência
      const pppoeUsername = isPPPoE ? `pppoe${pad(seq, 6)}${c > 0 ? '-2' : ''}` : null;
      const pppoePassword = isPPPoE
        ? Math.random().toString(36).slice(2, 12)
        : null;

      const contract = await prisma.contract.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          code: contractCode,
          authMethod,
          pppoeUsername,
          pppoePassword,
          circuitId,
          remoteId: isPPPoE ? null : `OLT${((seq - 1) % 4) + 1}`,
          macAddress,
          framedIpAddress: Math.random() < 0.15
            // 15% têm IP fixo na faixa 200.85.x.y (genérico)
            ? `200.85.${randInt(0, 255)}.${randInt(2, 254)}`
            : null,
          vlanId: !isPPPoE && Math.random() < 0.4 ? randInt(100, 4000) : null,
          installationAddress: `${rand(STREETS)} ${randInt(100, 9999)}, ${rand(DISTRICTS)}, ${cityInfo.city}`,
          monthlyValue: plan.monthlyG,
          bandwidthMbps: plan.mbps,
          dueDay,
          status: contractStatus,
          activatedAt,
          suspendedAt: contractStatus === ContractStatus.SUSPENDED ? daysAgo(randInt(1, 45)) : null,
          cancelledAt: contractStatus === ContractStatus.CANCELLED ? daysAgo(randInt(15, 90)) : null,
          notes: Math.random() < 0.2
            ? rand([
                'Cliente VIP — atención prioritaria.',
                'Router alquilado (Huawei HG8245H).',
                'Pidió señal extendida con mesh.',
                'Tiene 2da residencia — coordinar con comercial.',
                'Histórico de mora leve.',
                isPPPoE ? 'Cliente legado PPPoE — migrar pra IPoE quando agendar visita.' : 'Instalación con IPoE.',
              ])
            : null,
        },
        select: { id: true },
      });
      contractsCreated++;

      // ── Faturas (até 12 meses) ──
      const monthsToBill = Math.min(ageMonths, 12);
      for (let m = 0; m < monthsToBill; m++) {
        const monthOffset = ageMonths - m;
        const issueDate = daysAgo(monthOffset * 30);
        const dueDate = setDayOfMonth(issueDate, dueDay);
        const dueIsPast = dueDate < new Date();

        let invStatus: InvoiceStatus = InvoiceStatus.OPEN;
        let paidAt: Date | null = null;
        let paidAmount: number | null = null;
        let discount: number | null = null;
        let paidVia: PaymentMethod | null = null;
        let cashRegId: string | null = null;

        if (dueIsPast) {
          const roll = Math.random();
          if (roll < 0.80) {
            const offset = randInt(-5, 7);
            const pd = new Date(dueDate); pd.setDate(pd.getDate() + offset);
            paidAt = pd;
            const d = Math.random() < 0.10 ? Math.round(plan.monthlyG * 0.05) : 0;
            paidAmount = plan.monthlyG - d;
            discount = d || null;
            paidVia = pickPaymentMethod();
            cashRegId = cashRegister.id;
            invStatus = InvoiceStatus.PAID;
          } else if (roll < 0.95) {
            invStatus = InvoiceStatus.OVERDUE;
          } else {
            invStatus = InvoiceStatus.CANCELLED;
          }
        }

        const invoiceId = randomUUID();
        const monthLabel = `${pad(dueDate.getMonth() + 1, 2)}/${dueDate.getFullYear()}`;
        invoiceBuffer.push({
          id: invoiceId,
          tenantId: tenant.id,
          contractId: contract.id,
          amount: new Prisma.Decimal(plan.monthlyG),
          dueDate,
          issuedAt: issueDate,
          status: invStatus,
          paidAt,
          paidAmount: paidAmount !== null ? new Prisma.Decimal(paidAmount) : null,
          discountAmount: discount !== null ? new Prisma.Decimal(discount) : null,
          paidVia,
          cashRegisterId: cashRegId,
          reference: `Mensualidad ${monthLabel}`,
        });
        invoicesCreated++;

        if (invStatus === InvoiceStatus.PAID && paidAt && paidAmount !== null) {
          movementBuffer.push({
            tenantId: tenant.id,
            cashRegisterId: cashRegister.id,
            type: CashMovementType.INCOME,
            source: CashMovementSource.INVOICE,
            sourceId: invoiceId,
            amount: new Prisma.Decimal(paidAmount),
            description: `Pago Mensualidad ${monthLabel} — ${displayName}`,
            occurredAt: paidAt,
          });
          movementsCreated++;
        }
      }

      // ── Cobrança avulsa: taxa de instalação ──
      if (c === 0 && Math.random() < 0.4) {
        const installCharge = randInt(80_000, 250_000);
        const installPaid = Math.random() < 0.85;
        const issuedAt = activatedAt;
        const chargeDueDate = new Date(activatedAt);
        chargeDueDate.setDate(chargeDueDate.getDate() + 10);
        const chargeId = randomUUID();

        chargeBuffer.push({
          id: chargeId,
          tenantId: tenant.id,
          customerId: customer.id,
          contractId: contract.id,
          code: `CB-${pad(seq, 6)}`,
          description: 'Tasa de instalación / activación',
          amount: new Prisma.Decimal(installCharge),
          dueDate: chargeDueDate,
          issuedAt,
          status: installPaid ? 'PAID' : 'OPEN',
          paidAt: installPaid
            ? new Date(chargeDueDate.getTime() - randInt(0, 5) * 86400_000)
            : null,
          paidAmount: installPaid ? new Prisma.Decimal(installCharge) : null,
          paidVia: installPaid ? pickPaymentMethod() : null,
          cashRegisterId: installPaid ? cashRegister.id : null,
        });
        chargesCreated++;

        if (installPaid) {
          movementBuffer.push({
            tenantId: tenant.id,
            cashRegisterId: cashRegister.id,
            type: CashMovementType.INCOME,
            source: CashMovementSource.CHARGE,
            sourceId: chargeId,
            amount: new Prisma.Decimal(installCharge),
            description: `Cobro: tasa instalación — ${displayName}`,
            occurredAt: new Date(chargeDueDate.getTime() - randInt(0, 5) * 86400_000),
          });
          movementsCreated++;
        }
      }

      // ── Service Orders ──
      // Sempre uma O.S de Instalação na ativação. Outras conforme idade.
      if (c === 0) {
        soBuffer.push({
          tenantId: tenant.id,
          contractId: contract.id,
          reasonId: reasonByName('Instalación').id,
          code: `OS-${pad(seq, 6)}-1`,
          status: ServiceOrderStatus.COMPLETED,
          openedAt: activatedAt,
          scheduledAt: activatedAt,
          startedAt: activatedAt,
          completedAt: new Date(activatedAt.getTime() + randInt(2, 6) * 3600_000),
          openDescription: 'Instalación inicial del servicio FTTH.',
          closeDescription: `Equipo instalado y configurado. ONU ${rand(['HG8245H', 'HG8546M', 'EG8145V5'])}. Velocidad confirmada ${plan.mbps} Mbps.`,
          city: cityInfo.city,
          state: cityInfo.state,
          assignedToId: admin?.id ?? null,
        });
        osCreated++;
      }

      // 35% têm uma falha técnica ao longo da vida do contrato.
      // Distribui realisticamente entre os 5 status: 70% COMPLETED (já fechou),
      // 8% CANCELLED (cliente cancelou pedido), 6% OPEN (acabou de abrir),
      // 8% SCHEDULED (agendado pra hoje/amanhã), 8% IN_PROGRESS (técnico fora).
      if (ageMonths > 2 && Math.random() < 0.35) {
        const failureDate = daysAgo(randInt(15, ageMonths * 30 - 15));
        const roll = Math.random();
        let osStatus: ServiceOrderStatus;
        if (roll < 0.70) osStatus = ServiceOrderStatus.COMPLETED;
        else if (roll < 0.78) osStatus = ServiceOrderStatus.CANCELLED;
        else if (roll < 0.84) osStatus = ServiceOrderStatus.OPEN;
        else if (roll < 0.92) osStatus = ServiceOrderStatus.SCHEDULED;
        else osStatus = ServiceOrderStatus.IN_PROGRESS;

        const isClosed = osStatus === ServiceOrderStatus.COMPLETED
          || osStatus === ServiceOrderStatus.CANCELLED;
        const hasSchedule = osStatus !== ServiceOrderStatus.OPEN;
        const hasStarted = osStatus === ServiceOrderStatus.IN_PROGRESS
          || osStatus === ServiceOrderStatus.COMPLETED;
        const scheduledAt = hasSchedule
          ? new Date(failureDate.getTime() + randInt(1, 48) * 3600_000)
          : null;

        soBuffer.push({
          tenantId: tenant.id,
          contractId: contract.id,
          reasonId: reasonByName('Falla técnica').id,
          code: `OS-${pad(seq, 6)}-2`,
          status: osStatus,
          openedAt: failureDate,
          scheduledAt,
          startedAt: hasStarted && scheduledAt
            ? new Date(scheduledAt.getTime() + randInt(0, 4) * 3600_000)
            : null,
          completedAt: osStatus === ServiceOrderStatus.COMPLETED && scheduledAt
            ? new Date(scheduledAt.getTime() + randInt(2, 8) * 3600_000)
            : osStatus === ServiceOrderStatus.CANCELLED
              ? new Date(failureDate.getTime() + randInt(1, 24) * 3600_000)
              : null,
          openDescription: rand([
            'Cliente reportó caída intermitente desde ayer.',
            'Sin servicio. CPE no enciende.',
            'Velocidad baja en horario nocturno.',
            'Wi-Fi no llega al fondo de la casa.',
          ]),
          closeDescription: isClosed
            ? osStatus === ServiceOrderStatus.CANCELLED
              ? rand([
                  'Cliente canceló — falha resolvida sozinha.',
                  'No se pudo contactar al cliente. Cancelado.',
                  'Cliente pidió reagendar — abrir nueva O.S cuando llamar.',
                ])
              : rand([
                  'Cambio de patch cord. Servicio restablecido.',
                  'Reset de ONU. Conexión normalizada.',
                  'Cambio de CPE por defecto de fábrica. OK.',
                  'Ajuste de potencia óptica. Velocidad ok.',
                ])
            : null,
          city: cityInfo.city,
          state: cityInfo.state,
          assignedToId: admin?.id ?? null,
        });
        osCreated++;
      }

      // 8% têm mudança de plano em algum momento.
      if (ageMonths > 4 && Math.random() < 0.08) {
        const changeDate = daysAgo(randInt(30, ageMonths * 30 - 30));
        soBuffer.push({
          tenantId: tenant.id,
          contractId: contract.id,
          reasonId: reasonByName('Cambio de plan').id,
          code: `OS-${pad(seq, 6)}-3`,
          status: ServiceOrderStatus.COMPLETED,
          openedAt: changeDate,
          scheduledAt: changeDate,
          startedAt: changeDate,
          completedAt: new Date(changeDate.getTime() + randInt(1, 3) * 3600_000),
          openDescription: 'Cliente solicitó upgrade de plan.',
          closeDescription: `Reconfiguración aplicada. Nuevo plan: ${plan.mbps} Mbps.`,
          city: cityInfo.city,
          state: cityInfo.state,
          assignedToId: admin?.id ?? null,
        });
        osCreated++;
      }
    }

    // Flush periódico evita estourar memória + acelera (commits pequenos).
    if ((i + 1) % 500 === 0 || invoiceBuffer.length >= INVOICE_BUFFER_SIZE) {
      await flush();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  · ${i + 1}/${TARGET} clientes (${elapsed}s)`);
    }
  }

  // Flush final
  await flush();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n✅ Concluído em ' + elapsed + 's');
  console.log(`   clientes:    ${customersCreated}`);
  console.log(`   contratos:   ${contractsCreated} (todos IPoE)`);
  console.log(`   faturas:     ${invoicesCreated}`);
  console.log(`   cobranças:   ${chargesCreated}`);
  console.log(`   movimentos:  ${movementsCreated}`);
  console.log(`   O.S:         ${osCreated}`);
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
