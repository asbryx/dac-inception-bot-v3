const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        AbortController: 'readonly',
        BigInt: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        global: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-control-regex': 'off',
      'no-dupe-class-members': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',
    },
  },
];
