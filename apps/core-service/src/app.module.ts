import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { CrmModule } from './modules/crm/crm.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { DisconnectModule } from './modules/disconnect/disconnect.module';
import { EventBusModule } from './modules/events/event-bus.module';
import { BtgModule } from './modules/btg/btg.module';
import { EfiModule } from './modules/efi/efi.module';
import { HubsoftModule } from './modules/hubsoft/hubsoft.module';
import { ServiceOrdersModule } from './modules/service-orders/service-orders.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BackupsModule } from './modules/backups/backups.module';
import { HealthModule } from './modules/health/health.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { NetworkModule } from './modules/network/network.module';
import { IpamModule } from './modules/ipam/ipam.module';
import { FibermapModule } from './modules/fibermap/fibermap.module';
import { PortalModule } from './modules/portal/portal.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { IdempotencyModule } from './common/idempotency.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { AlarmsModule } from './modules/alarms/alarms.module';
import { AiModule } from './modules/ai/ai.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { RadiusModule } from './modules/radius/radius.module';
import { RolesModule } from './modules/roles/roles.module';
import { MappingModule } from './modules/mapping/mapping.module';
import { LocationsModule } from './modules/locations/locations.module';
import { SifenModule } from './modules/sifen/sifen.module';
import { NfcomModule } from './modules/nfcom/nfcom.module';
import { StockModule } from './modules/stock/stock.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { StorageModule } from './modules/storage/storage.module';
import { HrModule } from './modules/hr/hr.module';
import { UfinetModule } from './modules/ufinet/ufinet.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OidcModule } from './modules/oidc/oidc.module';
import { FieldModule } from './modules/field/field.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Pino logger (structured JSON in prod, pretty in dev)
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'core-service' },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.passwordHash',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
            : undefined,
      },
    }),

    // Request-scoped storage for tenant context and correlation ids
    ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true } }),

    // Rate limiting (per-IP default; tighter limits on /auth/login in the guard)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // Scheduled jobs (cron) — usado pelo módulo Contratos, entre outros
    ScheduleModule.forRoot(),

    // Infrastructure
    PrismaModule,
    HealthModule,
    CryptoModule,
    DisconnectModule,
    // Idempotência global (opt-in pelo header Idempotency-Key) — replay-safe
    // pro NetX Field. Passthrough quando o header não vem (web/produção atual).
    IdempotencyModule,
    // Licenciamento — registra o LicenseGuard global (fail-open quando off).
    LicensingModule,
    // Bus de eventos do ecossistema — global; DESLIGADO por default (no-op até
    // EVENTBUS_ENABLED=true). Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md.
    EventBusModule.forRoot(),

    // Feature modules
    TenantsModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AuditModule,
    CrmModule,
    LocationsModule,
    ContractsModule,
    ServiceOrdersModule,
    FinanceModule,
    EfiModule,
    BtgModule,
    HubsoftModule,
    ReportsModule,
    BackupsModule,
    NetworkModule,
    IpamModule,
    FibermapModule,
    PortalModule,
    RadiusModule,
    SifenModule,
    NfcomModule,
    MappingModule,
    StockModule,
    FleetModule,
    StorageModule,
    HrModule,
    OidcModule,
    UfinetModule,
    ProvisioningModule,
    AlarmsModule,
    AiModule,
    CopilotModule,
    MobileModule,
    WhatsappModule,
    NotificationsModule,
    // NetX Field — BFF read-only (Assinante 360), cobertura e ações de campo.
    FieldModule,
  ],
})
export class AppModule {}
