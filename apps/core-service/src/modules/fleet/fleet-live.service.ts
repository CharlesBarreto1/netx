import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  type FleetLiveResponse,
  type LivePositionResponse,
  type LiveVehicleStatus,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { TraccarService, type NormalizedPosition } from './traccar.service';

const MOVING_SPEED_KMH = 3;
const ONLINE_WINDOW_MS = 10 * 60 * 1000; // 10 min sem report => OFFLINE

const liveVehicleSelect = {
  id: true,
  plate: true,
  brand: true,
  model: true,
  trackerUniqueId: true,
  currentDriver: { select: { name: true } },
} satisfies Prisma.VehicleSelect;

type LiveVehicle = Prisma.VehicleGetPayload<{ select: typeof liveVehicleSelect }>;

@Injectable()
export class FleetLiveService {
  private readonly logger = new Logger(FleetLiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly traccar: TraccarService,
  ) {}

  async getLivePositions(tenantId: string): Promise<FleetLiveResponse> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, deletedAt: null, trackerUniqueId: { not: null } },
      select: liveVehicleSelect,
    });

    const traccarConfigured = this.traccar.isConfigured();
    const base: Omit<FleetLiveResponse, 'positions'> = {
      generatedAt: new Date().toISOString(),
      trackedVehicles: vehicles.length,
      traccarConfigured,
    };

    if (vehicles.length === 0) {
      return { ...base, positions: [] };
    }

    // Cache (última posição conhecida) — fallback se o Traccar falhar.
    const cacheRows = await this.prisma.vehiclePosition.findMany({
      where: { tenantId, vehicleId: { in: vehicles.map((v) => v.id) } },
    });
    const cacheByVehicle = new Map(cacheRows.map((r) => [r.vehicleId, r]));

    // Posições ao vivo do Traccar (por uniqueId/IMEI).
    let liveByUnique = new Map<string, NormalizedPosition>();
    if (traccarConfigured) {
      const uniqueIds = vehicles
        .map((v) => v.trackerUniqueId)
        .filter((x): x is string => Boolean(x));
      try {
        liveByUnique = await this.traccar.getPositionsByUniqueIds(uniqueIds);
        await this.cachePositions(tenantId, vehicles, liveByUnique);
      } catch (err) {
        this.logger.warn(
          `Traccar inacessível, usando última posição em cache: ${(err as Error).message}`,
        );
      }
    }

    const positions: LivePositionResponse[] = [];
    for (const v of vehicles) {
      const live = v.trackerUniqueId ? liveByUnique.get(v.trackerUniqueId) : undefined;
      const cached = cacheByVehicle.get(v.id);
      const pos: PositionLike | null = live
        ? {
            latitude: live.latitude,
            longitude: live.longitude,
            speedKmh: live.speedKmh,
            course: live.course,
            address: live.address,
            deviceTime: live.deviceTime,
            serverTime: live.serverTime,
          }
        : cached
          ? {
              latitude: cached.latitude,
              longitude: cached.longitude,
              speedKmh: cached.speed,
              course: cached.course,
              address: cached.address,
              deviceTime: cached.deviceTime,
              serverTime: cached.serverTime,
            }
          : null;

      if (!pos) continue; // sem nenhuma posição (nunca reportou) — não mapeia.

      positions.push({
        vehicleId: v.id,
        plate: v.plate,
        label: labelFor(v),
        trackerUniqueId: v.trackerUniqueId,
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed: pos.speedKmh,
        course: pos.course,
        address: pos.address,
        deviceTime: pos.deviceTime.toISOString(),
        serverTime: pos.serverTime.toISOString(),
        status: statusFor(pos),
        driverName: v.currentDriver?.name ?? null,
      });
    }

    return { ...base, positions };
  }

  private async cachePositions(
    tenantId: string,
    vehicles: LiveVehicle[],
    liveByUnique: Map<string, NormalizedPosition>,
  ): Promise<void> {
    const byUnique = new Map(
      vehicles.filter((v) => v.trackerUniqueId).map((v) => [v.trackerUniqueId!, v.id]),
    );
    await Promise.all(
      [...liveByUnique.entries()].map(([uniqueId, p]) => {
        const vehicleId = byUnique.get(uniqueId);
        if (!vehicleId) return Promise.resolve();
        const data = {
          tenantId,
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speedKmh,
          course: p.course,
          altitude: p.altitude,
          address: p.address,
          deviceTime: p.deviceTime,
          serverTime: p.serverTime,
          attributes: (p.attributes ?? undefined) as Prisma.InputJsonValue | undefined,
        };
        return this.prisma.vehiclePosition.upsert({
          where: { vehicleId },
          create: { vehicleId, ...data },
          update: data,
        });
      }),
    );
  }
}

interface PositionLike {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  course: number | null;
  address: string | null;
  deviceTime: Date;
  serverTime: Date;
}

function statusFor(pos: PositionLike): LiveVehicleStatus {
  const stale = Date.now() - pos.deviceTime.getTime() > ONLINE_WINDOW_MS;
  if (stale) return 'OFFLINE';
  if ((pos.speedKmh ?? 0) > MOVING_SPEED_KMH) return 'MOVING';
  return 'STOPPED';
}

function labelFor(v: LiveVehicle): string {
  const name = [v.brand, v.model].filter(Boolean).join(' ').trim();
  return name || v.plate;
}
