/**
 * backfill-prepaid-initial.ts — corrige contratos PREPAID já ativados ANTES do
 * fix que gera a fatura inicial na ativação em campo (installCustomer).
 *
 * Esses contratos ficaram sem INITIAL e com prepaidUntil nulo, então o cron de
 * geração os pulava pra sempre (zero faturas). Este script gera a INITIAL +
 * inicializa prepaidUntil/cycleAnchorDay — REUSANDO a mesma lógica de produção
 * (InvoiceGeneratorService.generateInitialInvoice), pra não divergir.
 *
 * Uso (a partir de apps/core-service):
 *   dry-run (padrão, NÃO grava):
 *     dotenv -e ../../.env -- ts-node scripts/backfill-prepaid-initial.ts ZUX-1 ZUX-6 ZUX-7
 *   aplicar de verdade:
 *     dotenv -e ../../.env -- ts-node scripts/backfill-prepaid-initial.ts --apply ZUX-1 ZUX-6 ZUX-7
 *
 * Idempotente: pula contrato que já tem INITIAL. Só toca PREPAID + ACTIVE.
 */
import { PrismaClient } from '@prisma/client';

import { InvoiceGeneratorService } from '../src/modules/contracts/invoice-generator.service';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const codes = args.filter((a) => !a.startsWith('--'));

  if (codes.length === 0) {
    console.error('Informe os códigos de contrato. Ex.: ZUX-1 ZUX-6 ZUX-7');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const gen = new InvoiceGeneratorService(prisma as never);

  console.log(
    `\n${apply ? '🟢 APLICANDO' : '🔎 DRY-RUN (nada é gravado)'} — contratos: ${codes.join(', ')}\n`,
  );

  for (const code of codes) {
    const contract = await prisma.contract.findFirst({
      where: { code, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        code: true,
        monthlyValue: true,
        dueDay: true,
        paymentMode: true,
        status: true,
        activatedAt: true,
        prepaidUntil: true,
      },
    });

    if (!contract) {
      console.log(`  ⚠️  ${code}: não encontrado — pulando.`);
      continue;
    }
    if (contract.paymentMode !== 'PREPAID') {
      console.log(`  ⏭️  ${code}: não é PREPAID (${contract.paymentMode}) — pulando.`);
      continue;
    }
    if (contract.status !== 'ACTIVE') {
      console.log(`  ⏭️  ${code}: status ${contract.status} (esperado ACTIVE) — pulando.`);
      continue;
    }
    const hasInitial = await prisma.contractInvoice.findFirst({
      where: { tenantId: contract.tenantId, contractId: contract.id, kind: 'INITIAL' },
      select: { id: true },
    });
    if (hasInitial) {
      console.log(`  ✅ ${code}: já tem INITIAL — nada a fazer.`);
      continue;
    }

    const activatedAt = contract.activatedAt ?? new Date();
    console.log(
      `  → ${code}: gerar INITIAL (valor=${contract.monthlyValue}, ativado=${activatedAt.toISOString().slice(0, 10)})`,
    );

    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      await gen.generateInitialInvoice(tx, contract, { activatedAt });
    });
    const inv = await prisma.contractInvoice.findFirst({
      where: { tenantId: contract.tenantId, contractId: contract.id, kind: 'INITIAL' },
      select: { dueDate: true, amount: true, status: true },
    });
    const after = await prisma.contract.findUnique({
      where: { id: contract.id },
      select: { prepaidUntil: true, cycleAnchorDay: true },
    });
    console.log(
      `     ✔ INITIAL criada: venc=${inv?.dueDate.toISOString().slice(0, 10)} valor=${inv?.amount} status=${inv?.status} · prepaidUntil=${after?.prepaidUntil?.toISOString().slice(0, 10)} anchor=${after?.cycleAnchorDay}`,
    );
  }

  console.log(
    apply
      ? '\n✅ Backfill aplicado.\n'
      : '\nℹ️  Dry-run concluído. Reexecute com --apply pra gravar.\n',
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
