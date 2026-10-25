import { defineConfig } from 'vitest/config';

/**
 * As the core's and the MCP server's: bare describe/it/expect, and './Foo.js' specifiers resolved against the
 * .ts originals. The eval's scripts are plain JavaScript, tested as they are.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/__tests__/**/*.test.ts', 'scripts/**/__tests__/**/*.test.mjs']
    },
    resolve: {
        alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }]
    }
});
