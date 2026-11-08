const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'));
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const SECRET = 'devinarok-test-secret';

function bundle(file) {
  const output = esbuild.buildSync({
    entryPoints: [path.join(ROOT, file)],
    bundle: true,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', output)(loaded, loaded.exports, require);
  return loaded.exports;
}

class D1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.database.sqlite.prepare(this.sql).get(...this.values) ?? null; }
  all() { return { results: this.database.sqlite.prepare(this.sql).all(...this.values) }; }
  run() {
    this.database.statements.push(this.sql);
    const result = this.database.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('CREATE TABLE users (id TEXT PRIMARY KEY, is_anonymous INTEGER NOT NULL DEFAULT 0, password_hash TEXT)');
    this.statements = [];
    this.sqlite.prepare('INSERT INTO users (id, is_anonymous) VALUES (?, ?)').run('user-1', 0);
    this.sqlite.prepare('INSERT INTO users (id, is_anonymous) VALUES (?, ?)').run('user-2', 0);
    this.sqlite.prepare('INSERT INTO users (id, is_anonymous) VALUES (?, ?)').run('anonymous-row', 1);
  }
  prepare(sql) { return new D1Statement(this, sql); }
  batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function token(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 });
  const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function request(method, url, body, authorization) {
  return new Request(`https://relay.test${url}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function environment() {
  return { DB: new D1Database(), JWT_SECRET: SECRET };
}

async function createCharacter(commit, env, auth, id = 'char-1') {
  const response = await commit({
    request: request('POST', '/api/devinarok/commit', {
      characterId: id,
      baseRev: 0,
      idempotencyKey: `create-${id}`,
      context: { kind: 'hub' },
      ops: [{ type: 'createCharacter', name: '기사', kind: 'knight' }],
    }, auth),
    env,
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return response.json();
}

const commits = bundle('functions/api/devinarok/commit.ts');
const charactersRoute = bundle('functions/api/devinarok/characters.ts');
const deleteRoute = bundle('functions/api/auth/delete.ts');
const enhanceRoute = bundle('functions/api/devinarok/enhance.ts');
const importRoute = bundle('functions/api/devinarok/import.ts');
const validators = bundle('functions/lib/devinarok/validation.ts');
const saveOps = bundle('functions/lib/devinarok/js/save/ops.js');
const shared = bundle('functions/api/devinarok/_shared.ts');
const itemContent = bundle('functions/lib/devinarok/js/content/items.js');
const stageContent = bundle('functions/lib/devinarok/js/content/stages.js');
const affixContent = bundle('functions/lib/devinarok/js/content/affixes.js');

test('item UIDs are unique per user', async () => {
  const env = environment();
  await shared.ensureTables(env.DB);
  env.DB.prepare('INSERT INTO devinarok_items (user_id, uid, char_id, data_json) VALUES (?, ?, ?, ?)')
    .bind('user-1', 'shared-uid', 'char-1', '{}').run();
  assert.doesNotThrow(() => env.DB.prepare(
    'INSERT INTO devinarok_items (user_id, uid, char_id, data_json) VALUES (?, ?, ?, ?)',
  ).bind('user-2', 'shared-uid', 'char-2', '{}').run());
  assert.throws(() => env.DB.prepare(
    'INSERT INTO devinarok_items (user_id, uid, char_id, data_json) VALUES (?, ?, ?, ?)',
  ).bind('user-1', 'shared-uid', 'char-3', '{}').run());
});

test('ledger idempotency keys are scoped by user', async () => {
  const env = environment();
  const auth1 = token({ sub: 'user-1' });
  const auth2 = token({ sub: 'user-2' });
  await createCharacter(commits.onRequestPost, env, auth1, 'shared-char');
  await createCharacter(commits.onRequestPost, env, auth2, 'shared-char');

  const commitFor = (auth, amount) => commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', {
      characterId: 'shared-char',
      baseRev: 1,
      idempotencyKey: 'shared-key',
      context: { kind: 'debug' },
      ops: [{ type: 'grantGold', amount }, { type: 'markDebug' }],
    }, auth),
    env,
  });
  const first = await commitFor(auth1, 7);
  const second = await commitFor(auth2, 11);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).character.gold, 7);
  assert.equal((await second.json()).character.gold, 11);
  assert.equal(env.DB.prepare(`SELECT COUNT(*) AS n FROM devinarok_ledger
    WHERE char_id = ? AND idem_key = ?`).bind('shared-char', 'shared-key').first().n, 2);
  assert.equal((await (await commitFor(auth1, 99)).json()).character.gold, 7);
  assert.equal((await (await commitFor(auth2, 99)).json()).character.gold, 11);
});

test('account deletion removes Devinarok data in child-first order', async () => {
  const env = environment();
  await shared.ensureTables(env.DB);
  env.DB.prepare(`INSERT INTO devinarok_characters
    (user_id, char_id, rev, level, xp, gold, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('user-1', 'char-1', 1, 1, 0, 0, '{}').run();
  env.DB.prepare('INSERT INTO devinarok_items (user_id, uid, char_id, data_json) VALUES (?, ?, ?, ?)')
    .bind('user-1', 'item-1', 'char-1', '{}').run();
  env.DB.prepare('INSERT INTO devinarok_ledger (user_id, char_id, rev, idem_key, ops_json) VALUES (?, ?, ?, ?, ?)')
    .bind('user-1', 'char-1', 1, 'commit-1', '[]').run();
  const statementOffset = env.DB.statements.length;

  const response = await deleteRoute.onRequestPost({
    request: request('POST', '/api/auth/delete', undefined, token({ sub: 'user-1' })),
    env,
  });

  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const deletions = env.DB.statements.slice(statementOffset)
    .filter((sql) => /^DELETE FROM devinarok_/.test(sql))
    .map((sql) => sql.match(/^DELETE FROM (\w+)/)[1]);
  assert.deepEqual(deletions, ['devinarok_items', 'devinarok_ledger', 'devinarok_characters']);
  for (const table of deletions) {
    assert.equal(env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first().n, 0);
  }
});

test('settlement caps use the specified XP and gold formulas and reject excess rewards', () => {
  const caps = validators.settlementCaps('C1', 'normal', 1);
  const tier = stageContent.DIFFICULTIES.normal;
  const goldGain = 1 + (5 * (
    affixContent.AFFIXES.goldGain.max + affixContent.AFFIXES.goldGain.perIlvl * 20
  )) / 100;
  const xpGain = 1 + (5 * (
    affixContent.AFFIXES.xpGain.max + affixContent.AFFIXES.xpGain.perIlvl * 20
  )) / 100;
  assert.equal(caps.xpCap, Math.ceil(caps.baseXp * tier.xpMult * xpGain * 1.25));
  assert.equal(caps.goldCap, Math.ceil(
    5 * caps.effectiveLevel * tier.goldMult * goldGain * caps.enemyCount * 1.25,
  ));
  assert.equal(caps.summonerBudget, 0);
  assert.equal(caps.bossAddBudget, 40);
  assert.equal(caps.maxSummonerAddXp, 0);
  assert.equal(caps.maxBossAddXp, 0);
  assert.equal(caps.itemCap, caps.enemyCount + 2 * caps.bossCount);
  const character = { id: 'c', level: 1, potions: 0, clearedStages: [], rev: 1 };
  assert.throws(() => validators.validateOps({
    character,
    ops: [
      { type: 'gainXp', amount: caps.xpCap + 1 },
      { type: 'grantGold', amount: 0 },
      { type: 'setPotions', count: 0 },
      { type: 'clearStage', stageId: 'C1' },
    ],
    context: { kind: 'settlement', stageId: 'C1', difficulty: 'normal', partySize: 1, outcome: 'clear' },
    now: Date.now(),
  }), /settlement-cap-exceeded/);
});

test('settlement rejects excess gold, items, item level, potions, and too-fast records', () => {
  const stageId = 'C1';
  const difficulty = 'normal';
  const caps = validators.settlementCaps(stageId, difficulty, 1);
  const key = stageContent.stageClearKey(stageId, difficulty);
  const floor = 150 * caps.roomCount;
  const character = { id: 'c', level: 1, potions: 0, clearedStages: [] };
  const baseOps = [
    { type: 'gainXp', amount: 0 },
    { type: 'grantGold', amount: 0 },
    { type: 'setPotions', count: 0 },
    { type: 'clearStage', stageId: key },
    { type: 'recordClear', key, ticks: floor },
  ];
  const validate = (ops, options = {}) => validators.validateOps({
    character, ops, context: { kind: 'settlement', stageId, difficulty, partySize: 1, outcome: 'clear' },
    ...options,
  });
  assert.throws(() => validate(baseOps.map((op) => op.type === 'grantGold'
    ? { ...op, amount: caps.goldCap + 1 } : op)), /settlement-cap-exceeded/);

  const tooManyItems = [
    ...baseOps,
    ...Array.from({ length: caps.itemCap + 1 }, (_, index) => ({
      type: 'grantItem', uid: `loot-${index}`, itemId: 'rusted-sword',
      rarity: 'common', ilvl: 1, affixes: [],
    })),
  ];
  assert.throws(() => validate(tooManyItems), /settlement-cap-exceeded/);

  const tooHigh = [
    ...baseOps.slice(0, 3),
    { type: 'grantItem', uid: 'too-high', itemId: 'rusted-sword', rarity: 'common', ilvl: caps.effectiveLevel + 3, affixes: [] },
    ...baseOps.slice(3),
  ];
  assert.throws(() => validate(tooHigh), /invalid-item/);
  assert.throws(() => validate(baseOps.map((op) => op.type === 'setPotions'
    ? { ...op, count: 1 } : op)), /invalid-potions/);
  assert.throws(() => validate(baseOps.map((op) => op.type === 'recordClear'
    ? { ...op, ticks: floor - 1 } : op)), /invalid-stage-record/);
  assert.throws(() => validate(baseOps, { now: 20_000, lastSettlementAt: 10_001 }), /settlement-rate-limit/);
});

test('import and settlement share strict affix validation for dropped items', () => {
  const stageId = 'C1';
  const difficulty = 'normal';
  const key = stageContent.stageClearKey(stageId, difficulty);
  const item = {
    uid: 'loot',
    itemId: 'rusted-sword',
    rarity: 'common',
    ilvl: 1,
    enhance: 0,
    affixes: [],
  };
  const character = { id: 'settlement', level: 1, potions: 0, clearedStages: [] };
  const validateSettlement = (drop) => validators.validateOps({
    character,
    ops: [
      { type: 'gainXp', amount: 0 },
      { type: 'grantGold', amount: 0 },
      { type: 'setPotions', count: 0 },
      { type: 'grantItem', ...drop },
      { type: 'clearStage', stageId: key },
      { type: 'recordClear', key, ticks: 150 * stageContent.STAGES[stageId].rooms.length },
    ],
    context: { kind: 'settlement', stageId, difficulty, partySize: 1, outcome: 'clear' },
  });
  const importCharacter = {
    ...character,
    id: 'imported',
    name: '기사',
    kind: 'knight',
    xp: 0,
    gold: 0,
    potions: 3,
    rev: 1,
    debugUsed: false,
    equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
    clearedStages: [],
    records: {},
  };
  const validateImport = (candidate) => validators.validateImport({
    character: importCharacter,
    items: [candidate],
  });

  assert.doesNotThrow(() => validateSettlement(item));
  assert.doesNotThrow(() => validateSettlement({ ...item, slot: null }));
  for (const invalid of [
    { affixes: [{ id: 'unknown-stat', value: 1 }] },
    { affixes: [{ id: 'attackPercent', value: 0 }] },
    { rarity: 'magic', affixes: [{ id: 'attackPercent', value: 100 }] },
  ]) {
    const candidate = { ...item, ...invalid };
    assert.throws(() => validateSettlement(candidate), /invalid-item/, JSON.stringify(candidate));
    assert.throws(() => validateImport(candidate), /invalid-item/, JSON.stringify(candidate));
  }
  assert.throws(() => validateSettlement({ ...item, enhance: 1 }), /invalid-item/);
  assert.throws(() => validateSettlement({ ...item, slot: 'weapon' }), /invalid-item/);
});

test('server save operations reject equipping an item outside its base slot', () => {
  const character = { id: 'hero', level: 1, equipment: { weapon: null, head: null, body: null, hands: null, feet: null } };
  const item = { uid: 'sword', characterId: 'hero', itemId: 'rusted-sword', slot: null, requiredLevel: 1 };
  assert.throws(() => saveOps.applyOperations(character, { sword: item }, [
    { type: 'equip', uid: 'sword', slot: 'head' },
  ], 'hero'), TypeError);
});

test('hub grants only the exact paired family starter-weapon purchase', () => {
  const starter = itemContent.FAMILY_STARTER_WEAPONS[0];
  const valid = [
    { type: 'spendGold', amount: starter.price },
    {
      type: 'grantItem', uid: 'starter', itemId: starter.itemId,
      rarity: 'common', ilvl: 1, enhance: 0, affixes: [],
    },
  ];
  assert.doesNotThrow(() => validators.validateOps({
    character: { id: 'c', gold: starter.price }, ops: valid, context: { kind: 'hub' },
  }));
  assert.throws(() => validators.validateOps({
    character: { id: 'c', gold: starter.price },
    ops: [{ ...valid[1], uid: 'unpaired' }],
    context: { kind: 'hub' },
  }), /starter-weapon-purchase-invalid/);
});

test('settlements cannot bypass progression unlock chains', () => {
  assert.throws(() => validators.validateOps({
    character: { id: 'c', level: 1, potions: 0, clearedStages: [] },
    ops: [
      { type: 'gainXp', amount: 0 },
      { type: 'grantGold', amount: 0 },
      { type: 'setPotions', count: 0 },
      { type: 'clearStage', stageId: 'KB' },
    ],
    context: { kind: 'settlement', stageId: 'KB', difficulty: 'normal', partySize: 1, outcome: 'clear' },
  }), /stage-locked/);
});

test('set rarity is accepted only on a non-normal boss settlement with a set base', () => {
  const stages = stageContent;
  const normalClears = stages.STAGE_LIST.map((stage) => stages.stageClearKey(stage.id, 'normal'));
  const nightmareClears = stages.STAGE_LIST
    .filter((stage) => stage.id !== 'KB')
    .map((stage) => stages.stageClearKey(stage.id, 'nightmare'));
  const character = {
    id: 'c', level: 20, potions: 0, clearedStages: [...normalClears, ...nightmareClears],
  };
  const makeOps = (key) => [
    { type: 'gainXp', amount: 0 },
    { type: 'grantGold', amount: 0 },
    { type: 'setPotions', count: 0 },
    { type: 'grantItem', uid: 'set-item', itemId: 'oath-sword', rarity: 'set', ilvl: 15, affixes: [] },
    { type: 'clearStage', stageId: key },
    { type: 'recordClear', key, ticks: 150 * stages.STAGES.KB.rooms.length },
  ];
  const nightmareKey = stages.stageClearKey('KB', 'nightmare');
  assert.doesNotThrow(() => validators.validateOps({
    character,
    ops: makeOps(nightmareKey),
    context: { kind: 'settlement', stageId: 'KB', difficulty: 'nightmare', partySize: 1, outcome: 'clear' },
  }));
  assert.throws(() => validators.validateOps({
    character: { ...character, clearedStages: normalClears },
    ops: makeOps('KB'),
    context: { kind: 'settlement', stageId: 'KB', difficulty: 'normal', partySize: 1, outcome: 'clear' },
  }), /invalid-set-item/);
});

test('commit is idempotent, revision conflicts return 409, and debug commits mark permanently', async () => {
  const env = environment();
  const auth = token({ sub: 'user-1' });
  await createCharacter(commits.onRequestPost, env, auth);
  const body = {
    characterId: 'char-1',
    baseRev: 1,
    idempotencyKey: 'grant-once',
    context: { kind: 'debug' },
    ops: [{ type: 'grantGold', amount: 50 }, { type: 'markDebug' }],
  };
  const first = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', body, auth), env,
  });
  const second = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', body, auth), env,
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const saved = await second.json();
  assert.equal(saved.character.rev, 2);
  assert.equal(saved.character.gold, 50);
  assert.equal(saved.character.debugUsed, true);
  const stale = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', { ...body, idempotencyKey: 'stale' }, auth), env,
  });
  assert.equal(stale.status, 409);
});

test('anonymous JWT claims and anonymous users rows both receive 403 login-required', async () => {
  const env = environment();
  const missing = await charactersRoute.onRequestGet({
    request: request('GET', '/api/devinarok/characters'), env,
  });
  const invalid = await charactersRoute.onRequestGet({
    request: request('GET', '/api/devinarok/characters', undefined, 'not-a-jwt'), env,
  });
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'unauthorized');
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error, 'unauthorized');
  const claimResponse = await charactersRoute.onRequestGet({
    request: request('GET', '/api/devinarok/characters', undefined, token({ sub: 'guest', isAnonymous: true })),
    env,
  });
  const rowResponse = await charactersRoute.onRequestGet({
    request: request('GET', '/api/devinarok/characters', undefined, token({ sub: 'anonymous-row' })),
    env,
  });
  assert.equal(claimResponse.status, 403);
  assert.equal((await claimResponse.json()).error, 'login-required');
  assert.equal(rowResponse.status, 403);
  assert.equal((await rowResponse.json()).error, 'login-required');
});

test('imports enforce level-XP consistency and the six-character account cap', async () => {
  const env = environment();
  const auth = token({ sub: 'user-1' });
  const makeSnapshot = (id) => ({
    character: {
      id, name: `기사${id.slice(-1)}`, kind: 'knight', level: 1, xp: 0, gold: 0,
      potions: 3, rev: 1, debugUsed: false, equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
      clearedStages: [], records: {},
    },
    items: [],
  });
  for (let index = 0; index < 6; index += 1) {
    const result = await importRoute.onRequestPost({
      request: request('POST', '/api/devinarok/import', makeSnapshot(`import-${index}`), auth),
      env,
    });
    assert.equal(result.status, 201);
  }
  const overLimit = await importRoute.onRequestPost({
    request: request('POST', '/api/devinarok/import', makeSnapshot('import-6'), auth),
    env,
  });
  assert.equal(overLimit.status, 409);
  assert.equal((await overLimit.json()).error, 'character-limit');

  const invalidXp = makeSnapshot('invalid-xp');
  invalidXp.character.level = 2;
  invalidXp.character.xp = Math.round(60 * 2 ** 1.6);
  const invalid = await importRoute.onRequestPost({
    request: request('POST', '/api/devinarok/import', invalidXp, auth),
    env,
  });
  assert.equal(invalid.status, 422);
});

test('cloud enhancement uses a server-generated roll and persists cost, revision, and result', async () => {
  const env = environment();
  const auth = token({ sub: 'user-1' });
  await createCharacter(commits.onRequestPost, env, auth);
  const setup = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', {
      characterId: 'char-1',
      baseRev: 1,
      idempotencyKey: 'enhance-fixture',
      context: { kind: 'debug' },
      ops: [
        { type: 'grantGold', amount: 200 },
        { type: 'grantItem', uid: 'enhance-item', itemId: 'rusted-sword', rarity: 'common', ilvl: 1, enhance: 1, affixes: [] },
        { type: 'markDebug' },
      ],
    }, auth),
    env,
  });
  assert.equal(setup.status, 200);
  const result = await enhanceRoute.onRequestPost({
    request: request('POST', '/api/devinarok/enhance', {
      characterId: 'char-1', baseRev: 2, uid: 'enhance-item', roll: 'client-controlled',
    }, auth),
    env,
  });
  assert.equal(result.status, 200);
  const saved = await result.json();
  assert.ok(Number.isSafeInteger(saved.roll) && saved.roll >= 0 && saved.roll < 10000);
  assert.equal(saved.success, saved.roll < 9500);
  assert.equal(saved.character.rev, 3);
  assert.equal(saved.character.gold, 40);
  assert.equal(saved.items[0].enhance, saved.success ? 2 : 1);
});
