'use client';

import { Truck } from 'lucide-react';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingVehiclesPage() {
  return (
    <ComingSoonPlaceholder
      icon={Truck}
      title="Frota"
      description="Veículos da operação rastreados em tempo real (integração com rastreadores GPS — Suntech, ST, etc). Histórico de rotas, KM rodados por veículo, alertas de velocidade."
    />
  );
}
