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
const reforgeRoute = bundle('functions/api/devinarok/reforge.ts');
const validators = bundle('functions/lib/devinarok/validation.ts');
const saveOps = bundle('functions/lib/devinarok/js/save/ops.js');
const shared = bundle('functions/api/devinarok/_shared.ts');
const contractContent = bundle('functions/lib/devinarok/js/content/contracts.js');
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

test('commit returns current state when it loses a concurrent idempotent write race', async () => {
  const env = environment();
  const auth = token({ sub: 'user-1' });
  await createCharacter(commits.onRequestPost, env, auth);
  const originalBatch = env.DB.batch.bind(env.DB);
  let competingWrite = true;
  env.DB.batch = (statements) => {
    if (competingWrite) {
      competingWrite = false;
      originalBatch(statements);
    }
    return originalBatch(statements);
  };

  const result = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', {
      characterId: 'char-1',
      baseRev: 1,
      idempotencyKey: 'raced-once',
      context: { kind: 'debug' },
      ops: [{ type: 'grantGold', amount: 23 }, { type: 'markDebug' }],
    }, auth),
    env,
  });

  assert.equal(result.status, 200);
  const saved = await result.json();
  assert.equal(saved.character.rev, 2);
  assert.equal(saved.character.gold, 23);
  assert.equal(saved.character.debugUsed, true);
  assert.equal(env.DB.prepare(`SELECT COUNT(*) AS n FROM devinarok_ledger
    WHERE user_id = ? AND char_id = ? AND idem_key = ?`)
    .bind('user-1', 'char-1', 'raced-once').first().n, 1);
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

test('contract progress is bounded and claims require generated contracts on a current date', () => {
  const now = Date.now() + 20_000;
  const dateKey = contractContent.kstDateKey(now);
  const character = {
    id: 'contract-validation',
    level: 1,
    gold: 0,
    potions: 3,
    materials: { essence: 0, soul: 0 },
    clearedStages: [],
    contracts: { dateKey: null, progress: {}, claimed: [] },
  };
  const contracts = contractContent.dailyContracts(character.id, dateKey, character);
  const kills = contracts.find((contract) => contract.type === 'kills');
  const spawnCap = validators.settlementCaps('C1', 'normal', 1).enemySpawnCaps[kills.enemyKind];
  const context = {
    kind: 'settlement', stageId: 'C1', difficulty: 'normal', partySize: 1,
    outcome: 'death', ticks: 900, potionsUsed: 0,
  };
  const validateProgress = (contractId, amount, key = dateKey) => validators.validateOps({
    character,
    ops: [{ type: 'contractProgress', dateKey: key, contractId, amount }],
    context,
    now,
  });

  assert.ok(spawnCap > 0);
  assert.doesNotThrow(() => validateProgress(kills.id, 1));
  assert.throws(() => validateProgress(kills.id, spawnCap + 1), /contract-progress-cap-exceeded/);
  assert.throws(() => validateProgress(`${dateKey}:foreign`, 1), /invalid-contract/);
  const staleDate = contractContent.kstDateKey(now - 2 * 24 * 60 * 60 * 1000);
  assert.throws(() => validateProgress(`${staleDate}:0`, 1, staleDate), /stale-contract-date/);

  const claim = contracts[0];
  const progressed = saveOps.applyOperations(character, {}, [{
    type: 'contractDay', dateKey,
  }, {
    type: 'contractProgress', dateKey, contractId: claim.id, amount: claim.target,
  }], character.id).character;
  assert.doesNotThrow(() => validators.validateOps({
    character: progressed,
    ops: [{ type: 'claimContract', dateKey, contractId: claim.id }],
    context: { kind: 'hub' },
    now,
  }));
  const claimed = saveOps.applyOperations(progressed, {}, [{
    type: 'claimContract', dateKey, contractId: claim.id,
  }], character.id).character;
  assert.equal(claimed.contracts.claimed.includes(claim.id), true);
  assert.equal(claimed.materials.essence, claim.rewards.essence);
  assert.equal(claimed.gold, claim.rewards.gold);
});

test('materials are bounded on import and stored character reads', async () => {
  const env = environment();
  const auth = token({ sub: 'user-1' });
  const snapshot = {
    character: {
      id: 'invalid-materials',
      name: '기사',
      kind: 'knight',
      level: 1,
      xp: 0,
      gold: 0,
      potions: 3,
      rev: 1,
      debugUsed: false,
      equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
      clearedStages: [],
      records: {},
      materials: { essence: 1.5, soul: 0 },
    },
    items: [],
  };
  const invalidImport = await importRoute.onRequestPost({
    request: request('POST', '/api/devinarok/import', snapshot, auth),
    env,
  });
  assert.equal(invalidImport.status, 422);

  await createCharacter(commits.onRequestPost, env, auth);
  const row = env.DB.prepare('SELECT data_json FROM devinarok_characters WHERE user_id = ? AND char_id = ?')
    .bind('user-1', 'char-1').first();
  const stored = JSON.parse(row.data_json);
  stored.materials = { essence: 10000, soul: 0 };
  env.DB.prepare('UPDATE devinarok_characters SET data_json = ? WHERE user_id = ? AND char_id = ?')
    .bind(JSON.stringify(stored), 'user-1', 'char-1').run();
  const invalidState = await charactersRoute.onRequestGet({
    request: request('GET', '/api/devinarok/characters', undefined, auth),
    env,
  });
  assert.equal(invalidState.status, 422);
  assert.equal((await invalidState.json()).error, 'invalid-materials');
});

test('contract basis rejects cleared stages absent from the character', () => {
  const now = Date.now() + 20_000;
  const dateKey = contractContent.kstDateKey(now);
  const character = {
    id: 'invalid-contract-basis', name: '기사', kind: 'knight', level: 1, xp: 0, gold: 0,
    potions: 3, rev: 1, debugUsed: false, equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
    records: {}, clearedStages: [], materials: { essence: 0, soul: 0 },
    contracts: { dateKey, progress: {}, claimed: [], basis: { clearedStages: ['C1'], level: 1 } },
  };
  assert.throws(() => validators.validateImport({ character, items: [] }), /invalid-contracts/);
});

test('settlement accepts contractDay before clear operations and snapshots pre-settlement state', () => {
  const now = Date.now() + 20_000;
  const dateKey = contractContent.kstDateKey(now);
  const character = {
    id: 'contract-day-settlement', level: 1, gold: 0, potions: 3, materials: { essence: 0, soul: 0 },
    clearedStages: [], contracts: { dateKey: '2026-04-01', progress: { old: 2 }, claimed: ['old'], basis: null },
  };
  const key = stageContent.stageClearKey('C1', 'normal');
  const ops = [
    { type: 'contractDay', dateKey },
    { type: 'clearStage', stageId: 'C1' },
    { type: 'recordClear', key, ticks: 900 },
  ];
  const context = { kind: 'settlement', stageId: 'C1', difficulty: 'normal', partySize: 1, outcome: 'clear', ticks: 900, potionsUsed: 0 };
  assert.doesNotThrow(() => validators.validateOps({ character, ops, context, now }));
  const result = saveOps.applyOperations(character, {}, ops, character.id).character;
  assert.deepEqual(result.contracts.basis, { clearedStages: [], level: 1 });
  assert.ok(result.clearedStages.includes('C1'));
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

test('cloud reforge uses a server roll, revision guard, and rejects guests', async () => {
  const env = environment();
  const auth = token({ sub: 'user-1' });
  await createCharacter(commits.onRequestPost, env, auth);
  const affixId = Object.keys(affixContent.AFFIXES)[0];
  const setup = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', {
      characterId: 'char-1',
      baseRev: 1,
      idempotencyKey: 'reforge-fixture',
      context: { kind: 'debug' },
      ops: [
        { type: 'grantGold', amount: 1000 },
        {
          type: 'grantItem',
          uid: 'reforge-item',
          itemId: 'rusted-sword',
          rarity: 'rare',
          ilvl: 1,
          enhance: 0,
          affixes: [{ id: affixId, value: 1 }],
        },
        { type: 'markDebug' },
      ],
    }, auth),
    env,
  });
  assert.equal(setup.status, 200);
  const row = env.DB.prepare('SELECT data_json FROM devinarok_characters WHERE user_id = ? AND char_id = ?')
    .bind('user-1', 'char-1').first();
  const stored = JSON.parse(row.data_json);
  stored.materials = { essence: 10, soul: 0 };
  env.DB.prepare('UPDATE devinarok_characters SET data_json = ? WHERE user_id = ? AND char_id = ?')
    .bind(JSON.stringify(stored), 'user-1', 'char-1').run();

  const commitReforge = await commits.onRequestPost({
    request: request('POST', '/api/devinarok/commit', {
      characterId: 'char-1',
      baseRev: 2,
      idempotencyKey: 'commit-reforge-denied',
      context: { kind: 'hub' },
      ops: [{ type: 'reforgeAffix', uid: 'reforge-item', index: 0, roll: 1 }],
    }, auth),
    env,
  });
  assert.equal(commitReforge.status, 400);
  assert.equal((await commitReforge.json()).error, 'online-reforge-required');

  const conflict = await reforgeRoute.onRequestPost({
    request: request('POST', '/api/devinarok/reforge', {
      characterId: 'char-1', baseRev: 1, uid: 'reforge-item', index: 0,
    }, auth),
    env,
  });
  assert.equal(conflict.status, 409);

  const result = await reforgeRoute.onRequestPost({
    request: request('POST', '/api/devinarok/reforge', {
      characterId: 'char-1', baseRev: 2, uid: 'reforge-item', index: 0, roll: 1,
    }, auth),
    env,
  });
  assert.equal(result.status, 200);
  const saved = await result.json();
  assert.ok(Number.isInteger(saved.roll) && saved.roll >= 0 && saved.roll <= 0xffffffff);
  assert.equal(saved.character.rev, 3);
  assert.equal(saved.character.gold, 980);
  assert.equal(saved.character.materials.essence, 6);
  assert.notEqual(saved.items[0].affixes[0].id, affixId);

  const guest = await reforgeRoute.onRequestPost({
    request: request('POST', '/api/devinarok/reforge', {
      characterId: 'char-1', baseRev: 3, uid: 'reforge-item', index: 0,
    }, token({ sub: 'guest', isAnonymous: true })),
    env,
  });
  assert.equal(guest.status, 403);
});

test('legendary unique affixes cannot be reforged and other reforges pass item validation', () => {
  const legendary = itemContent.LEGENDARIES.find(({ id }) => id === 'spinning-sigil');
  const otherId = Object.keys(affixContent.AFFIXES).find((id) => id !== legendary.stat);
  const rule = affixContent.AFFIXES[otherId];
  const unique = { id: legendary.stat, value: legendary.value, unique: legendary.id };
  const character = {
    id: 'unique-reforge', name: '기사', kind: 'knight', level: 5, xp: 0, gold: 1000, potions: 3, rev: 1,
    debugUsed: false, equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
    clearedStages: [], records: {}, materials: { essence: 100, soul: 10 },
  };
  const item = {
    uid: 'legendary-unique', itemId: 'rusted-sword', rarity: 'legendary', ilvl: 5, enhance: 0,
    legendaryId: legendary.id,
    affixes: [unique, { id: otherId, value: Math.round(rule.min + rule.perIlvl * 5) }],
  };
  const state = saveOps.applyOperations(character, {}, [{ type: 'grantItem', ...item }], character.id);
  assert.throws(() => saveOps.applyOperations(state.character, state.items, [
    { type: 'reforgeAffix', uid: item.uid, index: 0, roll: 1 },
  ], character.id), { name: 'RangeError', message: 'Unique affixes cannot be reforged' });
  const reforged = saveOps.applyOperations(state.character, state.items, [
    { type: 'reforgeAffix', uid: item.uid, index: 1, roll: 1 },
  ], character.id);
  assert.deepEqual(reforged.items[item.uid].affixes[0], unique);
  assert.equal(reforged.items[item.uid].legendaryId, legendary.id);
  assert.doesNotThrow(() => validators.validateImport({
    character: reforged.character,
    items: Object.values(reforged.items),
  }));
});
