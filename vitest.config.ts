import { defineConfig } from 'vitest/config';

/**
 * As the core's and the MCP server's: bare describe/it/expect, and './Foo.js' specifiers resolved against the
 * .ts originals.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/__tests__/**/*.test.ts']
    },
    resolve: {
        alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }]
    }
});
