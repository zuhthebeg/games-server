const FLOOR_MODELS = {
  stone: 'assets/env/floor_tile_large.glb',
  broken: 'assets/env/floor_tile_large_rocks.glb',
  dirt: 'assets/env/floor_dirt_large.glb',
  rockyDirt: 'assets/env/floor_dirt_large_rocky.glb',
  brokenSmall: 'assets/env/floor_tile_small_broken_A.glb',
  wood: 'assets/env/floor_wood_large.glb',
  darkWood: 'assets/env/floor_wood_large_dark.glb',
};

function floorForRoom(room, width, depth) {
  const props = [];
  const columns = Math.ceil(width / 4);
  const rows = Math.ceil(depth / 4);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = -width / 2 + 2 + column * 4;
      const z = room.centerZ - depth / 2 + 2 + row * 4;
      const tile = room.theme === 'inn'
        ? ((column + row) % 4 === 0 ? FLOOR_MODELS.darkWood : FLOOR_MODELS.wood)
        : room.theme === 'corridor'
          ? ((column + row * 2) % 5 === 0 ? FLOOR_MODELS.rockyDirt : column % 3 === 1 ? FLOOR_MODELS.dirt : FLOOR_MODELS.stone)
          : room.theme === 'collapsed'
            ? ((column * 3 + row) % 4 === 0 ? FLOOR_MODELS.rockyDirt : FLOOR_MODELS.broken)
            : room.theme === 'ossuary'
              ? ((column + row) % 4 === 0 ? FLOOR_MODELS.dirt : (column + row) % 2 === 0 ? FLOOR_MODELS.broken : FLOOR_MODELS.stone)
              : (column + row * 2) % 6 === 0 ? FLOOR_MODELS.rockyDirt : (column + row) % 4 === 0 ? FLOOR_MODELS.broken : FLOOR_MODELS.stone;
      props.push({
        model: tile,
        x,
        z,
        rotY: ((column + row) % 4) * Math.PI / 2,
        roomId: room.id,
      });
      if (room.theme !== 'inn' && (column + row * 2) % 5 === 0) {
        props.push({ model: FLOOR_MODELS.brokenSmall, x: x + 1, y: 0.035, z: z + 1, rotY: ((column + row) % 4) * Math.PI / 2, roomId: room.id });
      }
    }
  }
  return props;
}

function wallRow(room, xPositions, z, hasDoor, doors, obstacles, props) {
  for (const x of xPositions) {
    if (hasDoor && Math.abs(x) < 1) {
      props.push({ model: 'assets/env/wall_doorway.glb', x, z, rotY: 0, roomId: room.id });
      const door = {
        id: `${room.id}-door`,
        fromRoom: room.id,
        toRoom: room.nextRoomId,
        x,
        z,
        open: false,
      };
      doors.push(door);
      obstacles.push({ id: `${door.id}-gate`, type: 'rect', x, z, width: 2.6, depth: 0.55, doorId: door.id });
      props.push({ model: 'assets/env/wall.glb', x, z, rotY: 0, doorId: door.id, obstacleId: `${door.id}-gate`, roomId: room.id });
    } else {
      const besideDoor = hasDoor && Math.abs(x) === 2;
      props.push({
        model: 'assets/env/wall.glb',
        x: besideDoor ? x + (x < 0 ? -1 : 1) : x,
        z,
        rotY: 0,
        scaleX: besideDoor ? 0.5 : 1,
        scaleY: 1,
        scaleZ: 1,
        roomId: room.id,
      });
    }
  }
}

function buildRoomArt(room, { width, depth, lastRoom }) {
  const props = floorForRoom(room, width, depth);
  const obstacles = [];
  const doors = [];
  const xWalls = [];
  for (let x = -width / 2 + 2; x <= width / 2 - 2; x += 4) xWalls.push(x);
  if (room.nextRoomId) xWalls.push(0);
  xWalls.sort((left, right) => left - right);

  const sideWallModels = room.theme === 'corridor'
    ? ['assets/env/wall_broken.glb', 'assets/env/wall_cracked.glb']
    : room.theme === 'ossuary'
      ? ['assets/env/wall_shelves.glb', 'assets/env/wall_archedwindow_open.glb']
      : room.theme === 'hall'
        ? ['assets/env/wall_arched.glb', 'assets/env/wall_cracked.glb']
        : ['assets/env/wall_archedwindow_open.glb', 'assets/env/wall_cracked.glb'];
  for (let z = room.centerZ - depth / 2 + 2; z <= room.centerZ + depth / 2 - 2; z += 4) {
    const sideWall = sideWallModels[Math.abs(Math.round(z)) % sideWallModels.length];
    props.push({ model: sideWall, x: -width / 2 - 0.5, z, rotY: Math.PI / 2, wallSide: true, wallCenterZ: z, roomId: room.id });
    props.push({ model: sideWall, x: width / 2 + 0.5, z, rotY: -Math.PI / 2, wallSide: true, wallCenterZ: z, roomId: room.id });
  }

  wallRow(room, xWalls, room.centerZ - depth / 2 - 0.5, !lastRoom && Boolean(room.nextRoomId), doors, obstacles, props);
  const backWall = room.theme === 'corridor'
    ? 'assets/env/wall_broken.glb'
    : room.theme === 'ossuary'
      ? 'assets/env/wall_archedwindow_open.glb'
      : room.theme === 'hall'
        ? 'assets/env/wall_arched.glb'
        : 'assets/env/wall_cracked.glb';
  for (const prop of props) {
    if (prop.roomId === room.id && prop.z === room.centerZ - depth / 2 - 0.5 && prop.model === 'assets/env/wall.glb') {
      prop.model = backWall;
    }
  }
  props.push(
    { model: 'assets/env/wall_corner.glb', x: -width / 2 - 0.5, z: room.centerZ - depth / 2 - 0.5, rotY: 0, roomId: room.id },
    { model: 'assets/env/wall_corner.glb', x: width / 2 + 0.5, z: room.centerZ - depth / 2 - 0.5, rotY: Math.PI / 2, roomId: room.id },
  );

  const columns = [
    [-width / 2 + 4.8, room.centerZ - depth / 2 + 5],
    [width / 2 - 4.8, room.centerZ - depth / 2 + 5],
    [-width / 2 + 4.8, room.centerZ + depth / 2 - 5],
    [width / 2 - 4.8, room.centerZ + depth / 2 - 5],
  ];
  columns.forEach(([x, z], index) => {
    const id = `${room.id}-pillar-${index}`;
    obstacles.push({ id, type: 'circle', x, z, radius: 0.72 });
    props.push({ model: 'assets/env/column.glb', x, z, rotY: 0, obstacleId: id, roomId: room.id });
  });

  const crates = room.theme === 'collapsed' || room.theme === 'ossuary';
  if (crates) {
    const x = room.index % 2 ? 3.6 : -3.6;
    const z = room.centerZ + 0.5;
    const id = `${room.id}-crates`;
    obstacles.push({ id, type: 'rect', x, z, width: 1.35, depth: 1.2 });
    props.push({ model: 'assets/env/crates_stacked.glb', x, z, rotY: room.index % 2 ? 0 : Math.PI, obstacleId: id, roomId: room.id });
  } else {
    const x = room.index % 2 ? -3.5 : 3.5;
    const z = room.centerZ + 1;
    const id = `${room.id}-barrel`;
    obstacles.push({ id, type: 'circle', x, z, radius: 0.58 });
    props.push({ model: 'assets/env/barrel_large.glb', x, z, rotY: 0, obstacleId: id, roomId: room.id });
  }

  const lantern = room.theme === 'ossuary' ? 'assets/env/candle_lit.glb' : 'assets/env/torch_lit.glb';
  for (const x of [-width / 2 + 1.4, width / 2 - 1.4]) {
    for (const z of [room.centerZ - depth / 2 + 1.8, room.centerZ + depth / 2 - 1.8]) {
      props.push({ model: lantern, x, z, rotY: x < 0 ? 0 : Math.PI, roomId: room.id });
    }
    props.push({ model: 'assets/env/torch_mounted.glb', x, z: room.centerZ - depth / 2 + 4.4, rotY: x < 0 ? Math.PI / 2 : -Math.PI / 2, wallLight: true, roomId: room.id });
  }
  const stageDecor = {
    stone: [
      ['assets/env/banner_patternA_red.glb', -5.6, room.centerZ - 7],
      ['assets/env/banner_shield_red.glb', 5.6, room.centerZ - 7],
      ['assets/env/crates_stacked.glb', -5.2, room.centerZ + 1],
      ['assets/env/barrel_large.glb', 5.4, room.centerZ + 2],
      ['assets/env/stairs_wide.glb', 0, room.centerZ - 8],
      ['assets/env/rubble_half.glb', 5.6, room.centerZ + 6],
    ],
    entrance: [
      ['assets/env/banner_patternA_red.glb', -5.6, room.centerZ - 7],
      ['assets/env/banner_shield_red.glb', 5.6, room.centerZ - 7],
      ['assets/env/crates_stacked.glb', -5.2, room.centerZ + 1],
      ['assets/env/keg.glb', 5.4, room.centerZ + 2],
      ['assets/env/chest.glb', -5.6, room.centerZ + 6],
    ],
    corridor: [
      ['assets/env/banner_patternB_blue.glb', -5.8, room.centerZ - 6],
      ['assets/env/banner_patternB_blue.glb', 5.8, room.centerZ + 5],
      ['assets/env/rubble_large.glb', -5.3, room.centerZ + 1],
      ['assets/env/rubble_half.glb', 5.3, room.centerZ - 2],
      ['assets/env/wall_cracked.glb', 0, room.centerZ - 9],
      ['assets/env/keg_decorated.glb', 5.6, room.centerZ + 7],
    ],
    collapsed: [
      ['assets/env/banner_patternA_red.glb', -5.6, room.centerZ - 7],
      ['assets/env/rubble_large.glb', -5.2, room.centerZ + 2],
      ['assets/env/rubble_half.glb', 5.5, room.centerZ - 1],
      ['assets/env/keg_decorated.glb', 5.4, room.centerZ + 6],
      ['assets/env/chest_gold.glb', -5.6, room.centerZ + 7],
      ['assets/env/wall_broken.glb', 0, room.centerZ - 9],
    ],
    ossuary: [
      ['assets/env/shelf_large.glb', -6.1, room.centerZ - 4],
      ['assets/env/shelf_large.glb', 6.1, room.centerZ - 4],
      ['assets/env/shelf_small_candles.glb', -6.1, room.centerZ + 4],
      ['assets/env/shelf_small_candles.glb', 6.1, room.centerZ + 4],
      ['assets/env/table_small_decorated_A.glb', 0, room.centerZ - 7],
      ['assets/env/rubble_half.glb', 5.5, room.centerZ + 7],
    ],
    hall: [
      ['assets/env/banner_patternA_red.glb', -6.5, room.centerZ - 7],
      ['assets/env/banner_shield_red.glb', 6.5, room.centerZ - 7],
      ['assets/env/stairs_wide.glb', 0, room.centerZ - 8],
      ['assets/env/chest_gold.glb', 0, room.centerZ - 6],
      ['assets/env/shelf_large.glb', -7, room.centerZ - 3],
    ],
  }[room.theme] ?? [];
  const mirrorDecor = room.index % 2 === 1;
  const decorZOffset = room.index === 0 ? 0 : mirrorDecor ? 1.25 : -1.25;
  for (const [model, x, z] of stageDecor) {
    props.push({ model, x: mirrorDecor ? -x : x, z: z + decorZOffset, rotY: mirrorDecor ? Math.PI : 0, roomId: room.id });
  }

  return { props, obstacles, doors };
}

function makeStage(id, name, stageLevel, recommendedLevel, rooms, { boss = false } = {}) {
  const width = boss ? 20 : 16;
  const depth = 20;
  const roomGap = depth;
  const arranged = rooms.map((room, index) => ({
    ...room,
    id: `${id.toLowerCase()}-room-${index + 1}`,
    index,
    centerZ: -index * roomGap,
    nextRoomId: rooms[index + 1] ? `${id.toLowerCase()}-room-${index + 2}` : null,
  }));
  const props = [];
  const obstacles = [];
  const doors = [];
  for (const [index, room] of arranged.entries()) {
    const art = buildRoomArt(room, { width, depth, lastRoom: index === arranged.length - 1 });
    props.push(...art.props);
    obstacles.push(...art.obstacles);
    doors.push(...art.doors);
  }
  const xMin = -width / 2;
  const xMax = width / 2;
  const minZ = arranged.at(-1).centerZ - depth / 2;
  const maxZ = depth / 2;
  const spawnPoints = arranged.map((room) => [
    { x: -width / 2 + 3, z: room.centerZ - 5 },
    { x: 0, z: room.centerZ - 7 },
    { x: width / 2 - 3, z: room.centerZ - 5 },
    { x: -width / 2 + 3, z: room.centerZ + 5 },
    { x: width / 2 - 3, z: room.centerZ + 5 },
  ]);
  return {
    id,
    name,
    stageLevel,
    recommendedLevel,
    boss,
    width,
    depth: arranged.length * depth,
    bounds: { minX: xMin, maxX: xMax, minZ, maxZ },
    playerSpawn: { x: 0, z: 7 },
    spawnPoints,
    rooms: arranged,
    doors,
    obstacles,
    props,
  };
}

export const STAGE_LIST = [
  makeStage('C1', '묘지 입구', 1, 1, [
    { theme: 'entrance', waves: [{ enemy: 'minion', count: 6 }] },
    { theme: 'collapsed', waves: [{ enemy: 'minion', count: 5 }, { enemy: 'warrior', count: 2 }] },
  ]),
  makeStage('C2', '무너진 회랑', 3, 3, [
    { theme: 'corridor', waves: [{ enemy: 'minion', count: 5 }, { enemy: 'rogue', count: 2 }] },
    { theme: 'collapsed', waves: [{ enemy: 'minion', count: 4 }, { enemy: 'rogue', count: 3 }] },
    { theme: 'corridor', waves: [{ enemy: 'minion', count: 4 }, { enemy: 'mage', count: 2 }] },
  ]),
  makeStage('C3', '납골당', 5, 5, [
    { theme: 'ossuary', waves: [{ enemy: 'minion', count: 4 }, { enemy: 'rogue', count: 2 }] },
    { theme: 'collapsed', waves: [{ enemy: 'warrior', count: 3 }, { enemy: 'mage', count: 2 }] },
    { theme: 'ossuary', waves: [{ enemy: 'minion', count: 3 }, { enemy: 'rogue', count: 2 }, { enemy: 'warrior', count: 1 }, { enemy: 'mage', count: 1 }] },
  ]),
  makeStage('CB', '기사단장의 전당', 7, 7, [
    { theme: 'hall', waves: [{ enemy: 'commander', count: 1 }] },
  ], { boss: true }),
];

export const STAGES = Object.fromEntries(STAGE_LIST.map((stage) => [stage.id, stage]));

const hubProps = [];
for (let x = -8; x <= 8; x += 4) {
  for (let z = -8; z <= 8; z += 4) {
    hubProps.push({ model: (x + z) % 8 === 0 ? FLOOR_MODELS.darkWood : FLOOR_MODELS.wood, x, z, rotY: 0 });
  }
}
hubProps.push(
  ...[-6, -2, 2, 6].map((x) => ({ model: 'assets/env/wall_archedwindow_open.glb', x, z: -10.5, rotY: 0 })),
  ...[-7, -3, 1, 5].flatMap((z) => [
    { model: 'assets/env/wall_cracked.glb', x: -10.5, z, rotY: Math.PI / 2, wallSide: true, wallCenterZ: z },
    { model: 'assets/env/wall_cracked.glb', x: 10.5, z, rotY: -Math.PI / 2, wallSide: true, wallCenterZ: z },
  ]),
  { model: 'assets/env/wall_half.glb', x: -6, z: 10.5, rotY: 0 },
  { model: 'assets/env/wall_half.glb', x: 6, z: 10.5, rotY: 0 },
  { model: 'assets/env/banner_patternA_red.glb', x: -6, z: -9.7, rotY: Math.PI },
  { model: 'assets/env/banner_shield_red.glb', x: 6, z: -9.7, rotY: Math.PI },
  { model: 'assets/env/torch_mounted.glb', x: -8.5, z: -9, rotY: Math.PI / 2, wallLight: true },
  { model: 'assets/env/torch_mounted.glb', x: 8.5, z: -9, rotY: -Math.PI / 2, wallLight: true },
  { model: 'assets/env/torch_lit.glb', x: -8, z: 1, rotY: 0 },
  { model: 'assets/env/torch_lit.glb', x: 8, z: 1, rotY: 0 },
  { model: 'assets/env/candle_lit.glb', x: -8, z: 8, rotY: 0 },
  { model: 'assets/env/candle_lit.glb', x: 8, z: 8, rotY: 0 },
  { model: 'assets/env/table_long_decorated_A.glb', x: 0, z: -8, rotY: 0 },
  { model: 'assets/env/table_medium_decorated_A.glb', x: -3, z: -3.5, rotY: Math.PI / 2 },
  { model: 'assets/env/table_medium_decorated_A.glb', x: 3, z: -3.5, rotY: -Math.PI / 2 },
  { model: 'assets/env/table_small_decorated_A.glb', x: 0, z: -5.5, rotY: 0 },
  { model: 'assets/env/chair.glb', x: -2, z: -5.5, rotY: Math.PI / 2 },
  { model: 'assets/env/chair.glb', x: 2, z: -5.5, rotY: -Math.PI / 2 },
  { model: 'assets/env/chest.glb', x: -8, z: 4, rotY: Math.PI / 2 },
  { model: 'assets/env/stool.glb', x: -6, z: -1, rotY: 0 },
  { model: 'assets/env/stool.glb', x: 5.5, z: -2.5, rotY: 0 },
  { model: 'assets/env/shelf_large.glb', x: 5.3, z: -5.5, rotY: -Math.PI / 2 },
  { model: 'assets/env/keg_decorated.glb', x: -8, z: -4.5, rotY: 0 },
  { model: 'assets/env/barrel_large.glb', x: 8, z: 4, rotY: 0 },
  { model: 'assets/env/crates_stacked.glb', x: -5, z: -1, rotY: 0, obstacleId: 'hub-crates' },
  { model: 'assets/env/barrel_large.glb', x: 5, z: 1, rotY: 0, obstacleId: 'hub-barrel' },
  { model: 'assets/env/column.glb', x: -5, z: -6, rotY: 0, obstacleId: 'hub-pillar-left' },
  { model: 'assets/env/column.glb', x: 5, z: -6, rotY: 0, obstacleId: 'hub-pillar-right' },
);

export const HUB_ARENA = {
  id: 'inn-hub',
  width: 20,
  depth: 20,
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  playerSpawn: { x: 0, z: 3 },
  spawnPoints: [],
  rooms: [],
  doors: [],
  obstacles: [
    { id: 'hub-crates', type: 'rect', x: -5, z: -1, width: 1.6, depth: 1.2 },
    { id: 'hub-barrel', type: 'circle', x: 5, z: 1, radius: 0.65 },
    { id: 'hub-pillar-left', type: 'circle', x: -5, z: -6, radius: 0.72 },
    { id: 'hub-pillar-right', type: 'circle', x: 5, z: -6, radius: 0.72 },
  ],
  props: hubProps,
  npcs: [
    { id: 'blacksmith', name: '대장장이', model: 'Barbarian', x: -2.2, z: -3, rotY: Math.PI / 2, panel: 'blacksmith' },
    { id: 'merchant', name: '상인', model: 'Rogue_Hooded', x: 2.2, z: -3, rotY: -Math.PI / 2, panel: 'merchant' },
    { id: 'innkeeper', name: '주인', model: 'Mage', x: 0, z: -7, rotY: Math.PI, panel: 'board' },
  ],
};
