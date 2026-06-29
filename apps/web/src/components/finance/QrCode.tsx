'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';

/**
 * Renderiza um QR a partir de uma string (no KuDE, a URL de consulta da SET).
 * Gera um data URL no cliente via lib `qrcode`. Enquanto não gerou, mostra um
 * placeholder do mesmo tamanho pra não pular o layout na impressão.
 */
export function QrCode({ value, size = 120 }: { value: string; size?: number }) {
  const t = useTranslations('uiPrimitives');
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { margin: 0, width: size * 2 })
      .then((url) => active && setDataUrl(url))
      .catch(() => active && setDataUrl(null));
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="border border-slate-300"
        aria-label="QR"
      />
    );
  }

  return <img src={dataUrl} alt={t('qrAlt')} width={size} height={size} />;
}
