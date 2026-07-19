import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', 'apps/device-gateway/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scripts/hook em JS puro rodam no Node — declara os globais usados.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  {
    // `.cjs` é CommonJS de propósito — ex.: scripts/assert-nms-schema.cjs, guard
    // de pré-migration invocado direto pelo `node`, sem passar por build. Aqui
    // `require`/`module` são a forma correta, não um resquício a migrar: declara
    // os globais do CJS e desliga a regra que empurra ESM. Preferido a ignorar o
    // arquivo, que também apagaria os erros reais.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __filename: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
