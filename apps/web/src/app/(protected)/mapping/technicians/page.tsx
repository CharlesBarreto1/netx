'use client';

import { HardHat } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingTechniciansPage() {
  const t = useTranslations('comingSoon');
  return (
    <ComingSoonPlaceholder
      icon={HardHat}
      title={t('technicians.title')}
      description={t('technicians.description')}
    />
  );
}
