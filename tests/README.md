# MedLab tests (owner: Shubh)

Jest + Supertest against a real PostgreSQL test database (`medlab_test`), plus a Playwright browser E2E.

```bash
npm install
npm test             # all unit + API tests (108)
npm run test:unit    # domain only, fast
npm run coverage     # with coverage report in coverage/
```

- DB URL: `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/medlab_test`). The schema is recreated on every run.
- `helpers/api.js` has `workflow(u, { until: 'UNDER_REVIEW' })`, which drives an order to any stage through the real API.
- Panic escalation tests use the injectable clock (`clock.setNow / advance`), so they don't wait in real time.

### E2E (browser)
```bash
npx playwright install chromium    # once
# terminal 1: cd backend && npm run reset && PANIC_ACK_WINDOW_SECONDS=20 PANIC_ONCALL_WINDOW_SECONDS=20 ESCALATION_POLL_SECONDS=3 npm start
# terminal 2: cd frontend && npm run dev
SHOTS=./shots npm run e2e          # saves screenshots for the report
```

Requirement → test mapping: `../docs/TRACEABILITY.md`.
