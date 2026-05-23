'use client';

import { Network } from 'lucide-react';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingNetworkPage() {
  return (
    <ComingSoonPlaceholder
      icon={Network}
      title="Mapa de Rede"
      description="Visualize projetos FTTH, áreas de cobertura, POPs e equipamentos no mapa. Sobrepõe polígonos de regiões atendidas, marcadores de POPs com status, e linhas de fibra entre eles."
    />
  );
}
