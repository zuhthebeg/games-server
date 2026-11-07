export const PROTOCOL_VERSION = 1;

const ENTITY_FIELDS = [
  'id',
  'kind',
  'x',
  'z',
  'facing',
  'hp',
  'state',
  'anim',
  'attackPhase',
  'attackPattern',
  'attackShape',
  'attackRemaining',
  'skill',
  'dodge',
  'downed',
  'ownerId',
  'model',
  'maxHp',
  'name',
  'item',
  'radius',
  'motion',
  'characterKind',
  'family',
  'look',
  'slowTicks',
];

const ENTITY_FIELD_SET = new Set(ENTITY_FIELDS);
const POSITION_KEYS = new Set(['x', 'z', 'originX', 'originZ']);
const ANGLE_KEYS = new Set(['angle', 'facing']);
const ENTITY_DEFAULTS = {
  x: 0,
  z: 0,
  facing: 0,
  hp: 0,
  state: 'idle',
  anim: 'idle',
  dead: false,
  invulnerable: false,
  spawnTicksLeft: 0,
  attackPhase: null,
  attackPattern: null,
  attackShape: null,
  attackRemaining: 0,
  skill: null,
  dodge: false,
  downed: false,
  teleport: false,
  roomChanged: false,
};

export function roundToHundredth(value) {
  return Math.round(value * 100) / 100;
}

function quantizeSpatialValues(value, key = '') {
  if (Array.isArray(value)) return value.map((entry) => quantizeSpatialValues(entry));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number' && Number.isFinite(value) && (POSITION_KEYS.has(key) || ANGLE_KEYS.has(key))) {
      return roundToHundredth(value);
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => (
    [childKey, quantizeSpatialValues(childValue, childKey)]
  )));
}

export function compactEntity(entity, omitDefaults = false) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    throw new TypeError('Entity must be an object');
  }
  const rounded = quantizeSpatialValues(entity);
  let mask = 0;
  const values = [];
  const extras = {};
  for (const [key, value] of Object.entries(rounded)) {
    if (omitDefaults && Object.hasOwn(ENTITY_DEFAULTS, key) && value === ENTITY_DEFAULTS[key]) continue;
    const index = ENTITY_FIELDS.indexOf(key);
    if (index < 0) {
      extras[key] = value;
      continue;
    }
    mask |= 1 << index;
  }
  for (let index = 0; index < ENTITY_FIELDS.length; index += 1) {
    if (mask & (1 << index)) values.push(rounded[ENTITY_FIELDS[index]]);
  }
  return [mask >>> 0, ...values, extras];
}

export function expandEntity(compact) {
  if (!Array.isArray(compact) || !Number.isInteger(compact[0])) {
    throw new TypeError('Compact entity must be an array');
  }
  const mask = compact[0] >>> 0;
  const result = {};
  let valueIndex = 1;
  for (let index = 0; index < ENTITY_FIELDS.length; index += 1) {
    if (mask & (1 << index)) result[ENTITY_FIELDS[index]] = compact[valueIndex++];
  }
  const extras = compact[valueIndex];
  if (extras && typeof extras === 'object' && !Array.isArray(extras)) Object.assign(result, extras);
  return result;
}

export function encodeMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('Protocol message must be an object');
  }
  const rounded = quantizeSpatialValues(message);
  if (rounded.t === 'snap' && Array.isArray(rounded.ents)) {
    rounded.ents = rounded.ents.map((entity) => compactEntity(entity, rounded.full === true));
  }
  return JSON.stringify(rounded);
}

export function decodeMessage(frame) {
  if (typeof frame !== 'string') throw new TypeError('Protocol frame must be JSON text');
  const message = JSON.parse(frame);
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('Protocol frame must contain an object');
  }
  if (message.t === 'snap' && Array.isArray(message.ents)) {
    message.ents = message.ents.map(expandEntity);
    if (message.full) {
      message.ents = message.ents.map((entity) => ({ ...ENTITY_DEFAULTS, ...entity }));
    }
  }
  return message;
}

export const encodeFrame = encodeMessage;
export const decodeFrame = decodeMessage;
