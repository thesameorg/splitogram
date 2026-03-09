/**
 * k6 load test for Splitogram API
 *
 * Bootstraps everything from scratch on an empty local D1:
 *   1. Auth (creates dev user)
 *   2. Create group (dev user becomes admin)
 *   3. Create placeholder member (second user for debts)
 *   4. Seed expenses (dev user pays, placeholder participates → debts exist)
 *   5. Run mixed traffic: reads, writes, settlements
 *
 * Prerequisites:
 *   brew install k6
 *   bun run db:migrate:local
 *   bun run dev:backend          # DEV_AUTH_BYPASS_ENABLED=true in .dev.vars
 *
 * Run:
 *   k6 run loadtest.js                          # steady 20 VUs, 1 min
 *   k6 run --env SCENARIO=spike loadtest.js     # spike to 50 VUs
 *   k6 run --env SCENARIO=stress loadtest.js    # ramp to 150 VUs
 */

import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// --- Custom metrics ---
const expensesCreated = new Counter('expenses_created');
const settlementsCompleted = new Counter('settlements_completed');
const expenseLatency = new Trend('expense_create_latency', true);
const settlementLatency = new Trend('settlement_flow_latency', true);

// --- Config ---
const BASE = __ENV.BASE_URL || 'http://localhost:8787';
const HEADERS = { 'Content-Type': 'application/json' };
// Dev bypass: no auth header needed — middleware falls back to mock user
const SEED_EXPENSES = 10; // number of expenses to seed in setup

// --- Scenarios ---
const scenarios = {
  default: {
    stages: [
      { duration: '10s', target: 10 },
      { duration: '40s', target: 20 },
      { duration: '10s', target: 0 },
    ],
  },
  spike: {
    stages: [
      { duration: '5s', target: 5 },
      { duration: '5s', target: 50 },
      { duration: '20s', target: 50 },
      { duration: '5s', target: 5 },
      { duration: '10s', target: 5 },
      { duration: '5s', target: 0 },
    ],
  },
  stress: {
    stages: [
      { duration: '10s', target: 20 },
      { duration: '20s', target: 50 },
      { duration: '20s', target: 100 },
      { duration: '20s', target: 150 },
      { duration: '10s', target: 0 },
    ],
  },
};

const selected = __ENV.SCENARIO || 'default';
export const options = {
  stages: (scenarios[selected] || scenarios.default).stages,
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
    expense_create_latency: ['p(95)<800'],
  },
};

// --- Helpers ---
function post(path, body) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), { headers: HEADERS });
}

function get(path) {
  return http.get(`${BASE}${path}`);
}

function del(path) {
  return http.del(`${BASE}${path}`);
}

// --- Setup: bootstrap all data from scratch ---
export function setup() {
  // Step 1: Auth — creates the dev user in D1
  const authRes = http.post(`${BASE}/api/v1/auth`, null);
  if (!check(authRes, { 'setup: auth ok': (r) => r.status === 200 })) {
    fail(`Auth failed: ${authRes.status} ${authRes.body}`);
  }
  console.log(`Auth: ${authRes.json().user.displayName} (source: ${authRes.json().source})`);

  // Step 2: Create a group
  const groupRes = post('/api/v1/groups', {
    name: `loadtest-${Date.now()}`,
    currency: 'USD',
  });
  if (!check(groupRes, { 'setup: group created': (r) => r.status === 201 })) {
    fail(`Group creation failed: ${groupRes.status} ${groupRes.body}`);
  }
  const groupId = groupRes.json().id;
  console.log(`Group created: id=${groupId}`);

  // Step 3: Get dev user's internal ID from group detail
  const groupDetail = get(`/api/v1/groups/${groupId}`);
  check(groupDetail, { 'setup: group detail ok': (r) => r.status === 200 });
  const devUserId = groupDetail.json().members[0].userId;
  console.log(`Dev user internal ID: ${devUserId}`);

  // Step 4: Create a placeholder member (second user for debts)
  const placeholderRes = post(`/api/v1/groups/${groupId}/placeholders`, {
    name: 'LoadTest Bob',
  });
  if (!check(placeholderRes, { 'setup: placeholder created': (r) => r.status === 201 })) {
    fail(`Placeholder creation failed: ${placeholderRes.status} ${placeholderRes.body}`);
  }
  const placeholderId = placeholderRes.json().userId;
  console.log(`Placeholder member: id=${placeholderId}`);

  // Step 5: Seed expenses — dev user pays, both participate (creates debts)
  const expenseIds = [];
  for (let i = 0; i < SEED_EXPENSES; i++) {
    const amount = (i + 1) * 5_000_000; // 5, 10, 15... in micro-units
    const expRes = post(`/api/v1/groups/${groupId}/expenses`, {
      amount,
      description: `Seed expense #${i + 1}`,
      paidBy: devUserId,
      participantIds: [devUserId, placeholderId],
      splitMode: 'equal',
    });
    check(expRes, { [`setup: expense #${i + 1} created`]: (r) => r.status === 201 });
    if (expRes.status === 201) {
      expenseIds.push(expRes.json().id);
    }
  }
  console.log(`Seeded ${expenseIds.length} expenses`);

  // Step 6: Verify balances exist (placeholder owes dev user)
  const balRes = get(`/api/v1/groups/${groupId}/balances`);
  check(balRes, { 'setup: balances ok': (r) => r.status === 200 });
  const debts = balRes.json().debts || [];
  console.log(`Debts after seeding: ${debts.length} (expected 1: Bob → Dev)`);
  if (debts.length > 0) {
    console.log(`  ${debts[0].from.displayName} owes ${debts[0].to.displayName}: ${debts[0].amount}`);
  }

  return { groupId, devUserId, placeholderId, expenseIds };
}

// --- Main VU iteration ---
export default function (data) {
  const { groupId, devUserId, placeholderId } = data;

  if (!groupId) {
    console.error('Setup failed — skipping');
    return;
  }

  // Weighted traffic mix (roughly matches real-world read:write ratio)
  const roll = Math.random();

  if (roll < 0.12) {
    // 12% — Create expense (write)
    createExpense(groupId, devUserId, placeholderId);
  } else if (roll < 0.20) {
    // 8% — Full settlement flow (write-heavy)
    settleDebt(groupId, devUserId, placeholderId);
  } else if (roll < 0.35) {
    // 15% — List expenses (read)
    listExpenses(groupId);
  } else if (roll < 0.50) {
    // 15% — Get balances (read, compute-heavy: debt simplification)
    getBalances(groupId);
  } else if (roll < 0.65) {
    // 15% — Group detail (read)
    getGroupDetail(groupId);
  } else if (roll < 0.78) {
    // 13% — Activity feed (read)
    getActivity(groupId);
  } else if (roll < 0.85) {
    // 7% — Group stats (read, compute-heavy)
    getStats(groupId);
  } else if (roll < 0.92) {
    // 7% — Auth call (simulates app open)
    doAuth();
  } else {
    // 8% — Health check (baseline)
    healthCheck();
  }

  sleep(0.05 + Math.random() * 0.2); // 50-250ms think time
}

// --- Write operations ---

function createExpense(groupId, devUserId, placeholderId) {
  group('Create Expense', () => {
    const amount = Math.floor(Math.random() * 50_000_000) + 1_000_000; // 1-50 USD
    const res = post(`/api/v1/groups/${groupId}/expenses`, {
      amount,
      description: `LT ${__VU}-${__ITER}`,
      paidBy: devUserId,
      participantIds: [devUserId, placeholderId],
      splitMode: 'equal',
    });

    if (check(res, { 'expense created': (r) => r.status === 201 })) {
      expensesCreated.add(1);
      expenseLatency.add(res.timings.duration);
    }
  });
}

function settleDebt(groupId, devUserId, placeholderId) {
  group('Settlement Flow', () => {
    const start = Date.now();

    // Create settlement: placeholder owes dev user
    const createRes = post(`/api/v1/groups/${groupId}/settlements`, {
      fromUserId: placeholderId,
      toUserId: devUserId,
    });

    // Could be 201 (new), 200 (existing open), or 400 (no_debt if fully settled)
    const created = check(createRes, {
      'settlement created/found': (r) => r.status === 201 || r.status === 200,
    });

    if (!created) return;

    const settlement = createRes.json().settlement;
    if (!settlement) return;

    // Mark as settled externally (dev user = creditor, allowed)
    const markRes = post(`/api/v1/settlements/${settlement.id}/mark-external`, {
      comment: `LT settle ${__VU}-${__ITER}`,
    });

    if (check(markRes, { 'settlement completed': (r) => r.status === 200 })) {
      settlementsCompleted.add(1);
      settlementLatency.add(Date.now() - start);
    }

    // After settling, create a new expense to regenerate debts for the next VU
    post(`/api/v1/groups/${groupId}/expenses`, {
      amount: Math.floor(Math.random() * 20_000_000) + 2_000_000,
      description: `Post-settle ${__VU}-${__ITER}`,
      paidBy: devUserId,
      participantIds: [devUserId, placeholderId],
      splitMode: 'equal',
    });
  });
}

// --- Read operations ---

function listExpenses(groupId) {
  group('List Expenses', () => {
    const res = get(`/api/v1/groups/${groupId}/expenses?limit=50`);
    check(res, { 'expenses listed': (r) => r.status === 200 });
  });
}

function getBalances(groupId) {
  group('Get Balances', () => {
    const res = get(`/api/v1/groups/${groupId}/balances`);
    check(res, { 'balances ok': (r) => r.status === 200 });
  });
}

function getGroupDetail(groupId) {
  group('Get Group Detail', () => {
    const res = get(`/api/v1/groups/${groupId}`);
    check(res, { 'group ok': (r) => r.status === 200 });
  });
}

function getActivity(groupId) {
  group('Get Activity', () => {
    const res = get(`/api/v1/groups/${groupId}/activity?limit=20`);
    check(res, { 'activity ok': (r) => r.status === 200 });
  });
}

function getStats(groupId) {
  group('Get Stats', () => {
    const res = get(`/api/v1/groups/${groupId}/stats?period=all`);
    check(res, { 'stats ok': (r) => r.status === 200 });
  });
}

function doAuth() {
  group('Auth', () => {
    const res = http.post(`${BASE}/api/v1/auth`, null);
    check(res, { 'auth ok': (r) => r.status === 200 });
  });
}

function healthCheck() {
  group('Health', () => {
    const res = get('/api/health');
    check(res, { 'health ok': (r) => r.status === 200 });
  });
}

// --- Teardown: clean up ---
export function teardown(data) {
  if (data.groupId) {
    console.log(`Teardown: deleting group ${data.groupId}`);
    del(`/api/v1/groups/${data.groupId}`);
  }
}
