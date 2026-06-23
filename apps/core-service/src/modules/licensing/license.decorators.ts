import { SetMetadata } from '@nestjs/common';
import type { ModuleCode } from '@netx/shared';

export const LICENSE_BYPASS_KEY = 'licenseBypass';

/**
 * Marca uma rota autenticada como isenta do LicenseGuard (mas ainda exige
 * login). Usado pelo endpoint de status da licença — o front precisa
 * conseguir lê-lo mesmo com a licença bloqueada pra renderizar a tela certa.
 */
export const LicenseBypass = () => SetMetadata(LICENSE_BYPASS_KEY, true);

export const REQUIRES_MODULE_KEY = 'requiresModule';

/**
 * Exige que o módulo `code` (catálogo do ecossistema) esteja habilitado pela
 * licença para a rota/classe. Aplicado pelo ModuleEntitlementGuard, que é
 * DEFAULT-PERMISSIVO: licenciamento desligado, ou token sem o claim `modules`
 * (instância legada), libera. Ver ECOSYSTEM-MODULAR-PLAN §8.
 */
export const RequiresModule = (code: ModuleCode) => SetMetadata(REQUIRES_MODULE_KEY, code);
