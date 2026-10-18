// Runs before every test file, before any backend module is loaded.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/medlab_test';
process.env.JWT_SECRET = 'test-secret';
process.env.PANIC_ACK_WINDOW_SECONDS = '600';     // 10 min
process.env.PANIC_ONCALL_WINDOW_SECONDS = '300';  // 5 min
