/**
 * Game Plugin Registry
 * 
 * 새 게임 추가 시:
 * 1. games/ 폴더에 플러그인 파일 생성
 * 2. 여기서 import 후 등록
 */

import type { GamePlugin, GameRegistryEntry } from './types';
import { echoPlugin } from './echo';
import { pokerPlugin } from './poker';
import { gomokuPlugin } from './gomoku';

const registry = new Map<string, GameRegistryEntry>();

/**
 * 게임 등록
 */
export function registerGame(plugin: GamePlugin, defaultConfig?: any): void {
    if (registry.has(plugin.id)) {
        console.warn(`Game "${plugin.id}" is already registered. Overwriting.`);
    }
    registry.set(plugin.id, { plugin, defaultConfig });
}

/**
 * 게임 플러그인 조회
 */
export function getGame(gameType: string): GamePlugin | null {
    return registry.get(gameType)?.plugin || null;
}

/**
 * 기본 설정 조회
 */
export function getDefaultConfig(gameType: string): any {
    return registry.get(gameType)?.defaultConfig || {};
}

/**
 * 등록된 게임 목록
 */
export function listGames(): Array<{ id: string; name: string; minPlayers: number; maxPlayers: number }> {
    return Array.from(registry.values()).map(({ plugin }) => ({
        id: plugin.id,
        name: plugin.name,
        minPlayers: plugin.minPlayers,
        maxPlayers: plugin.maxPlayers,
    }));
}

/**
 * 게임 존재 여부
 */
export function hasGame(gameType: string): boolean {
    return registry.has(gameType);
}

// ============================================
// 게임 등록 (새 게임 추가 시 여기에 추가)
// ============================================

registerGame(echoPlugin, { targetScore: 10 });
registerGame(pokerPlugin, { startingChips: 1000, bigBlind: 20 });
registerGame(gomokuPlugin, {});
