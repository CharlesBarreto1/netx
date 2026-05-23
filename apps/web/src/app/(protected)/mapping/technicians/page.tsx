'use client';

import { HardHat } from 'lucide-react';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingTechniciansPage() {
  return (
    <ComingSoonPlaceholder
      icon={HardHat}
      title="Técnicos em Campo"
      description="Localização ao vivo dos técnicos durante o expediente (via app mobile). Mostra qual O.S. está em andamento, tempo desde o check-in, e sugere otimização de rota pra próxima parada."
    />
  );
}
