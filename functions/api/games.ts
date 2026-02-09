/**
 * GET /api/games - 사용 가능한 게임 목록
 */

import { jsonResponse } from '../types';
import { listGames } from '../games/registry';

export const onRequestGet = async (): Promise<Response> => {
    return jsonResponse(listGames());
};
