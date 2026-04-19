import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantMiddleware } from '../../common/tenant.middleware';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply to every route so tenantId is resolvable when available
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
