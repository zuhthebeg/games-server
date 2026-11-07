const obstacles = [
  { id: 'pillar-nw', type: 'circle', x: -4.6, z: -4.1, radius: 0.72 },
  { id: 'pillar-ne', type: 'circle', x: 4.6, z: -4.1, radius: 0.72 },
  { id: 'pillar-sw', type: 'circle', x: -4.6, z: 4.1, radius: 0.72 },
  { id: 'pillar-se', type: 'circle', x: 4.6, z: 4.1, radius: 0.72 },
  { id: 'crate-west', type: 'rect', x: -6.15, z: -0.8, width: 1.35, depth: 1.2 },
  { id: 'crate-east', type: 'rect', x: 6.15, z: -0.8, width: 1.35, depth: 1.2 },
  { id: 'barrel-south', type: 'circle', x: 0, z: 10.2, radius: 0.58 },
];

const obstacleModels = {
  'pillar-nw': 'assets/env/pillar.glb',
  'pillar-ne': 'assets/env/pillar.glb',
  'pillar-sw': 'assets/env/pillar.glb',
  'pillar-se': 'assets/env/pillar.glb',
  'crate-west': 'assets/env/crates_stacked.glb',
  'crate-east': 'assets/env/crates_stacked.glb',
  'barrel-south': 'assets/env/barrel_large.glb',
};

const floorProps = [];
for (let x = -6; x <= 6; x += 4) {
  for (let z = -10; z <= 10; z += 4) {
    if (x === 6 && z === 6) continue;
    floorProps.push({
      model: x === -6 && z === -6 ? 'assets/env/floor_tile_large_rocks.glb' : 'assets/env/floor_tile_large.glb',
      x,
      z,
      rotY: 0,
    });
  }
}
for (const x of [5, 7]) {
  for (const z of [5, 7]) floorProps.push({ model: 'assets/env/floor_tile_small.glb', x, z, rotY: 0 });
}

const sideWallProps = [];
for (let z = -11; z <= 11; z += 2) {
  sideWallProps.push({ model: 'assets/env/wall_half.glb', x: -8.5, z: z + 1, rotY: Math.PI / 2, wallSide: true, wallCenterZ: z });
  sideWallProps.push({ model: 'assets/env/wall_half.glb', x: 8.5, z: z - 1, rotY: -Math.PI / 2, wallSide: true, wallCenterZ: z });
}

const farWallProps = [-6, -2, 2, 6].map((x) => ({
  model: 'assets/env/wall.glb',
  x,
  z: -12.5,
  rotY: 0,
}));

export const ARENA = {
  id: 'trial-room-v1',
  width: 16,
  depth: 24,
  bounds: { minX: -8, maxX: 8, minZ: -12, maxZ: 12 },
  playerSpawn: { x: 0, z: 8 },
  spawnPoints: [
    { x: -5.8, z: -8.5 },
    { x: 0, z: -9.4 },
    { x: 5.8, z: -8.5 },
    { x: -6.2, z: 2.3 },
    { x: 6.2, z: 2.3 },
    { x: 0, z: -2.8 },
  ],
  obstacles,
  props: [
    ...floorProps,
    ...obstacles.map((obstacle) => ({
      model: obstacleModels[obstacle.id],
      x: obstacle.x,
      z: obstacle.z,
      rotY: 0,
      obstacleId: obstacle.id,
    })),
    { model: 'assets/env/torch_lit.glb', x: -7.3, z: -10.8, rotY: 0 },
    { model: 'assets/env/torch_lit.glb', x: 7.3, z: -10.8, rotY: 0 },
    { model: 'assets/env/candle_lit.glb', x: -7.3, z: 10.8, rotY: 0 },
    { model: 'assets/env/candle_lit.glb', x: 7.3, z: 10.8, rotY: 0 },
    { model: 'assets/env/banner_red.glb', x: 0, z: -11.5, rotY: Math.PI },
    ...farWallProps,
    ...sideWallProps,
  ],
};
