// ESLint flat config (v9+).
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.claude/**',
      '**/.agent/**',
      '**/.tmp/**',
      '**/tmp/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/out/**',
      '**/build/**',
      '**/*.config.{js,cjs,mjs}',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'no-control-regex': 'off',
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipTemplates: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['**/*.{mjs,js,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    files: ['apps/desktop/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@anthropic-ai/sdk', message: 'renderer must not import LLM SDK runtime' },
            { name: 'openai', message: 'renderer must not import LLM SDK runtime' },
            {
              name: '@kodax-ai/coding',
              message: 'renderer must not import KodaX runtime; only types/constants allowed',
            },
            {
              name: '@kodax-ai/skills',
              message: 'renderer must not import KodaX runtime; only types/constants allowed',
            },
          ],
          patterns: [
            { group: ['electron', 'electron/*'], message: 'renderer must not import electron' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/desktop/electron/diagnostics/**/*.{ts,tsx}',
      'apps/desktop/electron/space-control/**/*.{ts,tsx}',
      'apps/desktop/electron/window/app-protocol*.ts',
      'apps/desktop/electron/ipc/diagnostics.ts',
      'apps/desktop/electron/ipc/space-control.ts',
    ],
    ignores: ['apps/desktop/electron/diagnostics/runtime.ts', 'apps/desktop/electron/test/**'],
    rules: {
      'no-console': 'error',
    },
  },
];
