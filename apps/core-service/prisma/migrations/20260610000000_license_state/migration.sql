-- Estado local da licença desta instalação com a NetX. Singleton (1 linha,
-- id = 'singleton'). Sem tenant_id — é sobre a instalação inteira. O token é
-- renovado pelo heartbeat; o guard valida a assinatura localmente.
CREATE TABLE "license_state" (
    "id"                 TEXT NOT NULL DEFAULT 'singleton',
    "token"              TEXT,
    "status"             VARCHAR(16),
    "expires_at"         TIMESTAMP(3),
    "last_heartbeat_at"  TIMESTAMP(3),
    "last_error"         VARCHAR(500),
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_state_pkey" PRIMARY KEY ("id")
);
