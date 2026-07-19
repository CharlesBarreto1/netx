import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AllocateNextRequestSchema,
  CgnatExportFormatEnum,
  CreateIpamAddressRequestSchema,
  CreateIpamCgnatPlanRequestSchema,
  CreateIpamPoolRequestSchema,
  CreateIpamPrefixRequestSchema,
  CreateIpamVrfRequestSchema,
  SplitIpamPrefixRequestSchema,
  UpdateIpamAddressRequestSchema,
  UpdateIpamCgnatPlanRequestSchema,
  UpdateIpamPoolRequestSchema,
  UpdateIpamPrefixRequestSchema,
  UpdateIpamVrfRequestSchema,
  type AllocateNextRequest,
  type AuthenticatedPrincipal,
  type CgnatExportFormat,
  type CreateIpamAddressRequest,
  type CreateIpamCgnatPlanRequest,
  type CreateIpamPoolRequest,
  type CreateIpamPrefixRequest,
  type CreateIpamVrfRequest,
  type SplitIpamPrefixRequest,
  type UpdateIpamAddressRequest,
  type UpdateIpamCgnatPlanRequest,
  type UpdateIpamPoolRequest,
  type UpdateIpamPrefixRequest,
  type UpdateIpamVrfRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { IpamAddressesService } from './addresses.service';
import { IpamCgnatService } from './cgnat.service';
import { IpamLookupService } from './lookup.service';
import { IpamPoolsService } from './pools.service';
import { IpamPrefixesService } from './prefixes.service';
import { IpamSyncService } from './ipam-sync.service';
import { IpamVrfsService } from './vrfs.service';

@ApiTags('ipam')
@ApiBearerAuth()
@Controller('ipam')
export class IpamController {
  constructor(
    private readonly vrfs: IpamVrfsService,
    private readonly prefixes: IpamPrefixesService,
    private readonly addresses: IpamAddressesService,
    private readonly pools: IpamPoolsService,
    private readonly cgnat: IpamCgnatService,
    private readonly lookupSvc: IpamLookupService,
    private readonly sync: IpamSyncService,
  ) {}

  // ── VRFs ──────────────────────────────────────────────────────────────────
  @Get('vrfs')
  @RequirePermissions('ipam.read')
  listVrfs(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.vrfs.list(u.tenantId);
  }

  @Post('vrfs')
  @RequirePermissions('ipam.write')
  createVrf(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateIpamVrfRequestSchema) body: CreateIpamVrfRequest,
  ) {
    return this.vrfs.create(u.tenantId, u.sub, body);
  }

  @Patch('vrfs/:id')
  @RequirePermissions('ipam.write')
  updateVrf(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateIpamVrfRequestSchema) body: UpdateIpamVrfRequest,
  ) {
    return this.vrfs.update(u.tenantId, u.sub, id, body);
  }

  @Delete('vrfs/:id')
  @HttpCode(204)
  @RequirePermissions('ipam.delete')
  async deleteVrf(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.vrfs.remove(u.tenantId, u.sub, id);
  }

  // ── Prefixos ────────────────────────────────────────────────────────────────
  @Get('prefixes')
  @RequirePermissions('ipam.read')
  listPrefixes(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('vrfId') vrfId?: string,
    @Query('role') role?: string,
    @Query('q') q?: string,
  ) {
    return this.prefixes.list(u.tenantId, { vrfId, role, q });
  }

  /** Mesma listagem, aninhada por parentId — a visão de árvore do IPAM. */
  @Get('prefixes/tree')
  @RequirePermissions('ipam.read')
  treePrefixes(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('vrfId') vrfId?: string,
    @Query('role') role?: string,
    @Query('q') q?: string,
  ) {
    return this.prefixes.tree(u.tenantId, { vrfId, role, q });
  }

  @Get('prefixes/:id')
  @RequirePermissions('ipam.read')
  getPrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.prefixes.findById(u.tenantId, id);
  }

  /** Blocos CIDR ainda não alocados dentro do prefixo. */
  @Get('prefixes/:id/free')
  @RequirePermissions('ipam.read')
  freePrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.prefixes.freeOf(u.tenantId, id, limit ? Number(limit) : 256);
  }

  /** Próxima subrede /len livre (first-fit). */
  @Get('prefixes/:id/next')
  @RequirePermissions('ipam.read')
  nextPrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('len') len: string,
  ) {
    return this.prefixes.nextAvailable(u.tenantId, id, Number(len));
  }

  /** Fatia o prefixo em subredes de tamanho fixo, pulando o já alocado. */
  @Post('prefixes/:id/split')
  @RequirePermissions('ipam.write')
  splitPrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SplitIpamPrefixRequestSchema) body: SplitIpamPrefixRequest,
  ) {
    return this.prefixes.split(u.tenantId, u.sub, id, body);
  }

  @Post('prefixes')
  @RequirePermissions('ipam.write')
  createPrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateIpamPrefixRequestSchema) body: CreateIpamPrefixRequest,
  ) {
    return this.prefixes.create(u.tenantId, u.sub, body);
  }

  @Patch('prefixes/:id')
  @RequirePermissions('ipam.write')
  updatePrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateIpamPrefixRequestSchema) body: UpdateIpamPrefixRequest,
  ) {
    return this.prefixes.update(u.tenantId, u.sub, id, body);
  }

  @Delete('prefixes/:id')
  @HttpCode(204)
  @RequirePermissions('ipam.delete')
  async deletePrefix(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.prefixes.remove(u.tenantId, u.sub, id);
  }

  // ── Endereços ─────────────────────────────────────────────────────────────
  @Get('addresses')
  @RequirePermissions('ipam.read')
  listAddresses(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('prefixId') prefixId?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('contractId') contractId?: string,
    @Query('equipmentId') equipmentId?: string,
    @Query('q') q?: string,
  ) {
    return this.addresses.list(u.tenantId, {
      prefixId,
      status,
      customerId,
      contractId,
      equipmentId,
      q,
    });
  }

  @Get('addresses/:id')
  @RequirePermissions('ipam.read')
  getAddress(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.addresses.findById(u.tenantId, id);
  }

  @Post('addresses')
  @RequirePermissions('ipam.write')
  async createAddress(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateIpamAddressRequestSchema) body: CreateIpamAddressRequest,
  ) {
    const created = await this.addresses.create(u.tenantId, u.sub, body, 'MANUAL');
    // Se o IP foi atribuído a um contrato pelo IPAM, empurra pro Framed-IP.
    if (body.contractId) {
      await this.sync.setContractIp(u.tenantId, u.sub, body.contractId, (created as { address: string }).address);
    }
    return created;
  }

  @Patch('addresses/:id')
  @RequirePermissions('ipam.write')
  async updateAddress(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateIpamAddressRequestSchema) body: UpdateIpamAddressRequest,
  ) {
    const updated = await this.addresses.update(u.tenantId, u.sub, id, body);
    if (body.contractId !== undefined) {
      await this.sync.setContractIp(
        u.tenantId,
        u.sub,
        body.contractId ?? (updated as { contractId: string | null }).contractId ?? '',
        body.contractId ? (updated as { address: string }).address : null,
      );
    }
    return updated;
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  @RequirePermissions('ipam.write')
  async releaseAddress(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.addresses.release(u.tenantId, u.sub, id);
  }

  /** Pega o próximo IP livre de um pool/prefixo (opcionalmente fixa no contrato). */
  @Post('addresses/allocate')
  @RequirePermissions('ipam.write')
  async allocate(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(AllocateNextRequestSchema) body: AllocateNextRequest,
  ) {
    const created = await this.addresses.allocateNext(u.tenantId, u.sub, body);
    if (body.contractId) {
      await this.sync.setContractIp(
        u.tenantId,
        u.sub,
        body.contractId,
        (created as { address: string }).address,
      );
    }
    return created;
  }

  // ── Pools ───────────────────────────────────────────────────────────────────
  @Get('pools')
  @RequirePermissions('ipam.read')
  listPools(@CurrentUser() u: AuthenticatedPrincipal, @Query('prefixId') prefixId?: string) {
    return this.pools.list(u.tenantId, prefixId);
  }

  @Get('pools/:id')
  @RequirePermissions('ipam.read')
  getPool(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pools.findById(u.tenantId, id);
  }

  @Post('pools')
  @RequirePermissions('ipam.write')
  createPool(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateIpamPoolRequestSchema) body: CreateIpamPoolRequest,
  ) {
    return this.pools.create(u.tenantId, u.sub, body);
  }

  @Patch('pools/:id')
  @RequirePermissions('ipam.write')
  updatePool(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateIpamPoolRequestSchema) body: UpdateIpamPoolRequest,
  ) {
    return this.pools.update(u.tenantId, u.sub, id, body);
  }

  @Delete('pools/:id')
  @HttpCode(204)
  @RequirePermissions('ipam.delete')
  async deletePool(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.pools.remove(u.tenantId, u.sub, id);
  }

  // ── CGNAT ─────────────────────────────────────────────────────────────────
  @Get('cgnat/plans')
  @RequirePermissions('ipam.read')
  listCgnat(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.cgnat.list(u.tenantId);
  }

  @Get('cgnat/plans/:id')
  @RequirePermissions('ipam.read')
  getCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cgnat.findById(u.tenantId, id);
  }

  @Post('cgnat/plans')
  @RequirePermissions('ipam.write')
  createCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateIpamCgnatPlanRequestSchema) body: CreateIpamCgnatPlanRequest,
  ) {
    return this.cgnat.create(u.tenantId, u.sub, body);
  }

  @Patch('cgnat/plans/:id')
  @RequirePermissions('ipam.write')
  updateCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateIpamCgnatPlanRequestSchema) body: UpdateIpamCgnatPlanRequest,
  ) {
    return this.cgnat.update(u.tenantId, u.sub, id, body);
  }

  @Delete('cgnat/plans/:id')
  @HttpCode(204)
  @RequirePermissions('ipam.delete')
  async deleteCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.cgnat.remove(u.tenantId, u.sub, id);
  }

  @Get('cgnat/plans/:id/preview')
  @RequirePermissions('ipam.read')
  previewCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.cgnat.preview(
      u.tenantId,
      id,
      limit ? Number(limit) : 100,
      offset ? Number(offset) : 0,
    );
  }

  @Post('cgnat/plans/:id/materialize')
  @HttpCode(200)
  @RequirePermissions('ipam.write')
  materializeCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cgnat.materialize(u.tenantId, u.sub, id);
  }

  @Get('cgnat/plans/:id/export')
  @RequirePermissions('ipam.read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  exportCgnat(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('format') format?: string,
  ) {
    const fmt: CgnatExportFormat = CgnatExportFormatEnum.catch('csv').parse(format);
    return this.cgnat.export(u.tenantId, id, fmt);
  }

  // ── Busca reversa (Marco Civil) ──────────────────────────────────────────────
  @Get('lookup')
  @RequirePermissions('ipam.read')
  lookup(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('ip') ip: string,
    @Query('port') port?: string,
    @Query('at') at?: string,
  ) {
    return this.lookupSvc.lookup(u.tenantId, {
      ip,
      port: port ? Number(port) : null,
      at: at ?? null,
    });
  }
}
