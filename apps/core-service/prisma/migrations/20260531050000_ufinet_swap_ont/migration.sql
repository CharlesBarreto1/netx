-- Troca de ONT na Ufinet (Cambio de ONT / CHANGE_RESOURCE): novo estado de
-- lifecycle pra o poller executar o POST ServiceOrder/order + poll.
ALTER TYPE "UfinetLifecycle" ADD VALUE IF NOT EXISTS 'SWAPPING_ONT' AFTER 'REACTIVATING';
