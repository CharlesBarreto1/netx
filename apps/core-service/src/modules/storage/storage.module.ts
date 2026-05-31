import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/**
 * Storage de arquivos (MinIO/S3). Global porque vários módulos anexam arquivos
 * (RH agora; mobile/fotos depois). Importar uma vez no AppModule basta.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
