import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Minimal monorepo ESLint (typescript-eslint recommended subset).
 * Scoped to first-party sources; vendor / build outputs ignored.
 * Prefer green CI: unused vars are warn; a few recommended rules that trip
 * intentional patterns (control-char regex, rethrow without cause) are off.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/*.mjs',
      'apps/desktop/bin/**',
      'apps/desktop/vendor/**',
      'tmp/**',
      'patches/**',
      'docs/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-unused-vars': 'off',
      'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Intentional in security / path sanitizers.
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      // Node < / older patterns; not worth churn this batch.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-prototype-builtins': 'off',
      'no-constant-binary-expression': 'warn',
      'no-useless-catch': 'warn',
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
