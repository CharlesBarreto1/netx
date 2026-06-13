import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  type FleetLiveResponse,
  type FleetRouteQuery,
  type FleetRouteResponse,
  type LiveDotStatus,
  type LivePositionResponse,
  type LiveVehicleStatus,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import {
  TraccarService,
  ignitionFrom,
  type NormalizedPosition,
} from './traccar.service';

const MOVING_SPEED_KMH = 3;
const ONLINE_WINDOW_MS = 10 * 60 * 1000; // 10 min sem report => OFFLINE
const IDLE_AFTER_MS = 2 * 60 * 1000; // ligado + parado > 2 min => dot amarelo
const STALE_AFTER_MS = 4 * 60 * 60 * 1000; // sem sync > 4 h => dot vermelho
const MAX_ROUTE_POINTS = 4000; // teto do histórico — amostra além disso

const liveVehicleSelect = {
  id: true,
  plate: true,
  brand: true,
  model: true,
  mapIcon: true,
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
        await this.cachePositions(tenantId, vehicles, liveByUnique, cacheByVehicle);
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
            ignition: ignitionFrom(live.attributes),
            lastMovedAt: resolveLastMovedAt(
              live.speedKmh,
              live.deviceTime,
              cached?.lastMovedAt ?? null,
            ),
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
              ignition: ignitionFrom(
                cached.attributes as Record<string, unknown> | null,
              ),
              lastMovedAt: cached.lastMovedAt,
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
        dot: dotFor(pos),
        ignition: pos.ignition,
        mapIcon: v.mapIcon,
        driverName: v.currentDriver?.name ?? null,
      });
    }

    return { ...base, positions };
  }

  /**
   * Percurso histórico (Traccar) de um veículo do tenant. A janela máxima é
   * validada no DTO; aqui só aplicamos o teto de pontos (amostragem uniforme
   * preservando primeiro/último) pra resposta não explodir.
   */
  async getRoute(
    tenantId: string,
    vehicleId: string,
    q: FleetRouteQuery,
  ): Promise<FleetRouteResponse> {
    const v = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
      select: { id: true, plate: true, trackerUniqueId: true },
    });
    if (!v) throw new NotFoundException('Veículo não encontrado');
    if (!v.trackerUniqueId) {
      throw new BadRequestException('Veículo sem rastreador vinculado');
    }
    if (!this.traccar.isConfigured()) {
      throw new ServiceUnavailableException('Traccar não configurado neste ambiente');
    }

    const route = await this.traccar.getRoute(v.trackerUniqueId, q.from, q.to);
    const truncated = route.length > MAX_ROUTE_POINTS;
    const sampled = truncated ? sampleEvenly(route, MAX_ROUTE_POINTS) : route;

    return {
      vehicleId: v.id,
      plate: v.plate,
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      truncated,
      points: sampled.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speedKmh,
        course: p.course,
        ignition: ignitionFrom(p.attributes),
        deviceTime: p.deviceTime.toISOString(),
      })),
    };
  }

  private async cachePositions(
    tenantId: string,
    vehicles: LiveVehicle[],
    liveByUnique: Map<string, NormalizedPosition>,
    prevByVehicle: Map<string, { lastMovedAt: Date | null }>,
  ): Promise<void> {
    const byUnique = new Map(
      vehicles.filter((v) => v.trackerUniqueId).map((v) => [v.trackerUniqueId!, v.id]),
    );
    await Promise.all(
      [...liveByUnique.entries()].map(([uniqueId, p]) => {
        const vehicleId = byUnique.get(uniqueId);
        if (!vehicleId) return Promise.resolve();
        const prev = prevByVehicle.get(vehicleId)?.lastMovedAt ?? null;
        const lastMovedAt = resolveLastMovedAt(p.speedKmh, p.deviceTime, prev);
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
          lastMovedAt,
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
  ignition: boolean | null;
  lastMovedAt: Date | null;
}

function statusFor(pos: PositionLike): LiveVehicleStatus {
  const stale = Date.now() - pos.deviceTime.getTime() > ONLINE_WINDOW_MS;
  if (stale) return 'OFFLINE';
  if ((pos.speedKmh ?? 0) > MOVING_SPEED_KMH) return 'MOVING';
  return 'STOPPED';
}

/**
 * Bolinha de status (semântica de ignição):
 * STALE (vermelho) sem sync > 4 h > OFF (cinza) ignição desligada >
 * IDLE (amarelo) ligado parado > 2 min > ON (verde) ligado.
 * Sem informação de ACC, degrada pra movimento: andando = ON, parado = OFF.
 */
function dotFor(pos: PositionLike): LiveDotStatus {
  const now = Date.now();
  if (now - pos.deviceTime.getTime() > STALE_AFTER_MS) return 'STALE';

  const moving = (pos.speedKmh ?? 0) > MOVING_SPEED_KMH;
  if (pos.ignition === false) return 'OFF';
  if (pos.ignition === true) {
    if (moving) return 'ON';
    const stoppedSince = pos.lastMovedAt?.getTime() ?? 0;
    return now - stoppedSince > IDLE_AFTER_MS ? 'IDLE' : 'ON';
  }
  return moving ? 'ON' : 'OFF';
}

/**
 * Última vez em movimento: andando agora = este report; parado = preserva o
 * valor anterior (primeiro report já parado conta a partir dele mesmo).
 */
function resolveLastMovedAt(
  speedKmh: number | null,
  deviceTime: Date,
  prev: Date | null,
): Date {
  if ((speedKmh ?? 0) > MOVING_SPEED_KMH) return deviceTime;
  return prev ?? deviceTime;
}

/** Amostra uniforme preservando o primeiro e o último ponto. */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(items[Math.round(i * step)]);
  }
  return out;
}

function labelFor(v: LiveVehicle): string {
  const name = [v.brand, v.model].filter(Boolean).join(' ').trim();
  return name || v.plate;
}
