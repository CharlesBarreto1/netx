// =============================================================================
// ESLint flat config — apps/web (Next.js).
//
// Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
//
// Next 14 ainda exporta a config como `extends: ['next/core-web-vitals']` no
// formato legacy. O helper `FlatCompat` traduz pro flat config.
// =============================================================================
import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'build/**'],
  },
  ...compat.extends('next/core-web-vitals'),
];
