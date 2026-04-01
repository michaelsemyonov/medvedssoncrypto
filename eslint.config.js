import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';
import path from 'node:path';
import tseslint from 'typescript-eslint';

const pwaRootDir = path.join(import.meta.dirname, 'apps/pwa');

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      'apps/pwa/public/sw.js',
      'apps/pwa/next-env.d.ts',
      'vitest.config.ts'
    ]
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  },
  {
    files: ['eslint.config.js'],
    plugins: {
      '@next/next': nextPlugin
    },
    settings: {
      next: {
        rootDir: pwaRootDir
      }
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off'
    }
  },
  {
    ...nextPlugin.flatConfig.coreWebVitals,
    files: ['apps/pwa/**/*.{js,jsx,ts,tsx}'],
    settings: {
      next: {
        rootDir: pwaRootDir
      }
    }
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off'
    }
  }
);
