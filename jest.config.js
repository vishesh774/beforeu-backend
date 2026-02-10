module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/scripts/**',
        '!src/tests/**',
        '!src/config/**'
    ],
    coverageThreshold: {
        global: {
            branches: 95,
            functions: 95,
            lines: 95,
            statements: 95
        }
    },
    testMatch: ['**/tests/**/*.test.ts'],
    moduleNameMapper: {
        '^uuid$': require.resolve('uuid')
    },
    transformIgnorePatterns: [
        '/node_modules/(?!uuid)'
    ],
    verbose: true,
    forceExit: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true
};
