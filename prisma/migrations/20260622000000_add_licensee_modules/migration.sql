-- Módulos habilitados por licenciado (catálogo do ecossistema NetX).
-- Vazio = todos habilitados no cliente (legado). Carimbado no token via issue().
ALTER TABLE "licensees" ADD COLUMN "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
