# Requirements traceability matrix

Maps every SRS requirement in the proposal (Section 5) to the implementation and the tests that verify it.
Run all tests with `cd tests && npm test`.

| ID | Requirement (short) | Pri. | Implementation | Verified by |
|---|---|---|---|---|
| R-01 | Accounts, role login, role-scoped access | Must | `middleware/auth.js`, `services/users.js`, `App.jsx` guards | `api/auth-rbac.test.js` (all) |
| R-02 | Physician orders tests, routine/STAT | Must | `services/orders.js#createOrder`, `NewOrder.jsx` | `orders-catalogue` › R-02 |
| R-03 | Panels expand into tracked components; panel status | Must | `createOrder`, `stateMachine.js#panelStatus` | `unit/stateMachine` › R-03; `orders-catalogue` › R-03 |
| R-04 | Catalogue: tests, ranges, TAT, panels | Must | `services/catalogue.js`, `admin/Catalogue.jsx` | `orders-catalogue` › R-04 |
| R-05 | Assign / reassign to technicians | Must | `orders.js#assignOrder`, `Orders.jsx` | `orders-catalogue` › R-05 |
| R-06 | Specimen collection, unique accession | Must | `specimens.js#collectSpecimen`, `UNIQUE` + sequence | `specimens-results` › R-06 |
| R-07 | Defined specimen/test stages | Must | `stateMachine.js` (`orderItemMachine`, `specimenMachine`) | `unit/stateMachine`; `specimens-results` › R-07/R-14 |
| R-08 | Rejection with reason → recollection, notify | Must | `specimens.js#rejectSpecimen` | `specimens-results` › R-08 |
| R-09 | Result entry by category | Must | `domain/resultTypes.js` (polymorphic), `ResultForm.jsx` | `unit/resultTypes`; `specimens-results` › R-09 |
| R-10 | Review: approve or return for retest | Must | `results.js#review` | `specimens-results` › R-10 |
| R-11 | Released results immutable; versioned amendments | Must | `results.js#amend`, DB trigger `result_versions_guard` | `specimens-results` › R-11; `portal-audit-reports` › history |
| R-12 | Event notifications | Must | `services/notifications.js`, `NotificationBell.jsx` | `portal-audit-reports` › R-12; notification asserts across suites |
| R-13 | Panic acknowledgement + 2-stage escalation | Must | `services/escalation.js`, `PanicAlerts.jsx`, `PanicBanner.jsx` | `api/panic-escalation.test.js` (11 tests) |
| R-14 | Enforce valid progression; closure rule | Must | `stateMachine.js#canCloseOrder`, `orders.js#closeOrder` | `specimens-results` › R-07/R-14 |
| R-15 | Patient views own results, downloads report | Should | `patients.js#streamReport` (PDF), `MyResults.jsx` | `portal-audit-reports` › R-15 |
| R-16 | Chronological history incl. superseded | Should | `patients.js#history`, `PatientHistory.jsx` | `portal-audit-reports` › R-16 |
| R-17 | Search / filter orders | Should | `orders.js#searchOrders`, `Orders.jsx` | `orders-catalogue` › R-17 |
| R-18 | Turnaround-time report | Should | `services/reports.js`, `admin/Turnaround.jsx` | `reports-performance` › R-18 |
| R-19 | Audit trail of every state change | Must | `services/audit.js`, trigger `audit_log_guard` | `portal-audit-reports` › R-19 |

## Non-functional requirements

| NFR | Target | How it is met | Verified by |
|---|---|---|---|
| 01 Usability | Order in ≤ 5 steps | New Order is one screen with 4 numbered sections + submit | E2E `workflow.e2e.mjs` step 1 |
| 02 Performance | Search ≤ 2 s on ≥ 5,000 orders; notification ≤ 30 s | Indexed columns; 10 s client polling | `reports-performance` › NFR-02 |
| 03 Security | RBAC on every endpoint; own records only; bcrypt | `requireRole`, per-query scoping, bcrypt cost 10 | `auth-rbac` (hash format, 403 matrix, patient isolation) |
| 04 Reliability | Escalation fires even if unread; no partial state | Server-side scheduler; every transition in one DB transaction | `panic-escalation` › NFR-04; `portal-audit-reports` › atomicity |
| 05 Compatibility | Chrome/Firefox/Edge; ≥ 768 px | Standard React + CSS; responsive breakpoint at 900 px | Manual check |

## Optional features from instructor feedback (Sep 2)
OF-01 (event notifications) and OF-02 (panic escalation) are **implemented**. In-app delivery is simulated; there is no SMS or email gateway, as stated in the proposal's out-of-scope list.
