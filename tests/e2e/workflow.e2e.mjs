/**
 * End-to-end browser smoke test of the full MedLab workflow through the React UI.
 *
 * Prereqs: backend running with a SHORT panic window, frontend dev server running, fresh seed:
 *   cd backend && npm run reset && PANIC_ACK_WINDOW_SECONDS=20 PANIC_ONCALL_WINDOW_SECONDS=20 ESCALATION_POLL_SECONDS=3 npm start
 *   cd frontend && npm run dev
 *   cd tests && npm run e2e            (optional: SHOTS=./shots to save screenshots)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = process.env.SHOTS;
const PW = 'Password123!';
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

const browser = await chromium.launch(exe ? { executablePath: exe, headless: false, args: ['--headless=new'] } : {});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
// Any failing app/API request is an error; third-party assets (web fonts) and favicon are ignored.
page.on('response', (r) => {
  const u = new URL(r.url());
  if (r.status() >= 400 && u.origin === new URL(BASE).origin && !u.pathname.endsWith('favicon.ico')) {
    errors.push(`HTTP ${r.status()} ${r.request().method()} ${u.pathname}`);
  }
});

let n = 0;
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
const step = (msg) => console.log(`✓ ${msg}`);

async function login(email) {
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('.shell');
}

// 1. Physician places a STAT order: BMP panel + Troponin
await login('physician@medlab.test');
await shot('login-physician');
await page.click('text=New Order');
await page.waitForSelector('select[size="6"] option');
const patientValue = await page.locator('select[size="6"] option', { hasText: 'Pat Patient' }).getAttribute('value');
await page.selectOption('select[size="6"]', patientValue);
await page.check('text=STAT');
await page.check('label:has-text("Basic Metabolic Panel") input');
await page.check('label:has-text("Troponin I") input');
await shot('new-order');
await page.click('button:has-text("Place order")');
await page.waitForURL(/\/orders\/\d+$/);
const orderId = page.url().split('/').pop();
await page.waitForSelector('text=Glucose');
step(`physician placed STAT order #${orderId} (BMP + TROP = 9 tests)`);
await shot('order-placed');

// 2. Admin assigns to technician
await login('admin@medlab.test');
await page.waitForSelector(`text=#${orderId}`);
await shot('admin-queue');
await page.locator('tr', { hasText: `#${orderId}` }).locator('select').selectOption({ label: 'Tom Technician' });
await page.waitForTimeout(500);
step('admin assigned order to Tom Technician');

// 3. Technician collects, processes, enters results (one panic glucose)
await login('tech@medlab.test');
await page.click(`text=#${orderId}`);
await page.click('button:has-text("Record specimen collection")');
await page.waitForSelector('text=/ML\\d{8}-\\d{6}/');
await page.click('button:has-text("Start processing")');
await page.waitForSelector('button:has-text("Enter result")');
step('technician collected specimen (accession number) and started processing');

const values = { Glucose: 32, Sodium: 139, Potassium: 4.1, Chloride: 101, 'Carbon Dioxide': 25, 'Blood Urea Nitrogen': 14, Creatinine: 0.9, Calcium: 9.4, 'Troponin I': 0.02 };
for (const [name, v] of Object.entries(values)) {
  const card = page.locator('.item-card', { hasText: name }).first();
  await card.locator('button:has-text("Enter result")').click();
  await card.locator('input[type=number]').fill(String(v));
  await card.locator('button:has-text("Save result")').click();
  await card.locator('button:has-text("Submit for physician review")').waitFor();
}
await shot('tech-results-entered');
for (const name of Object.keys(values)) {
  const card = page.locator('.item-card', { hasText: name }).first();
  await card.locator('button:has-text("Submit for physician review")').click();
  await card.locator('.badge:has-text("Under review")').waitFor();
}
step('technician entered 9 results (glucose 32 = panic) and submitted for review');

// 4. Physician sees panic banner; let it escalate to on-call, who acknowledges
await login('physician@medlab.test');
await page.waitForSelector('.panic-banner');
await shot('physician-panic-banner');
step('ordering physician sees the panic banner');

console.log('  …waiting for escalation window (20s)');
await page.waitForTimeout(26000);
await login('oncall@medlab.test');
await page.click('text=Panic Alerts');
await page.waitForSelector('.badge.panic:has-text("On-call")');
await shot('oncall-escalated');
page.once('dialog', (d) => d.accept('Called ED, patient given dextrose'));
await page.click('button:has-text("Acknowledge")');
await page.waitForSelector('text=Open (0)');
step('alert escalated to on-call physician, who acknowledged it');

// 5. Physician approves all results; returns one for retest first
await login('physician@medlab.test');
await page.goto(`${BASE}/orders/${orderId}`);
const k = page.locator('.item-card', { hasText: 'Potassium' }).first();
await k.locator('button:has-text("Return for retest")').click();
await k.locator('input[placeholder="Reason for retest"]').fill('Possible hemolysis - please rerun');
await k.locator('button:has-text("Return to lab")').click();
await k.locator('text=Returned for retest').waitFor();
for (const name of Object.keys(values).filter((x) => x !== 'Potassium')) {
  const card = page.locator('.item-card', { hasText: name }).first();
  await card.locator('button:has-text("Approve")').click();
  await card.locator('.badge:has-text("Released")').waitFor();
}
step('physician returned potassium for retest and released the other 8');

// 6. Tech re-runs potassium; physician releases -> order auto-closes; tech amends glucose
await login('tech@medlab.test');
await page.goto(`${BASE}/orders/${orderId}`);
const k2 = page.locator('.item-card', { hasText: 'Potassium' }).first();
await k2.locator('button:has-text("Re-enter result")').or(k2.locator('button:has-text("Enter result")')).first().click();
await k2.locator('input[type=number]').fill('4.3');
await k2.locator('button:has-text("Save result")').click();
await k2.locator('button:has-text("Submit for physician review")').click();
await k2.locator('.badge:has-text("Under review")').waitFor();

await login('physician@medlab.test');
await page.goto(`${BASE}/orders/${orderId}`);
await page.locator('.item-card', { hasText: 'Potassium' }).first().locator('button:has-text("Approve")').click();
await page.waitForSelector('.page-head .badge:has-text("Closed")');
step('potassium retest released; order auto-closed');

const g = page.locator('.item-card', { hasText: 'Glucose' }).first();
await g.locator('button:has-text("Amend result")').click();
await g.locator('input[type=number]').fill('34');
await g.locator('input[required]:not([type=number])').last().fill('Repeat analysis on same specimen');
await g.locator('button:has-text("Issue amended version")').click();
await g.locator('text=amended').waitFor();
await g.locator('button:has-text("Versions")').click();
await g.locator('.badge:has-text("Superseded")').waitFor();
await page.click('button:has-text("Show")');
await page.waitForSelector('text=AUTO_CLOSED');
await shot('order-closed-amended-audit');
step('glucose amended -> v2 current, v1 superseded; audit trail visible');

// 7. Patient sees released results and history
await login('patient@medlab.test');
await page.waitForSelector('text=Glucose');
await shot('patient-results');
const count = await page.locator('.item-card').count();
step(`patient sees ${count} released results`);

// 8. Admin views turnaround report
await login('admin@medlab.test');
await page.click('text=Turnaround Report');
await page.waitForSelector('td:has-text("Glucose")');
await shot('tat-report');
step('admin turnaround report renders');

await browser.close();
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nE2E workflow passed.');
