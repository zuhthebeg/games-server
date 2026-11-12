// Beast Hunt uses the existing stateless relay contract, in its own room namespace.
// Combat, owner authority and protocol version validation stay on clients.
import { spudsquadPlugin } from './spudsquad';
import type { GamePlugin } from './types';
export const beasthuntPlugin: GamePlugin = {
    ...spudsquadPlugin,
    id: 'beasthunt',
    name: 'Beast Hunt',
    minPlayers: 2,
    maxPlayers: 4,
};
