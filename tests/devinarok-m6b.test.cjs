const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'));

const ROOT = path.join(__dirname, '..');

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

const { applyOperations, normalizeCharacter } = bundle('functions/lib/devinarok/js/save/ops.js');
const { MASTERY_MIN_COOLDOWN_TICKS } = bundle('functions/lib/devinarok/js/content/mastery.js');
const validators = bundle('functions/lib/devinarok/validation.ts');
const { SKILLS } = bundle('functions/lib/devinarok/js/content/skills.js');

function character(mastery = {}) {
  return {
    id: 'mastery-hero',
    name: '숙련자',
    kind: 'knight',
    level: 1,
    xp: 0,
    gold: 0,
    potions: 0,
    rev: 1,
    debugUsed: false,
    equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
    clearedStages: [],
    records: {},
    mastery,
  };
}

test('server normalizes stored mastery and rejects invalid imported mastery', () => {
  const normalized = normalizeCharacter(character({
    spin: 400,
    dash: -2,
    guard: 1.5,
    unknown: 12,
  }));
  assert.equal(normalized.mastery.spin, 300);
  assert.equal(normalized.mastery.dash, 0);
  assert.equal(normalized.mastery.guard, 0);
  assert.equal(normalized.mastery.unknown, undefined);
  assert.equal(Object.keys(normalized.mastery).length, Object.keys(SKILLS).length);

  assert.doesNotThrow(() => validators.validateImport({
    character: character({ spin: 300 }),
    items: [],
  }));
  for (const mastery of [
    { spin: -1 },
    { spin: 301 },
    { spin: 1.5 },
    { unknown: 1 },
    [],
    null,
  ]) {
    assert.throws(
      () => validators.validateImport({ character: character(mastery), items: [] }),
      /invalid-mastery/,
    );
  }
});

test('gainMastery is settlement-only, capped by cooldown, and unique per skill', () => {
  const ticks = 600;
  const cap = Math.min(60, Math.floor(ticks / MASTERY_MIN_COOLDOWN_TICKS('spin')) + 1);
  const context = {
    kind: 'settlement',
    stageId: 'C1',
    difficulty: 'normal',
    partySize: 1,
    outcome: 'death',
    ticks,
  };
  const validate = (ops) => validators.validateOps({
    character: character(),
    ops,
    context,
    lastSettlementAt: 0,
    now: 100_000,
  });

  assert.doesNotThrow(() => validate([{ type: 'gainMastery', skill: 'spin', amount: cap }]));
  assert.throws(() => validate([{ type: 'gainMastery', skill: 'spin', amount: cap + 1 }]), /mastery-cap-exceeded/);
  assert.throws(() => validate([
    { type: 'gainMastery', skill: 'spin', amount: 1 },
    { type: 'gainMastery', skill: 'spin', amount: 1 },
  ]), /duplicate-mastery-gain/);
  assert.throws(() => validate([{ type: 'gainMastery', skill: 'unknown', amount: 1 }]), /invalid-mastery/);

  assert.doesNotThrow(() => validators.validateOps({
    ops: [{ type: 'setMastery', skill: 'spin', xp: 300 }, { type: 'markDebug' }],
    context: { kind: 'debug' },
  }));
  assert.throws(() => validators.validateOps({
    ops: [{ type: 'gainMastery', skill: 'spin', amount: 1 }, { type: 'markDebug' }],
    context: { kind: 'debug' },
  }), /invalid-contract-context/);
  assert.throws(() => validators.validateOps({
    character: character(),
    ops: [{ type: 'setMastery', skill: 'spin', xp: 300 }],
    context: { kind: 'hub' },
  }), /hub-op-not-allowed/);
});

test('local save reducer clamps mastery gains and rejects unknown skill keys', () => {
  const gained = applyOperations(character({ spin: 295 }), {}, [
    { type: 'gainMastery', skill: 'spin', amount: 12 },
  ], 'mastery-hero');
  assert.equal(gained.character.mastery.spin, 300);
  assert.throws(() => applyOperations(character(), {}, [
    { type: 'gainMastery', skill: 'invalid', amount: 1 },
  ], 'mastery-hero'), /Invalid mastery skill/);
});
