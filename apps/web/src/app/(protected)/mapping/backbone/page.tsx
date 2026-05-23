'use client';

import { GitBranch } from 'lucide-react';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingBackbonePage() {
  return (
    <ComingSoonPlaceholder
      icon={GitBranch}
      title="Backbone Óptico"
      description="Traçados de fibra entre POPs com metadados (capacidade, comprimento, fornecedor). Detecta cortes via alarme do equipamento e destaca o trecho afetado em vermelho."
    />
  );
}
