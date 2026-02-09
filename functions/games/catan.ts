/**
 * Catan (카탄) Game Plugin
 * 3-4 player strategy board game
 */

import type { GamePlugin, GameAction, Player, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

// ===== Types =====

type ResourceType = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
type HexType = ResourceType | 'desert';
type DevCardType = 'knight' | 'vp' | 'road_building' | 'year_of_plenty' | 'monopoly';
type TurnPhase = 'setup1' | 'setup2' | 'roll' | 'main' | 'robber' | 'discard' | 'finished';
type BuildingType = 'settlement' | 'city';

interface Resources {
    brick: number;
    lumber: number;
    wool: number;
    grain: number;
    ore: number;
}

interface Hex {
    type: HexType;
    number: number | null; // 2-12, null for desert
    hasRobber: boolean;
}

interface Vertex {
    building: BuildingType | null;
    owner: string | null; // player id
    adjacentHexes: number[]; // hex indices
    adjacentVertices: number[]; // vertex indices (for distance rule)
    adjacentEdges: number[]; // edge indices
    port: PortType | null;
}

interface Edge {
    road: boolean;
    owner: string | null;
    vertices: [number, number]; // vertex indices
}

type PortType = 'general' | ResourceType;

interface DevCard {
    type: DevCardType;
    playable: boolean; // false if bought this turn
}

interface CatanPlayer {
    id: string;
    nickname: string;
    color: string;
    resources: Resources;
    devCards: DevCard[];
    usedKnights: number;
    settlements: number; // remaining
    cities: number; // remaining
    roads: number; // remaining
    hasPlayedDevCard: boolean;
}

interface PendingTrade {
    fromPlayer: string;
    toPlayer: string | 'bank';
    offering: Partial<Resources>;
    requesting: Partial<Resources>;
}

interface CatanState {
    hexes: Hex[];
    vertices: Vertex[];
    edges: Edge[];
    
    players: CatanPlayer[];
    currentPlayerIndex: number;
    turnPhase: TurnPhase;
    setupRound: number; // 1 or 2 for setup phase
    
    devCardDeck: DevCardType[];
    
    longestRoad: { playerId: string; length: number } | null;
    largestArmy: { playerId: string; count: number } | null;
    
    lastRoll: [number, number] | null;
    pendingDiscard: string[]; // player ids who need to discard
    
    winner: string | null;
}

// ===== Constants =====

const COLORS = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71']; // red, blue, orange, green

const RESOURCE_HEXES: HexType[] = [
    'brick', 'brick', 'brick',
    'lumber', 'lumber', 'lumber', 'lumber',
    'wool', 'wool', 'wool', 'wool',
    'grain', 'grain', 'grain', 'grain',
    'ore', 'ore', 'ore',
    'desert'
];

const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

const BUILDING_COSTS: Record<string, Partial<Resources>> = {
    road: { brick: 1, lumber: 1 },
    settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
    devCard: { wool: 1, grain: 1, ore: 1 }
};

const DEV_CARD_DECK: DevCardType[] = [
    ...Array(14).fill('knight'),
    ...Array(5).fill('vp'),
    ...Array(2).fill('road_building'),
    ...Array(2).fill('year_of_plenty'),
    ...Array(2).fill('monopoly')
];

// ===== Map Generation =====

// Hex layout (axial coordinates mapped to index)
// The 19 hexes in a 3-4-5-4-3 pattern
const HEX_LAYOUT = [
    // Row 0: 3 hexes
    { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 },
    // Row 1: 4 hexes
    { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 2, r: -1 },
    // Row 2: 5 hexes
    { q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
    // Row 3: 4 hexes
    { q: -2, r: 1 }, { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 },
    // Row 4: 3 hexes
    { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 2 }
];

function generateMap(): { hexes: Hex[], vertices: Vertex[], edges: Edge[] } {
    // Shuffle hex types
    const shuffledHexTypes = [...RESOURCE_HEXES].sort(() => Math.random() - 0.5);
    const shuffledNumbers = [...NUMBER_TOKENS].sort(() => Math.random() - 0.5);
    
    // Create hexes
    const hexes: Hex[] = [];
    let numberIndex = 0;
    
    for (let i = 0; i < 19; i++) {
        const type = shuffledHexTypes[i];
        const isDesert = type === 'desert';
        hexes.push({
            type,
            number: isDesert ? null : shuffledNumbers[numberIndex++],
            hasRobber: isDesert // Robber starts on desert
        });
    }
    
    // Generate vertices and edges based on hex adjacencies
    // For simplicity, we'll create a mapping of vertices
    // Each hex has 6 vertices, but vertices are shared between hexes
    
    // Use a map to track unique vertices by their position
    const vertexMap = new Map<string, number>();
    const vertices: Vertex[] = [];
    const edgeMap = new Map<string, number>();
    const edges: Edge[] = [];
    
    // For each hex, calculate its 6 vertex positions
    // and 6 edges
    const hexVertexOffsets = [
        { dq: 0, dr: -1, corner: 0 },  // top
        { dq: 1, dr: -1, corner: 1 },  // top-right
        { dq: 1, dr: 0, corner: 2 },   // bottom-right
        { dq: 0, dr: 1, corner: 3 },   // bottom
        { dq: -1, dr: 1, corner: 4 },  // bottom-left
        { dq: -1, dr: 0, corner: 5 }   // top-left
    ];
    
    // Create adjacency data for each hex
    for (let hexIdx = 0; hexIdx < 19; hexIdx++) {
        const hex = HEX_LAYOUT[hexIdx];
        const hexVertices: number[] = [];
        
        // Create/get 6 vertices for this hex
        for (let v = 0; v < 6; v++) {
            // Calculate vertex position key (based on hex position and corner)
            const vKey = `${hex.q},${hex.r},${v}`;
            
            if (!vertexMap.has(vKey)) {
                const vertexIdx = vertices.length;
                vertexMap.set(vKey, vertexIdx);
                
                // Also map alternative keys (same vertex from adjacent hex perspective)
                const altKeys = getAlternativeVertexKeys(hex.q, hex.r, v);
                altKeys.forEach(k => vertexMap.set(k, vertexIdx));
                
                vertices.push({
                    building: null,
                    owner: null,
                    adjacentHexes: [],
                    adjacentVertices: [],
                    adjacentEdges: [],
                    port: null
                });
            }
            
            const vertexIdx = vertexMap.get(vKey)!;
            hexVertices.push(vertexIdx);
            
            // Add this hex to vertex's adjacent hexes
            if (!vertices[vertexIdx].adjacentHexes.includes(hexIdx)) {
                vertices[vertexIdx].adjacentHexes.push(hexIdx);
            }
        }
        
        // Create edges for this hex
        for (let e = 0; e < 6; e++) {
            const v1 = hexVertices[e];
            const v2 = hexVertices[(e + 1) % 6];
            const eKey = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
            
            if (!edgeMap.has(eKey)) {
                const edgeIdx = edges.length;
                edgeMap.set(eKey, edgeIdx);
                edges.push({
                    road: false,
                    owner: null,
                    vertices: [v1, v2]
                });
                
                vertices[v1].adjacentEdges.push(edgeIdx);
                vertices[v2].adjacentEdges.push(edgeIdx);
            }
        }
    }
    
    // Build vertex adjacencies
    for (const edge of edges) {
        const [v1, v2] = edge.vertices;
        if (!vertices[v1].adjacentVertices.includes(v2)) {
            vertices[v1].adjacentVertices.push(v2);
        }
        if (!vertices[v2].adjacentVertices.includes(v1)) {
            vertices[v2].adjacentVertices.push(v1);
        }
    }
    
    // Assign ports to coastal vertices
    assignPorts(vertices);
    
    return { hexes, vertices, edges };
}

function getAlternativeVertexKeys(q: number, r: number, corner: number): string[] {
    // A vertex is shared by up to 3 hexes
    // Map the same vertex from different hex perspectives
    const keys: string[] = [];
    
    // Adjacent hex mappings based on corner
    const adjacencies: Record<number, Array<{ dq: number, dr: number, newCorner: number }>> = {
        0: [{ dq: 0, dr: -1, newCorner: 2 }, { dq: 1, dr: -1, newCorner: 4 }],
        1: [{ dq: 1, dr: -1, newCorner: 3 }, { dq: 1, dr: 0, newCorner: 5 }],
        2: [{ dq: 1, dr: 0, newCorner: 4 }, { dq: 0, dr: 1, newCorner: 0 }],
        3: [{ dq: 0, dr: 1, newCorner: 5 }, { dq: -1, dr: 1, newCorner: 1 }],
        4: [{ dq: -1, dr: 1, newCorner: 0 }, { dq: -1, dr: 0, newCorner: 2 }],
        5: [{ dq: -1, dr: 0, newCorner: 1 }, { dq: 0, dr: -1, newCorner: 3 }]
    };
    
    for (const adj of adjacencies[corner]) {
        const nq = q + adj.dq;
        const nr = r + adj.dr;
        // Check if this hex exists in our layout
        if (HEX_LAYOUT.some(h => h.q === nq && h.r === nr)) {
            keys.push(`${nq},${nr},${adj.newCorner}`);
        }
    }
    
    return keys;
}

function assignPorts(vertices: Vertex[]) {
    // Simplified port assignment - assign to coastal vertices
    // In a real implementation, specific vertices would be assigned
    const portTypes: PortType[] = [
        'general', 'general', 'general', 'general',
        'brick', 'lumber', 'wool', 'grain', 'ore'
    ];
    
    // Find coastal vertices (those with fewer than 3 adjacent hexes)
    const coastalVertices = vertices
        .map((v, i) => ({ vertex: v, index: i }))
        .filter(({ vertex }) => vertex.adjacentHexes.length < 3);
    
    // Assign ports to pairs of adjacent coastal vertices
    let portIndex = 0;
    const assigned = new Set<number>();
    
    for (const { vertex, index } of coastalVertices) {
        if (assigned.has(index) || portIndex >= portTypes.length) continue;
        
        // Find an adjacent coastal vertex
        for (const adjIdx of vertex.adjacentVertices) {
            if (!assigned.has(adjIdx) && vertices[adjIdx].adjacentHexes.length < 3) {
                vertices[index].port = portTypes[portIndex];
                vertices[adjIdx].port = portTypes[portIndex];
                assigned.add(index);
                assigned.add(adjIdx);
                portIndex++;
                break;
            }
        }
    }
}

function createDevCardDeck(): DevCardType[] {
    return [...DEV_CARD_DECK].sort(() => Math.random() - 0.5);
}

function createEmptyResources(): Resources {
    return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

// ===== Game Logic =====

function hasResources(player: CatanPlayer, cost: Partial<Resources>): boolean {
    for (const [resource, amount] of Object.entries(cost)) {
        if ((player.resources[resource as ResourceType] || 0) < (amount || 0)) {
            return false;
        }
    }
    return true;
}

function deductResources(player: CatanPlayer, cost: Partial<Resources>): void {
    for (const [resource, amount] of Object.entries(cost)) {
        player.resources[resource as ResourceType] -= amount || 0;
    }
}

function addResources(player: CatanPlayer, resources: Partial<Resources>): void {
    for (const [resource, amount] of Object.entries(resources)) {
        player.resources[resource as ResourceType] += amount || 0;
    }
}

function getTotalResources(player: CatanPlayer): number {
    return Object.values(player.resources).reduce((a, b) => a + b, 0);
}

function calculateVictoryPoints(state: CatanState, player: CatanPlayer): number {
    let points = 0;
    
    // Buildings
    for (const vertex of state.vertices) {
        if (vertex.owner === player.id) {
            points += vertex.building === 'city' ? 2 : 1;
        }
    }
    
    // VP cards
    points += player.devCards.filter(c => c.type === 'vp').length;
    
    // Longest road
    if (state.longestRoad?.playerId === player.id) {
        points += 2;
    }
    
    // Largest army
    if (state.largestArmy?.playerId === player.id) {
        points += 2;
    }
    
    return points;
}

function calculateLongestRoad(state: CatanState, playerId: string): number {
    // DFS to find longest continuous road
    const playerEdges = state.edges
        .map((e, i) => ({ edge: e, index: i }))
        .filter(({ edge }) => edge.owner === playerId);
    
    if (playerEdges.length === 0) return 0;
    
    let maxLength = 0;
    
    function dfs(vertexIdx: number, visited: Set<number>, length: number) {
        maxLength = Math.max(maxLength, length);
        
        for (const edgeIdx of state.vertices[vertexIdx].adjacentEdges) {
            if (visited.has(edgeIdx)) continue;
            if (state.edges[edgeIdx].owner !== playerId) continue;
            
            // Check if path is blocked by opponent's building
            const otherVertex = state.edges[edgeIdx].vertices.find(v => v !== vertexIdx)!;
            const blocking = state.vertices[otherVertex].owner !== null && 
                           state.vertices[otherVertex].owner !== playerId;
            if (blocking) continue;
            
            visited.add(edgeIdx);
            dfs(otherVertex, visited, length + 1);
            visited.delete(edgeIdx);
        }
    }
    
    // Start from each endpoint
    for (const { index } of playerEdges) {
        for (const vertexIdx of state.edges[index].vertices) {
            dfs(vertexIdx, new Set([index]), 1);
        }
    }
    
    return maxLength;
}

function updateLongestRoad(state: CatanState): void {
    let longest = state.longestRoad;
    
    for (const player of state.players) {
        const length = calculateLongestRoad(state, player.id);
        
        if (length >= 5) {
            if (!longest || length > longest.length) {
                longest = { playerId: player.id, length };
            }
        }
    }
    
    state.longestRoad = longest;
}

function updateLargestArmy(state: CatanState): void {
    let largest = state.largestArmy;
    
    for (const player of state.players) {
        if (player.usedKnights >= 3) {
            if (!largest || player.usedKnights > largest.count) {
                largest = { playerId: player.id, count: player.usedKnights };
            }
        }
    }
    
    state.largestArmy = largest;
}

function checkWinner(state: CatanState): string | null {
    const currentPlayer = state.players[state.currentPlayerIndex];
    const points = calculateVictoryPoints(state, currentPlayer);
    
    if (points >= 10) {
        return currentPlayer.id;
    }
    return null;
}

// ===== Plugin Implementation =====

export const catanPlugin: GamePlugin = {
    id: 'catan',
    name: '카탄',
    minPlayers: 3,
    maxPlayers: 4,

    createInitialState(players: Player[], config?: any): CatanState {
        const { hexes, vertices, edges } = generateMap();
        
        // Shuffle player order
        const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
        
        const catanPlayers: CatanPlayer[] = shuffledPlayers.map((p, i) => ({
            id: p.id,
            nickname: p.nickname,
            color: COLORS[i],
            resources: createEmptyResources(),
            devCards: [],
            usedKnights: 0,
            settlements: 5,
            cities: 4,
            roads: 15,
            hasPlayedDevCard: false
        }));

        return {
            hexes,
            vertices,
            edges,
            players: catanPlayers,
            currentPlayerIndex: 0,
            turnPhase: 'setup1',
            setupRound: 1,
            devCardDeck: createDevCardDeck(),
            longestRoad: null,
            largestArmy: null,
            lastRoll: null,
            pendingDiscard: [],
            winner: null
        };
    },

    validateAction(state: CatanState, action: GameAction, playerId: string): ValidationResult {
        if (state.winner) {
            return { valid: false, error: '게임이 종료되었습니다' };
        }

        const currentPlayer = state.players[state.currentPlayerIndex];
        
        // Check if it's player's turn (except for discard)
        if (action.type !== 'discard' && currentPlayer.id !== playerId) {
            return { valid: false, error: '당신의 차례가 아닙니다' };
        }

        switch (action.type) {
            case 'build_settlement':
                return validateBuildSettlement(state, playerId, action.payload);
            case 'build_road':
                return validateBuildRoad(state, playerId, action.payload);
            case 'build_city':
                return validateBuildCity(state, playerId, action.payload);
            case 'roll_dice':
                return validateRollDice(state);
            case 'end_turn':
                return validateEndTurn(state);
            case 'buy_dev_card':
                return validateBuyDevCard(state, playerId);
            case 'play_dev_card':
                return validatePlayDevCard(state, playerId, action.payload);
            case 'move_robber':
                return validateMoveRobber(state, playerId, action.payload);
            case 'discard':
                return validateDiscard(state, playerId, action.payload);
            case 'trade_bank':
                return validateTradeBank(state, playerId, action.payload);
            default:
                return { valid: false, error: '알 수 없는 액션입니다' };
        }
    },

    applyAction(state: CatanState, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as CatanState;
        const events: GameEvent[] = [];

        switch (action.type) {
            case 'build_settlement':
                applyBuildSettlement(newState, playerId, action.payload, events);
                break;
            case 'build_road':
                applyBuildRoad(newState, playerId, action.payload, events);
                break;
            case 'build_city':
                applyBuildCity(newState, playerId, action.payload, events);
                break;
            case 'roll_dice':
                applyRollDice(newState, events);
                break;
            case 'end_turn':
                applyEndTurn(newState, events);
                break;
            case 'buy_dev_card':
                applyBuyDevCard(newState, playerId, events);
                break;
            case 'play_dev_card':
                applyPlayDevCard(newState, playerId, action.payload, events);
                break;
            case 'move_robber':
                applyMoveRobber(newState, playerId, action.payload, events);
                break;
            case 'discard':
                applyDiscard(newState, playerId, action.payload, events);
                break;
            case 'trade_bank':
                applyTradeBank(newState, playerId, action.payload, events);
                break;
        }

        // Check for winner
        const winner = checkWinner(newState);
        if (winner) {
            newState.winner = winner;
            newState.turnPhase = 'finished';
            events.push({ type: 'game_end', payload: { winner } });
        }

        return { newState, events };
    },

    getCurrentTurn(state: CatanState): string | null {
        if (state.winner) return null;
        if (state.pendingDiscard.length > 0) return state.pendingDiscard[0];
        return state.players[state.currentPlayerIndex].id;
    },

    isGameOver(state: CatanState): boolean {
        return state.winner !== null;
    },

    getResult(state: CatanState): GameResult | null {
        if (!state.winner) return null;
        return { winnerId: state.winner, reason: '10점 달성!' };
    },

    getPublicState(state: CatanState): any {
        return {
            hexes: state.hexes,
            vertices: state.vertices,
            edges: state.edges,
            players: state.players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                color: p.color,
                resourceCount: getTotalResources(p),
                devCardCount: p.devCards.length,
                usedKnights: p.usedKnights,
                victoryPoints: calculateVictoryPoints(state, p)
            })),
            currentPlayerIndex: state.currentPlayerIndex,
            turnPhase: state.turnPhase,
            setupRound: state.setupRound,
            longestRoad: state.longestRoad,
            largestArmy: state.largestArmy,
            lastRoll: state.lastRoll,
            pendingDiscard: state.pendingDiscard,
            devCardsRemaining: state.devCardDeck.length,
            winner: state.winner
        };
    },

    getPlayerView(state: CatanState, playerId: string): any {
        const player = state.players.find(p => p.id === playerId);
        if (!player) return {};
        
        return {
            resources: player.resources,
            devCards: player.devCards,
            isMyTurn: state.players[state.currentPlayerIndex].id === playerId,
            canRoll: state.turnPhase === 'roll',
            canBuild: state.turnPhase === 'main' || state.turnPhase === 'setup1' || state.turnPhase === 'setup2',
            mustDiscard: state.pendingDiscard.includes(playerId)
        };
    }
};

// ===== Validation Functions =====

function validateBuildSettlement(state: CatanState, playerId: string, payload: any): ValidationResult {
    const { vertexIndex } = payload || {};
    const player = state.players.find(p => p.id === playerId)!;
    const isSetup = state.turnPhase === 'setup1' || state.turnPhase === 'setup2';
    
    if (!isSetup && state.turnPhase !== 'main') {
        return { valid: false, error: '지금은 건설할 수 없습니다' };
    }
    
    if (vertexIndex === undefined || vertexIndex < 0 || vertexIndex >= state.vertices.length) {
        return { valid: false, error: '잘못된 위치입니다' };
    }
    
    const vertex = state.vertices[vertexIndex];
    
    if (vertex.building !== null) {
        return { valid: false, error: '이미 건물이 있습니다' };
    }
    
    // Distance rule: no adjacent settlements
    for (const adjIdx of vertex.adjacentVertices) {
        if (state.vertices[adjIdx].building !== null) {
            return { valid: false, error: '다른 마을과 너무 가깝습니다' };
        }
    }
    
    // Must connect to own road (except setup)
    if (!isSetup) {
        const hasConnectedRoad = vertex.adjacentEdges.some(
            edgeIdx => state.edges[edgeIdx].owner === playerId
        );
        if (!hasConnectedRoad) {
            return { valid: false, error: '도로와 연결되어야 합니다' };
        }
        
        if (!hasResources(player, BUILDING_COSTS.settlement)) {
            return { valid: false, error: '자원이 부족합니다' };
        }
    }
    
    if (player.settlements <= 0) {
        return { valid: false, error: '마을이 부족합니다' };
    }
    
    return { valid: true };
}

function validateBuildRoad(state: CatanState, playerId: string, payload: any): ValidationResult {
    const { edgeIndex } = payload || {};
    const player = state.players.find(p => p.id === playerId)!;
    const isSetup = state.turnPhase === 'setup1' || state.turnPhase === 'setup2';
    
    if (!isSetup && state.turnPhase !== 'main') {
        return { valid: false, error: '지금은 건설할 수 없습니다' };
    }
    
    if (edgeIndex === undefined || edgeIndex < 0 || edgeIndex >= state.edges.length) {
        return { valid: false, error: '잘못된 위치입니다' };
    }
    
    const edge = state.edges[edgeIndex];
    
    if (edge.road) {
        return { valid: false, error: '이미 도로가 있습니다' };
    }
    
    // Must connect to own road or settlement
    const [v1, v2] = edge.vertices;
    const hasConnection = 
        state.vertices[v1].owner === playerId ||
        state.vertices[v2].owner === playerId ||
        state.vertices[v1].adjacentEdges.some(e => state.edges[e].owner === playerId) ||
        state.vertices[v2].adjacentEdges.some(e => state.edges[e].owner === playerId);
    
    if (!hasConnection) {
        return { valid: false, error: '기존 건물이나 도로와 연결되어야 합니다' };
    }
    
    if (!isSetup && !hasResources(player, BUILDING_COSTS.road)) {
        return { valid: false, error: '자원이 부족합니다' };
    }
    
    if (player.roads <= 0) {
        return { valid: false, error: '도로가 부족합니다' };
    }
    
    return { valid: true };
}

function validateBuildCity(state: CatanState, playerId: string, payload: any): ValidationResult {
    const { vertexIndex } = payload || {};
    const player = state.players.find(p => p.id === playerId)!;
    
    if (state.turnPhase !== 'main') {
        return { valid: false, error: '지금은 건설할 수 없습니다' };
    }
    
    if (vertexIndex === undefined || vertexIndex < 0 || vertexIndex >= state.vertices.length) {
        return { valid: false, error: '잘못된 위치입니다' };
    }
    
    const vertex = state.vertices[vertexIndex];
    
    if (vertex.building !== 'settlement' || vertex.owner !== playerId) {
        return { valid: false, error: '자신의 마을만 도시로 업그레이드할 수 있습니다' };
    }
    
    if (!hasResources(player, BUILDING_COSTS.city)) {
        return { valid: false, error: '자원이 부족합니다' };
    }
    
    if (player.cities <= 0) {
        return { valid: false, error: '도시가 부족합니다' };
    }
    
    return { valid: true };
}

function validateRollDice(state: CatanState): ValidationResult {
    if (state.turnPhase !== 'roll') {
        return { valid: false, error: '지금은 주사위를 굴릴 수 없습니다' };
    }
    return { valid: true };
}

function validateEndTurn(state: CatanState): ValidationResult {
    if (state.turnPhase !== 'main') {
        return { valid: false, error: '지금은 턴을 종료할 수 없습니다' };
    }
    return { valid: true };
}

function validateBuyDevCard(state: CatanState, playerId: string): ValidationResult {
    const player = state.players.find(p => p.id === playerId)!;
    
    if (state.turnPhase !== 'main') {
        return { valid: false, error: '지금은 개발 카드를 살 수 없습니다' };
    }
    
    if (state.devCardDeck.length === 0) {
        return { valid: false, error: '개발 카드가 소진되었습니다' };
    }
    
    if (!hasResources(player, BUILDING_COSTS.devCard)) {
        return { valid: false, error: '자원이 부족합니다' };
    }
    
    return { valid: true };
}

function validatePlayDevCard(state: CatanState, playerId: string, payload: any): ValidationResult {
    const player = state.players.find(p => p.id === playerId)!;
    const { cardIndex, cardType } = payload || {};
    
    if (state.turnPhase === 'setup1' || state.turnPhase === 'setup2') {
        return { valid: false, error: '셋업 단계에서는 사용할 수 없습니다' };
    }
    
    if (player.hasPlayedDevCard) {
        return { valid: false, error: '이번 턴에 이미 개발 카드를 사용했습니다' };
    }
    
    const card = player.devCards[cardIndex];
    if (!card || !card.playable) {
        return { valid: false, error: '이 카드는 사용할 수 없습니다' };
    }
    
    if (card.type === 'vp') {
        return { valid: false, error: '승점 카드는 자동으로 적용됩니다' };
    }
    
    return { valid: true };
}

function validateMoveRobber(state: CatanState, playerId: string, payload: any): ValidationResult {
    if (state.turnPhase !== 'robber') {
        return { valid: false, error: '지금은 도둑을 이동할 수 없습니다' };
    }
    
    const { hexIndex, stealFromPlayer } = payload || {};
    
    if (hexIndex === undefined || hexIndex < 0 || hexIndex >= state.hexes.length) {
        return { valid: false, error: '잘못된 위치입니다' };
    }
    
    if (state.hexes[hexIndex].hasRobber) {
        return { valid: false, error: '도둑은 다른 곳으로 이동해야 합니다' };
    }
    
    return { valid: true };
}

function validateDiscard(state: CatanState, playerId: string, payload: any): ValidationResult {
    if (!state.pendingDiscard.includes(playerId)) {
        return { valid: false, error: '카드를 버릴 필요가 없습니다' };
    }
    
    const player = state.players.find(p => p.id === playerId)!;
    const total = getTotalResources(player);
    const toDiscard = Math.floor(total / 2);
    
    const { resources } = payload || {};
    if (!resources) {
        return { valid: false, error: '버릴 자원을 선택하세요' };
    }
    
    let discardCount = 0;
    for (const [resource, amount] of Object.entries(resources)) {
        if ((amount as number) > player.resources[resource as ResourceType]) {
            return { valid: false, error: '보유한 것보다 많이 버릴 수 없습니다' };
        }
        discardCount += amount as number;
    }
    
    if (discardCount !== toDiscard) {
        return { valid: false, error: `${toDiscard}장을 버려야 합니다` };
    }
    
    return { valid: true };
}

function validateTradeBank(state: CatanState, playerId: string, payload: any): ValidationResult {
    const player = state.players.find(p => p.id === playerId)!;
    
    if (state.turnPhase !== 'main') {
        return { valid: false, error: '지금은 거래할 수 없습니다' };
    }
    
    const { give, receive } = payload || {};
    
    if (!give || !receive) {
        return { valid: false, error: '교환할 자원을 선택하세요' };
    }
    
    // Calculate trade ratio based on ports
    let ratio = 4;
    
    // Check for general port (3:1)
    for (const vertex of state.vertices) {
        if (vertex.owner === playerId && vertex.port === 'general') {
            ratio = Math.min(ratio, 3);
        }
        if (vertex.owner === playerId && vertex.port === give) {
            ratio = 2;
            break;
        }
    }
    
    if (player.resources[give as ResourceType] < ratio) {
        return { valid: false, error: `${ratio}개가 필요합니다` };
    }
    
    return { valid: true };
}

// ===== Apply Functions =====

function applyBuildSettlement(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const { vertexIndex } = payload;
    const player = state.players.find(p => p.id === playerId)!;
    const isSetup = state.turnPhase === 'setup1' || state.turnPhase === 'setup2';
    
    state.vertices[vertexIndex].building = 'settlement';
    state.vertices[vertexIndex].owner = playerId;
    player.settlements--;
    
    if (!isSetup) {
        deductResources(player, BUILDING_COSTS.settlement);
    }
    
    // In setup2, give resources from adjacent hexes
    if (state.turnPhase === 'setup2') {
        for (const hexIdx of state.vertices[vertexIndex].adjacentHexes) {
            const hex = state.hexes[hexIdx];
            if (hex.type !== 'desert') {
                player.resources[hex.type as ResourceType]++;
            }
        }
    }
    
    events.push({ type: 'build', playerId, payload: { building: 'settlement', vertexIndex } });
    
    // Check for setup phase progression
    if (isSetup) {
        advanceSetupPhase(state, playerId, 'settlement');
    }
}

function applyBuildRoad(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const { edgeIndex } = payload;
    const player = state.players.find(p => p.id === playerId)!;
    const isSetup = state.turnPhase === 'setup1' || state.turnPhase === 'setup2';
    
    state.edges[edgeIndex].road = true;
    state.edges[edgeIndex].owner = playerId;
    player.roads--;
    
    if (!isSetup) {
        deductResources(player, BUILDING_COSTS.road);
    }
    
    updateLongestRoad(state);
    
    events.push({ type: 'build', playerId, payload: { building: 'road', edgeIndex } });
    
    if (isSetup) {
        advanceSetupPhase(state, playerId, 'road');
    }
}

function advanceSetupPhase(state: CatanState, playerId: string, builtType: string) {
    // In setup, each player places settlement then road
    // setup1: player 0, 1, 2, 3 each place settlement+road
    // setup2: player 3, 2, 1, 0 each place settlement+road
    
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    const numPlayers = state.players.length;
    
    if (builtType === 'road') {
        // Move to next player or phase
        if (state.turnPhase === 'setup1') {
            if (playerIndex === numPlayers - 1) {
                state.turnPhase = 'setup2';
                // Stay on last player for setup2
            } else {
                state.currentPlayerIndex = playerIndex + 1;
            }
        } else if (state.turnPhase === 'setup2') {
            if (playerIndex === 0) {
                // Setup complete, start main game
                state.turnPhase = 'roll';
                state.currentPlayerIndex = 0;
            } else {
                state.currentPlayerIndex = playerIndex - 1;
            }
        }
    }
}

function applyBuildCity(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const { vertexIndex } = payload;
    const player = state.players.find(p => p.id === playerId)!;
    
    state.vertices[vertexIndex].building = 'city';
    player.cities--;
    player.settlements++; // Return settlement piece
    
    deductResources(player, BUILDING_COSTS.city);
    
    events.push({ type: 'build', playerId, payload: { building: 'city', vertexIndex } });
}

function applyRollDice(state: CatanState, events: GameEvent[]) {
    const die1 = Math.floor(Math.random() * 6) + 1;
    const die2 = Math.floor(Math.random() * 6) + 1;
    const total = die1 + die2;
    
    state.lastRoll = [die1, die2];
    events.push({ type: 'roll', payload: { dice: [die1, die2], total } });
    
    if (total === 7) {
        // Players with more than 7 cards must discard
        state.pendingDiscard = state.players
            .filter(p => getTotalResources(p) > 7)
            .map(p => p.id);
        
        if (state.pendingDiscard.length > 0) {
            state.turnPhase = 'discard';
        } else {
            state.turnPhase = 'robber';
        }
    } else {
        // Distribute resources
        for (let hexIdx = 0; hexIdx < state.hexes.length; hexIdx++) {
            const hex = state.hexes[hexIdx];
            if (hex.number === total && !hex.hasRobber && hex.type !== 'desert') {
                // Find all settlements/cities adjacent to this hex
                for (const vertex of state.vertices) {
                    if (vertex.adjacentHexes.includes(hexIdx) && vertex.owner) {
                        const player = state.players.find(p => p.id === vertex.owner)!;
                        const amount = vertex.building === 'city' ? 2 : 1;
                        player.resources[hex.type as ResourceType] += amount;
                    }
                }
            }
        }
        
        state.turnPhase = 'main';
    }
}

function applyEndTurn(state: CatanState, events: GameEvent[]) {
    // Make newly bought dev cards playable
    const currentPlayer = state.players[state.currentPlayerIndex];
    currentPlayer.devCards.forEach(c => c.playable = true);
    currentPlayer.hasPlayedDevCard = false;
    
    // Next player
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    state.turnPhase = 'roll';
    
    events.push({ type: 'end_turn' });
}

function applyBuyDevCard(state: CatanState, playerId: string, events: GameEvent[]) {
    const player = state.players.find(p => p.id === playerId)!;
    
    deductResources(player, BUILDING_COSTS.devCard);
    
    const cardType = state.devCardDeck.pop()!;
    player.devCards.push({ type: cardType, playable: false });
    
    events.push({ type: 'buy_dev_card', playerId });
}

function applyPlayDevCard(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const player = state.players.find(p => p.id === playerId)!;
    const { cardIndex, ...params } = payload;
    
    const card = player.devCards[cardIndex];
    player.devCards.splice(cardIndex, 1);
    player.hasPlayedDevCard = true;
    
    switch (card.type) {
        case 'knight':
            player.usedKnights++;
            updateLargestArmy(state);
            state.turnPhase = 'robber';
            break;
        case 'road_building':
            // Give player 2 free roads (handled in subsequent actions)
            // For simplicity, just give resources
            player.resources.brick += 2;
            player.resources.lumber += 2;
            break;
        case 'year_of_plenty':
            // Get 2 resources of choice
            if (params.resource1) player.resources[params.resource1 as ResourceType]++;
            if (params.resource2) player.resources[params.resource2 as ResourceType]++;
            break;
        case 'monopoly':
            // Take all of one resource from other players
            if (params.resource) {
                const res = params.resource as ResourceType;
                for (const other of state.players) {
                    if (other.id !== playerId) {
                        player.resources[res] += other.resources[res];
                        other.resources[res] = 0;
                    }
                }
            }
            break;
    }
    
    events.push({ type: 'play_dev_card', playerId, payload: { cardType: card.type } });
}

function applyMoveRobber(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const { hexIndex, stealFromPlayer } = payload;
    
    // Remove robber from current hex
    const currentRobberHex = state.hexes.find(h => h.hasRobber);
    if (currentRobberHex) currentRobberHex.hasRobber = false;
    
    // Place robber on new hex
    state.hexes[hexIndex].hasRobber = true;
    
    // Steal from adjacent player
    if (stealFromPlayer) {
        const victim = state.players.find(p => p.id === stealFromPlayer);
        const thief = state.players.find(p => p.id === playerId);
        
        if (victim && thief && getTotalResources(victim) > 0) {
            // Random steal
            const resources = Object.entries(victim.resources)
                .filter(([_, count]) => count > 0)
                .map(([res]) => res);
            
            if (resources.length > 0) {
                const stolen = resources[Math.floor(Math.random() * resources.length)] as ResourceType;
                victim.resources[stolen]--;
                thief.resources[stolen]++;
            }
        }
    }
    
    state.turnPhase = 'main';
    events.push({ type: 'robber_moved', payload: { hexIndex, stealFromPlayer } });
}

function applyDiscard(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const player = state.players.find(p => p.id === playerId)!;
    const { resources } = payload;
    
    for (const [resource, amount] of Object.entries(resources)) {
        player.resources[resource as ResourceType] -= amount as number;
    }
    
    state.pendingDiscard = state.pendingDiscard.filter(id => id !== playerId);
    
    if (state.pendingDiscard.length === 0) {
        state.turnPhase = 'robber';
    }
    
    events.push({ type: 'discard', playerId, payload: { count: Object.values(resources).reduce((a: number, b) => a + (b as number), 0) } });
}

function applyTradeBank(state: CatanState, playerId: string, payload: any, events: GameEvent[]) {
    const player = state.players.find(p => p.id === playerId)!;
    const { give, receive } = payload;
    
    // Calculate ratio
    let ratio = 4;
    for (const vertex of state.vertices) {
        if (vertex.owner === playerId && vertex.port === 'general') {
            ratio = Math.min(ratio, 3);
        }
        if (vertex.owner === playerId && vertex.port === give) {
            ratio = 2;
            break;
        }
    }
    
    player.resources[give as ResourceType] -= ratio;
    player.resources[receive as ResourceType]++;
    
    events.push({ type: 'trade_bank', playerId, payload: { give, receive, ratio } });
}
