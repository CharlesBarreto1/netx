-- Step-up (reautenticação) pra ações privilegiadas do NetX Field (ex.: desbloqueio).
-- A janela de elevação mora na sessão (sobrevive a refresh; o claim mfa do token
-- decai no refresh). Ver StepUpGuard / AuthService.stepUp.
ALTER TABLE "sessions" ADD COLUMN "elevated_at" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN "elevated_until" TIMESTAMP(3);
