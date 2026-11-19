import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/target/**',
      '**/out/**',
      'packages/fixtures/data/**',
      'apps/web/next-env.d.ts',
      'programs/**',
      '.anchor/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['streams/filter.js'],
    rules: { 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
);
