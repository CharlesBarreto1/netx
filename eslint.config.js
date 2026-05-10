// =============================================================================
// ESLint flat config (ESLint 9+).
//
// Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
// Substitui o `.eslintrc.json` legado. ESLint 8 era EOL desde out/2024.
//
// Convenções:
//   - Regras "warn" em vez de "error" pra ruído comum (unused vars, prefer-const).
//   - Off em coisas que TS já cobre (no-undef, no-unused-vars sem TS).
//   - O app web tem config próprio (apps/web/eslint.config.js) com next/...
// =============================================================================
const tseslint = require('typescript-eslint');
const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  // Ignores globais — equivalente ao .eslintignore antigo
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.nx/**',
      '**/build/**',
      '**/coverage/**',
      '**/generated/**',
      '**/prisma/migrations/**',
      '**/*.d.ts',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      '**/jest.config.*',
      'apps/web/**', // tem config própria
    ],
  },

  // Base recomendado JS + TS
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  // Regras gerais do monorepo
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        node: true,
        browser: true,
        es2022: true,
        jest: true,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': 'off',
      'no-empty-pattern': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-undef': 'off', // TS já cobre; sem isso reclama de globals tipo `Buffer`, `process`
      'no-console': 'off',
      'no-async-promise-executor': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'off',
      'prefer-const': 'warn',
    },
  },

  // Tests / scripts: relax ainda mais
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
