-- Marca o 1º tick em que o serviço entrou em "aprovisionando" (Ufinet 426
-- "Tareas pendientes"). Serve de âncora pro teto de espera: se a Ufinet não
-- concluir o aprovisionamento em PENDING_MAX_MS (1h), o serviço vira FAILED em
-- vez de repollar pra sempre. NULL = não está (ou não chegou a ficar) pending.
ALTER TABLE "ufinet_services" ADD COLUMN "pending_since" TIMESTAMP(3);
