import { Injectable } from '@nestjs/common';
import type { WaChannel } from '@prisma/client';

import type { ChannelProvider } from './channel-provider';
import { MetaCloudProvider } from './meta-cloud.provider';
import { WahaProvider } from './waha.provider';

/**
 * Despacha o ChannelProvider correto pelo canal da instância. Providers são
 * singletons sem estado — o estado vive na WhatsappInstance.
 */
@Injectable()
export class ChannelProviderFactory {
  constructor(
    private readonly waha: WahaProvider,
    private readonly meta: MetaCloudProvider,
  ) {}

  for(channel: WaChannel): ChannelProvider {
    return channel === 'META_CLOUD' ? this.meta : this.waha;
  }
}
