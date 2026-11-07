const FLOOR_MODELS = {
  stone: 'assets/env/floor_tile_large.glb',
  broken: 'assets/env/floor_tile_large_rocks.glb',
  dirt: 'assets/env/floor_dirt_large.glb',
  rockyDirt: 'assets/env/floor_dirt_large_rocky.glb',
  brokenSmall: 'assets/env/floor_tile_small_broken_A.glb',
  wood: 'assets/env/floor_wood_large.glb',
  darkWood: 'assets/env/floor_wood_large_dark.glb',
};

export const PROP_FOOTPRINTS = {
  'assets/env/column.glb': { type: 'circle', radius: 0.3 },
  'assets/env/barrel_large.glb': { type: 'circle', radius: 0.77 },
  'assets/env/crates_stacked.glb': { type: 'rect', width: 1.78, depth: 1.91 },
  'assets/env/keg.glb': { type: 'rect', width: 1.53, depth: 1.7 },
  'assets/env/chest.glb': { type: 'rect', width: 1.45, depth: 1.23 },
  'assets/env/rubble_large.glb': { type: 'rect', width: 6.91, depth: 2.71 },
  'assets/env/keg_decorated.glb': { type: 'rect', width: 2.99, depth: 1.7 },
  'assets/env/chest_gold.glb': { type: 'rect', width: 1.45, depth: 1.23 },
  'assets/env/shelf_large.glb': { type: 'rect', width: 1.7, depth: 0.43 },
  'assets/env/shelf_small_candles.glb': { type: 'rect', width: 0.85, depth: 0.43 },
  'assets/env/table_small_decorated_A.glb': { type: 'rect', width: 0.88, depth: 1.03 },
  'assets/env/wall_cracked.glb': { type: 'rect', width: 3.4, depth: 1.07 },
  'assets/env/wall_broken.glb': { type: 'rect', width: 3.4, depth: 0.85 },
  'assets/env/stairs_wide.glb': { type: 'rect', width: 5.95, depth: 3.4 },
  'assets/env/table_long_decorated_A.glb': { type: 'rect', width: 1.75, depth: 3.4 },
  'assets/env/table_medium_decorated_A.glb': { type: 'rect', width: 1.7, depth: 1.7 },
  'assets/env/chair.glb': { type: 'circle', radius: 0.32 },
  'assets/env/stool.glb': { type: 'circle', radius: 0.32 },
  'assets/env/forest/log.glb': { type: 'rect', width: 0.8, depth: 3 },
  'assets/env/forest/log_large.glb': { type: 'rect', width: 1.3, depth: 2.4 },
  'assets/env/forest/rock_largeA.glb': { type: 'circle', radius: 0.9 },
  'assets/env/forest/rock_largeD.glb': { type: 'circle', radius: 0.9 },
  'assets/env/forest/rock_smallB.glb': { type: 'circle', radius: 0.55 },
  'assets/env/forest/stump_old.glb': { type: 'circle', radius: 0.5 },
  'assets/env/forest/stump_round.glb': { type: 'circle', radius: 0.5 },
  'assets/env/forest/fence_planks.glb': { type: 'rect', width: 2.8, depth: 0.5 },
  'assets/env/forest/fence_gate.glb': { type: 'rect', width: 2.8, depth: 0.8 },
  'assets/env/forest/tree_default_fall.glb': { type: 'rect', width: 2.8, depth: 2.6 },
  'assets/env/forest/tree_oak_fall.glb': { type: 'rect', width: 3, depth: 3 },
  'assets/env/forest/tree_pineTallA.glb': { type: 'circle', radius: 1.25 },
  'assets/env/forest/tree_pineTallB.glb': { type: 'circle', radius: 1.4 },
};

const NON_SOLID_PROP_MODELS = new Set([
  ...Object.values(FLOOR_MODELS),
  'assets/env/banner_patternA_red.glb',
  'assets/env/banner_patternB_blue.glb',
  'assets/env/banner_shield_red.glb',
  'assets/env/candle_lit.glb',
  'assets/env/torch_lit.glb',
  'assets/env/torch_mounted.glb',
  'assets/env/rubble_half.glb',
  'assets/env/wall_doorway.glb',
  'assets/env/forest/mushroom_redGroup.glb',
  'assets/env/forest/mushroom_tanGroup.glb',
  'assets/env/forest/plant_bushLarge.glb',
  'assets/env/forest/campfire_logs.glb',
  'assets/env/forest/ground_pathStraight.glb',
  'assets/env/forest/ground_grass.glb',
]);

const CENTERED_DECOR_MODELS = new Set([
  'assets/env/stairs_wide.glb',
  'assets/env/wall_cracked.glb',
  'assets/env/wall_broken.glb',
]);

const SPAWN_CLEARANCE_RADIUS = 0.32;

function propFootprint(prop) {
  const footprint = PROP_FOOTPRINTS[prop.model];
  if (!footprint) throw new Error(`Missing collision footprint for ${prop.model}`);

  const scaleX = Math.abs(prop.scaleX ?? prop.scale ?? 1);
  const scaleZ = Math.abs(prop.scaleZ ?? prop.scale ?? 1);
  const quarterTurn = Math.abs(Math.sin(prop.rotY ?? 0)) > 0.999999;
  if (footprint.type === 'rect') {
    return {
      type: 'rect',
      width: (quarterTurn ? footprint.depth : footprint.width) * (quarterTurn ? scaleZ : scaleX),
      depth: (quarterTurn ? footprint.width : footprint.depth) * (quarterTurn ? scaleX : scaleZ),
    };
  }
  if (Math.abs(scaleX - scaleZ) < 1e-9) {
    return { type: 'circle', radius: footprint.radius * scaleX };
  }
  return {
    type: 'rect',
    width: footprint.radius * 2 * (quarterTurn ? scaleZ : scaleX),
    depth: footprint.radius * 2 * (quarterTurn ? scaleX : scaleZ),
  };
}

function propOverlapsPoint(prop, point, radius) {
  const footprint = propFootprint(prop);
  const dx = Math.abs(point.x - prop.x);
  const dz = Math.abs(point.z - prop.z);
  if (footprint.type === 'circle') {
    return Math.hypot(dx, dz) < footprint.radius + radius;
  }
  const closestX = Math.max(dx - footprint.width / 2, 0);
  const closestZ = Math.max(dz - footprint.depth / 2, 0);
  return closestX * closestX + closestZ * closestZ < radius * radius;
}

function roomSpawnPoints(width, centerZ) {
  return [
    { x: -width / 2 + 3, z: centerZ - 5 },
    { x: 0, z: centerZ - 7 },
    { x: width / 2 - 3, z: centerZ - 5 },
    { x: -width / 2 + 3, z: centerZ + 5 },
    { x: width / 2 - 3, z: centerZ + 5 },
  ];
}

function keepRoomSpawnsClear(props, room, width, depth) {
  const spawnPoints = [
    ...roomSpawnPoints(width, room.centerZ),
    { x: 0, z: room.centerZ + 7.75 },
  ];
  const offsets = Array.from({ length: 24 }, (_, index) => (index + 1) * 0.25);
  const directions = [[0, 1], [0, -1], [-1, 0], [1, 0]];
  for (const prop of props) {
    if (prop.roomId !== room.id || prop.solid === false || !PROP_FOOTPRINTS[prop.model]) continue;
    if (!spawnPoints.some((point) => propOverlapsPoint(prop, point, SPAWN_CLEARANCE_RADIUS))) continue;

    let placement = null;
    for (const offset of offsets) {
      for (const [dx, dz] of directions) {
        const candidate = { ...prop, x: prop.x + dx * offset, z: prop.z + dz * offset };
        if (
          candidate.x < -width / 2 + 1
          || candidate.x > width / 2 - 1
          || candidate.z < room.centerZ - depth / 2 + 1
          || candidate.z > room.centerZ + depth / 2 - 1
          || spawnPoints.some((point) => propOverlapsPoint(candidate, point, SPAWN_CLEARANCE_RADIUS))
        ) continue;
        placement = candidate;
        break;
      }
      if (placement) break;
    }
    if (!placement) throw new Error(`No spawn-safe placement for ${prop.model} in ${room.id}`);
    prop.x = placement.x;
    prop.z = placement.z;
  }
}

function addPropObstacles(props, obstacles, idPrefix) {
  for (const [index, prop] of props.entries()) {
    if (prop.solid === false || NON_SOLID_PROP_MODELS.has(prop.model)) continue;
    const footprint = propFootprint(prop);
    const id = prop.id ?? prop.obstacleId ?? `${idPrefix}-prop-${index + 1}`;
    prop.id = id;
    prop.obstacleId = id;
    obstacles.push({
      ...footprint,
      id,
      x: prop.x,
      z: prop.z,
      ...(prop.roomId ? { roomId: prop.roomId } : {}),
    });
  }
}

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

function forestFloorForRoom(room, width, depth) {
  const props = [];
  const columns = Math.ceil(width / 4);
  const rows = Math.ceil(depth / 4);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = -width / 2 + 2 + column * 4;
      const z = room.centerZ - depth / 2 + 2 + row * 4;
      props.push({
        model: (column + row * 2) % 7 === 0 ? FLOOR_MODELS.rockyDirt : FLOOR_MODELS.dirt,
        x,
        z,
        roomId: room.id,
      });
      if ((column + row) % 3 === 0) {
        props.push({
          model: 'assets/env/forest/ground_grass.glb',
          x: x + 1,
          y: 0.025,
          z: z + 1,
          scaleX: 0.9,
          scaleZ: 0.9,
          rotY: ((column + row) % 4) * Math.PI / 2,
          solid: false,
          roomId: room.id,
        });
      }
    }
  }
  return props;
}

function wallRow(room, xPositions, z, hasDoor, doors, obstacles, props) {
  for (const x of xPositions) {
    if (hasDoor && Math.abs(x) < 1) {
      props.push({ model: 'assets/env/wall_doorway.glb', x, z, rotY: 0, solid: false, roomId: room.id });
      const door = {
        id: `${room.id}-door`,
        fromRoom: room.id,
        toRoom: room.nextRoomId,
        x,
        z,
        open: false,
      };
      doors.push(door);
      obstacles.push({ id: `${door.id}-gate`, type: 'rect', x, z, width: 2.6, depth: 0.55, doorId: door.id, roomId: room.id });
      props.push({ model: 'assets/env/wall.glb', x, z, rotY: 0, doorId: door.id, obstacleId: `${door.id}-gate`, solid: false, roomId: room.id });
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
        solid: false,
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
    props.push({ model: sideWall, x: -width / 2 - 0.5, z, rotY: Math.PI / 2, wallSide: true, wallCenterZ: z, solid: false, roomId: room.id });
    props.push({ model: sideWall, x: width / 2 + 0.5, z, rotY: -Math.PI / 2, wallSide: true, wallCenterZ: z, solid: false, roomId: room.id });
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
    { model: 'assets/env/wall_corner.glb', x: -width / 2 - 0.5, z: room.centerZ - depth / 2 - 0.5, rotY: 0, solid: false, roomId: room.id },
    { model: 'assets/env/wall_corner.glb', x: width / 2 + 0.5, z: room.centerZ - depth / 2 - 0.5, rotY: Math.PI / 2, solid: false, roomId: room.id },
  );

  const columns = [
    [-width / 2 + 4.8, room.centerZ - depth / 2 + 5],
    [width / 2 - 4.8, room.centerZ - depth / 2 + 5],
    [-width / 2 + 4.8, room.centerZ + depth / 2 - 5],
    [width / 2 - 4.8, room.centerZ + depth / 2 - 5],
  ];
  columns.forEach(([x, z], index) => {
    props.push({ model: 'assets/env/column.glb', x, z, rotY: 0, roomId: room.id });
  });

  const crates = room.theme === 'collapsed' || room.theme === 'ossuary';
  if (crates) {
    const x = room.index % 2 ? 3.6 : -3.6;
    const z = room.centerZ + 0.5;
    props.push({ model: 'assets/env/crates_stacked.glb', x, z, rotY: room.index % 2 ? 0 : Math.PI, roomId: room.id });
  } else {
    const x = room.index % 2 ? -3.5 : 3.5;
    const z = room.centerZ + 1;
    props.push({ model: 'assets/env/barrel_large.glb', x, z, rotY: 0, roomId: room.id });
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
      ['assets/env/stairs_wide.glb', 6.5, room.centerZ - 8],
      ['assets/env/chest_gold.glb', -7, room.centerZ - 7.5],
      ['assets/env/shelf_large.glb', -7, room.centerZ - 3],
    ],
  }[room.theme] ?? [];
  const mirrorDecor = room.index % 2 === 1;
  const decorZOffset = room.index === 0 ? 0 : mirrorDecor ? 1.25 : -1.25;
  for (const [model, x, z] of stageDecor) {
    const centeredDecor = x === 0 && CENTERED_DECOR_MODELS.has(model);
    const offAxisX = centeredDecor && room.nextRoomId ? -4.5 : x;
    const prop = {
      model,
      x: mirrorDecor ? -offAxisX : offAxisX,
      z: z + decorZOffset,
      rotY: mirrorDecor ? Math.PI : 0,
      roomId: room.id,
    };
    if (
      centeredDecor
      && !room.nextRoomId
      && [
        ...roomSpawnPoints(width, room.centerZ),
        { x: 0, z: room.centerZ + 7.75 },
      ].some((point) => propOverlapsPoint(prop, point, SPAWN_CLEARANCE_RADIUS))
    ) {
      prop.x = mirrorDecor ? 4.5 : -4.5;
    }
    props.push(prop);
  }

  keepRoomSpawnsClear(props, room, width, depth);
  addPropObstacles(props, obstacles, room.id);
  return { props, obstacles, doors };
}

function buildForestRoomArt(room, { width, depth, lastRoom, stageId }) {
  const props = forestFloorForRoom(room, width, depth);
  const obstacles = [];
  const doors = [];
  const treeModels = ['assets/env/forest/tree_pineTallA.glb', 'assets/env/forest/tree_pineTallB.glb'];
  const spacing = 2.4;
  const boundaryTrees = [];
  for (const [row, offset] of [-0.75, 1.65].entries()) {
    const stagger = row * spacing / 2;
    for (let x = -width / 2 - offset; x <= width / 2 + offset; x += spacing) {
      for (const side of [-1, 1]) {
        boundaryTrees.push({
          model: treeModels[(Math.round((x + stagger) / spacing) + row) & 1],
          x: x + stagger,
          z: room.centerZ + side * (depth / 2 + offset),
          forestBoundaryRow: row,
          forestBoundaryAxis: 'horizontal',
          forestBoundarySide: side,
        });
      }
    }
    for (let z = room.centerZ - depth / 2 - offset; z <= room.centerZ + depth / 2 + offset; z += spacing) {
      for (const side of [-1, 1]) {
        boundaryTrees.push({
          model: treeModels[(Math.round((z + stagger) / spacing) + row) & 1],
          x: side * (4.4 + row * 1.2),
          z: z + stagger,
          forestBoundaryRow: row,
          forestBoundaryAxis: 'vertical',
          forestBoundarySide: side,
        });
      }
    }
  }
  props.push(...boundaryTrees.map((tree) => ({ ...tree, forestBoundary: true, solid: false, roomId: room.id })));
  if (room.nextRoomId) {
    const door = { id: `${room.id}-door`, fromRoom: room.id, toRoom: room.nextRoomId, x: 0, z: room.centerZ - depth / 2, open: false };
    doors.push(door);
    obstacles.push({ id: `${door.id}-gate`, type: 'rect', x: 0, z: door.z, width: 2.8, depth: 0.8, doorId: door.id, roomId: room.id });
    props.push({ model: 'assets/env/forest/fence_gate.glb', x: 0, z: door.z, rotY: 0, doorId: door.id, obstacleId: `${door.id}-gate`, solid: false, roomId: room.id });
    props.push({ model: 'assets/env/forest/log_large.glb', x: 0, y: 2.3, z: door.z, rotY: Math.PI / 2, solid: false, roomId: room.id });
    props.push(
      { model: 'assets/env/forest/stump_old.glb', x: -1.8, z: door.z, roomId: room.id },
      { model: 'assets/env/forest/stump_old.glb', x: 1.8, z: door.z, roomId: room.id },
    );
  }
  const center = room.centerZ;
  const interior = stageId === 'F1'
    ? [
      ['log_large.glb', -6, center - 5, 0, true], ['log_large.glb', 6, center - 5, 0, true],
      ['log_large.glb', -6, center + 5, 0, true], ['log_large.glb', 6, center + 5, 0, true],
      ['log.glb', -3.2, center - 6, 0.2, true], ['log.glb', 3.2, center + 6, -0.2, true],
      ['stump_round.glb', -4, center - 1, 0, true], ['stump_old.glb', 4, center + 1, 0, true],
      ['rock_smallB.glb', -5.3, center + 2, 0, true], ['rock_smallB.glb', 5.3, center - 2, 0, true],
      ['mushroom_redGroup.glb', -3.6, center + 4, 0, false], ['mushroom_tanGroup.glb', 3.6, center - 4, 0, false],
    ]
    : stageId === 'F2'
      ? [
        ['ground_pathStraight.glb', -4, center + 4, 0, false, true], ['ground_pathStraight.glb', 4, center + 4, 0, false, true],
        ['ground_pathStraight.glb', -4, center + 10, 0, false, true], ['ground_pathStraight.glb', 4, center + 10, 0, false, true],
        ['mushroom_redGroup.glb', -2.5, center + 4, 0, false], ['mushroom_tanGroup.glb', 2.5, center + 4, 0, false],
        ['mushroom_tanGroup.glb', -2.5, center + 10, 0, false], ['mushroom_redGroup.glb', 2.5, center + 10, 0, false],
        ['rock_largeA.glb', -5, center + 5, 0, true], ['rock_largeD.glb', 5, center + 5, 0, true],
        ['rock_smallB.glb', -4.5, center + 10, 0, true], ['rock_smallB.glb', 4.5, center + 10, 0, true],
      ]
      : stageId === 'F3'
        ? [
          ['campfire_logs.glb', 0, center + 4, 0, false],
          ['fence_planks.glb', -4.5, center + 3, 0, true], ['fence_planks.glb', 4.5, center + 3, 0, true],
          ['fence_planks.glb', -4.5, center + 9, 0, true], ['fence_planks.glb', 4.5, center + 9, 0, true],
          ['fence_gate.glb', -2.8, center + 10, Math.PI / 2, true], ['fence_gate.glb', 2.8, center + 10, Math.PI / 2, true],
          ['rock_smallB.glb', -5, center + 6, 0, true], ['rock_smallB.glb', 5, center + 6, 0, true],
          ['plant_bushLarge.glb', -2.5, center + 4, 0, false], ['plant_bushLarge.glb', 2.5, center + 4, 0, false],
          ['ground_grass.glb', 0, center + 9, 0, false],
        ]
        : [
          ['tree_default_fall.glb', -6, center - 5, 0, false], ['tree_oak_fall.glb', 6, center - 5, 0, false],
          ['tree_oak_fall.glb', -6, center + 5, 0, false], ['tree_default_fall.glb', 6, center + 5, 0, false],
          ['tree_default_fall.glb', -5, center - 6.5, Math.PI / 2, false], ['tree_oak_fall.glb', 5, center - 6.5, Math.PI / 2, false],
          ['tree_oak_fall.glb', -5, center + 6.5, Math.PI / 2, false], ['tree_default_fall.glb', 5, center + 6.5, Math.PI / 2, false],
          ['rock_largeA.glb', -4, center + 5, 0, true], ['rock_largeD.glb', 4, center + 5, 0, true],
          ['rock_smallB.glb', -4, center + 9, 0, true], ['rock_smallB.glb', 4, center + 9, 0, true],
        ];
  for (const [name, x, z, rotY, solid, bogPool = false] of interior) {
    const model = `assets/env/forest/${name}`;
    props.push({
      model, x, z, rotY, solid, bogPool, forestInterior: true, roomId: room.id,
      ...(bogPool ? { scaleX: 1.7, scaleZ: 1.3 } : {}),
      ...(name === 'ground_grass' ? { scaleX: 0.9, scaleZ: 0.9, y: 0.04 } : {}),
    });
  }
  if (stageId === 'F1') {
    const pathDetails = [
      ['log_large.glb', -5, center + 7, 0, false],
      ['log_large.glb', 5, center + 7, 0, false],
      ['stump_round.glb', -3, center + 5, 0, false],
      ['stump_old.glb', 3, center + 9, 0, false],
      ['rock_smallB.glb', -3.2, center + 9, 0, false],
      ['rock_smallB.glb', 3.2, center + 5, 0, false],
      ['mushroom_redGroup.glb', -1.6, center + 5, 0, false],
      ['mushroom_tanGroup.glb', 1.6, center + 9, 0, false],
    ];
    for (const [name, x, z, rotY, solid] of pathDetails) {
      props.push({
        model: `assets/env/forest/${name}`,
        x, z, rotY, solid, forestInterior: true, roomId: room.id,
      });
    }
    for (const zOffset of [4, 7, 10]) {
      props.push({
        model: 'assets/env/forest/ground_pathStraight.glb',
        x: 0,
        z: center + zOffset,
        scaleX: 2.2,
        scaleZ: 3,
        y: 0.03,
        solid: false,
        forestInterior: true,
        roomId: room.id,
      });
    }
  }
  keepRoomSpawnsClear(props, room, width, depth);
  addPropObstacles(props, obstacles, room.id);
  return { props, obstacles, doors };
}

function makeStage(id, name, stageLevel, recommendedLevel, rooms, { boss = false, region = 1 } = {}) {
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
    const art = region === 2
      ? buildForestRoomArt(room, { width, depth, lastRoom: index === arranged.length - 1, stageId: id })
      : buildRoomArt(room, { width, depth, lastRoom: index === arranged.length - 1 });
    props.push(...art.props);
    obstacles.push(...art.obstacles);
    doors.push(...art.doors);
  }
  const xMin = -width / 2;
  const xMax = width / 2;
  const minZ = arranged.at(-1).centerZ - depth / 2;
  const maxZ = depth / 2;
  const spawnPoints = arranged.map((room) => roomSpawnPoints(width, room.centerZ));
  return {
    id,
    name,
    stageLevel,
    recommendedLevel,
    region,
    ...(region === 2 ? { theme: 'forest' } : {}),
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
  makeStage('F1', '재가 내리는 숲길', 7, 7, [
    { theme: 'forest-path', waves: [{ enemy: 'minion', count: 3 }, { enemy: 'ashcaller', count: 1 }] },
    { theme: 'forest-path', waves: [{ enemy: 'bonearcher', count: 2 }, { enemy: 'minion', count: 3 }] },
  ], { region: 2 }),
  makeStage('F2', '검은 늪지', 8, 8, [
    { theme: 'forest-bog', waves: [{ enemy: 'bonearcher', count: 2 }, { enemy: 'ashcaller', count: 1 }] },
    { theme: 'forest-bog', waves: [{ enemy: 'brute', count: 1 }, { enemy: 'minion', count: 4 }] },
  ], { region: 2 }),
  makeStage('F3', '불탄 사냥터', 9, 9, [
    { theme: 'forest-clearing', waves: [{ enemy: 'brute', count: 1 }, { enemy: 'bonearcher', count: 2 }] },
    { theme: 'forest-clearing', waves: [{ enemy: 'ashcaller', count: 1 }, { enemy: 'brute', count: 2 }] },
  ], { region: 2 }),
  makeStage('FB', '잿빛 숲의 사령술사', 10, 10, [
    { theme: 'forest-boss', waves: [{ enemy: 'ashwarden', count: 1 }] },
  ], { boss: true, region: 2 }),
];

export function isStageUnlocked(stageId, clearedStages = []) {
  const index = STAGE_LIST.findIndex((stage) => stage.id === stageId);
  if (index < 0) return false;
  if (index === 0) return true;
  const stage = STAGE_LIST[index];
  if (stage.region === 2 && !clearedStages.includes('CB')) return false;
  return clearedStages.includes(STAGE_LIST[index - 1].id);
}

export const STAGES = Object.fromEntries(STAGE_LIST.map((stage) => [stage.id, stage]));

const hubProps = [];
for (let x = -8; x <= 8; x += 4) {
  for (let z = -8; z <= 8; z += 4) {
    hubProps.push({ model: (x + z) % 8 === 0 ? FLOOR_MODELS.darkWood : FLOOR_MODELS.wood, x, z, rotY: 0 });
  }
}
hubProps.push(
  ...[-6, -2, 2, 6].map((x) => ({ model: 'assets/env/wall_archedwindow_open.glb', x, z: -10.5, rotY: 0, solid: false })),
  ...[-7, -3, 1, 5].flatMap((z) => [
    { model: 'assets/env/wall_cracked.glb', x: -10.5, z, rotY: Math.PI / 2, wallSide: true, wallCenterZ: z, solid: false },
    { model: 'assets/env/wall_cracked.glb', x: 10.5, z, rotY: -Math.PI / 2, wallSide: true, wallCenterZ: z, solid: false },
  ]),
  { model: 'assets/env/wall_half.glb', x: -6, z: 10.5, rotY: 0, solid: false },
  { model: 'assets/env/wall_half.glb', x: 6, z: 10.5, rotY: 0, solid: false },
  { model: 'assets/env/banner_patternA_red.glb', x: -6, z: -9.7, rotY: Math.PI },
  { model: 'assets/env/banner_shield_red.glb', x: 6, z: -9.7, rotY: Math.PI },
  { model: 'assets/env/torch_mounted.glb', x: -8.5, z: -9, rotY: Math.PI / 2, wallLight: true },
  { model: 'assets/env/torch_mounted.glb', x: 8.5, z: -9, rotY: -Math.PI / 2, wallLight: true },
  { model: 'assets/env/torch_lit.glb', x: -8, z: 1, rotY: 0 },
  { model: 'assets/env/torch_lit.glb', x: 8, z: 1, rotY: 0 },
  { model: 'assets/env/candle_lit.glb', x: -8, z: 8, rotY: 0 },
  { model: 'assets/env/candle_lit.glb', x: 8, z: 8, rotY: 0 },
  { model: 'assets/env/table_long_decorated_A.glb', x: 0, z: -9.5, rotY: 0 },
  { model: 'assets/env/table_medium_decorated_A.glb', x: -4.5, z: -3.5, rotY: Math.PI / 2 },
  { model: 'assets/env/table_medium_decorated_A.glb', x: 4.5, z: -3.5, rotY: -Math.PI / 2 },
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

const hubObstacles = [];
addPropObstacles(hubProps, hubObstacles, 'hub');

export const HUB_ARENA = {
  id: 'inn-hub',
  width: 20,
  depth: 20,
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  playerSpawn: { x: 0, z: 3 },
  spawnPoints: [],
  rooms: [],
  doors: [],
  obstacles: hubObstacles,
  props: hubProps,
  npcs: [
    { id: 'blacksmith', name: '대장장이', model: 'Barbarian', x: -2.2, z: -3, rotY: Math.PI / 2, panel: 'blacksmith' },
    { id: 'merchant', name: '상인', model: 'Rogue_Hooded', x: 2.2, z: -3, rotY: -Math.PI / 2, panel: 'merchant' },
    { id: 'innkeeper', name: '주인', model: 'Mage', x: 0, z: -7, rotY: Math.PI, panel: 'board' },
  ],
};
