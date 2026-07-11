-- AlterEnum
-- WiFi-Opt: novas ações de auditoria em provisioning_events. Migration
-- separada SÓ com ALTER TYPE (precedente 20260603030000): valor novo de enum
-- não pode ser usado na mesma transação em que foi criado.
ALTER TYPE "ProvisioningEventAction" ADD VALUE 'TR069_WIFI_OPT';
ALTER TYPE "ProvisioningEventAction" ADD VALUE 'TR069_CHANNEL_SWITCH';
