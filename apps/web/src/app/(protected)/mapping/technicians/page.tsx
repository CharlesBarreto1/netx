'use client';

import { HardHat } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingTechniciansPage() {
  const t = useTranslations('miscComponents');
  return (
    <ComingSoonPlaceholder
      icon={HardHat}
      title={t('mappingTechnicians.title')}
      description={t('mappingTechnicians.description')}
    />
  );
}
