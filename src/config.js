require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

module.exports = {
  port: num(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/medlab',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  panic: {
    ackWindowSeconds: num(process.env.PANIC_ACK_WINDOW_SECONDS, 900),
    onCallWindowSeconds: num(process.env.PANIC_ONCALL_WINDOW_SECONDS, 900),
    pollSeconds: num(process.env.ESCALATION_POLL_SECONDS, 15),
  },
};
