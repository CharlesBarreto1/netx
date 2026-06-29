'use client';

import { GitBranch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ComingSoonPlaceholder } from '@/components/mapping/ComingSoonPlaceholder';

export default function MappingBackbonePage() {
  const t = useTranslations('comingSoon');
  return (
    <ComingSoonPlaceholder
      icon={GitBranch}
      title={t('backbone.title')}
      description={t('backbone.description')}
    />
  );
}
