-- PPPoE capturado via Inform TR-069 como fonte de sinal de dono — a de MAIOR
-- confiança (o equipamento físico dizendo qual login autentica, imune ao erro
-- humano do cadastro Hubsoft).
ALTER TYPE "DiscoveredOntSignalSource" ADD VALUE IF NOT EXISTS 'PPPOE';
