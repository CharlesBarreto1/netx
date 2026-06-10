import { SetMetadata } from '@nestjs/common';

export const LICENSE_BYPASS_KEY = 'licenseBypass';

/**
 * Marca uma rota autenticada como isenta do LicenseGuard (mas ainda exige
 * login). Usado pelo endpoint de status da licença — o front precisa
 * conseguir lê-lo mesmo com a licença bloqueada pra renderizar a tela certa.
 */
export const LicenseBypass = () => SetMetadata(LICENSE_BYPASS_KEY, true);
