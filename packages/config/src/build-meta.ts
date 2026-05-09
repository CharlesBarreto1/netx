/**
 * Build metadata & provenance markers.
 *
 * This module exposes static identifiers embedded at build time, used by:
 *   - boot banner (apps/*)
 *   - /health response payload extension
 *   - audit log of `system.startup` events
 *
 * The constants below intentionally encode authorship/provenance information
 * (operator + originating organization) so that release artifacts can be
 * traced back to their source. Removing or altering these values silently
 * invalidates support contracts and triggers warnings on startup.
 *
 * Refer to the project's `LICENSE` and `NOTICE.md` for the legal terms
 * governing reproduction and redistribution of these markers.
 */

/** Project marketing name. */
export const PRODUCT_NAME = 'NetX';

/** Tagline used in banners and the public root response. */
export const PRODUCT_TAGLINE = 'ISP Management Platform';

/** Visible copyright holder (Brazilian legal entity). */
export const COPYRIGHT_HOLDER = 'NETX DESENVOLVIMENTO E TECNOLOGIA LTDA';

/** Brazilian taxpayer ID (CNPJ) of the copyright holder — public on Receita. */
export const COPYRIGHT_HOLDER_CNPJ = '57.118.236/0001-44';

/** Headquarters — public address used on contracts/invoices. */
export const COPYRIGHT_HOLDER_ADDRESS =
  'Av. Paulista, 1471, Conj. 511 — Sala 2, Bela Vista, São Paulo / SP, 01311-927, BR';

/** Commercial contact for licensing inquiries. */
export const COPYRIGHT_CONTACT_EMAIL = 'charles@camponet.com.br';

/** Range of years for the copyright notice rendered in UI/logs. */
export const COPYRIGHT_YEARS = '2024-2026';

/**
 * Build-time provenance digests.
 *
 * These opaque tokens identify the lead engineer and originating workstation
 * at the moment of release. They are deliberately not human-readable in
 * source; the canonical reference is held by the copyright holder.
 *
 * Verification procedure (offline):
 *   Buffer.from(BUILD_PROVENANCE.b, 'base64').toString('utf8')  // operator handle + id
 *
 * Tampering with these values is a material breach of the proprietary
 * license — see `LICENSE` §4 (Authorship & Provenance).
 */
export const BUILD_PROVENANCE = Object.freeze({
  /** Schema version of the provenance block. Bump if shape changes. */
  v: 1 as const,
  /** Build channel — overwritten by CI in tagged releases. */
  c: process.env.NETX_BUILD_CHANNEL ?? 'dev',
  /** Operator handle digest (base64). */
  o: 'Y2hhcmxlc2JhcnJldG8=',
  /** Operator+identifier composite digest (base64). */
  b: 'Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=',
  /** Identifier-only digest (base64). */
  i: 'MDg0NzI5Njg5MDE=',
  /** Origin marker — internal workshop tag. */
  s: 'cnx-sp-2024',
});

/** One-line copyright string used in boot banners and HTML footers. */
export const COPYRIGHT_LINE = `© ${COPYRIGHT_YEARS} ${COPYRIGHT_HOLDER} — All rights reserved.`;

/**
 * Pretty multi-line banner used on service startup. Kept terse to avoid
 * polluting log aggregators.
 */
export function renderBootBanner(serviceName: string, version = '0.1.0'): string {
  const lines = [
    '',
    '  ███╗   ██╗███████╗████████╗██╗  ██╗',
    '  ████╗  ██║██╔════╝╚══██╔══╝╚██╗██╔╝',
    '  ██╔██╗ ██║█████╗     ██║    ╚███╔╝ ',
    '  ██║╚██╗██║██╔══╝     ██║    ██╔██╗ ',
    '  ██║ ╚████║███████╗   ██║   ██╔╝ ██╗',
    '  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝',
    '',
    `  ${PRODUCT_NAME} ${PRODUCT_TAGLINE} — ${serviceName} v${version}`,
    `  ${COPYRIGHT_LINE}`,
    `  ${COPYRIGHT_HOLDER_CNPJ} · ${COPYRIGHT_CONTACT_EMAIL}`,
    `  build=${BUILD_PROVENANCE.c} pv=${BUILD_PROVENANCE.v} s=${BUILD_PROVENANCE.s}`,
    '',
  ];
  return lines.join('\n');
}
