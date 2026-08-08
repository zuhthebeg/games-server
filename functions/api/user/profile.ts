/**
 * 통합 프로필 — 계정 정보 + 특성(traits) + 서비스별 내 기록을 한 번에.
 * 프로필 페이지(cocy.io/profile)가 화면 하나 그리는 데 요청 네 번 날리지 않게 묶었다.
 *
 * GET /api/user/profile
 */
import { Env, jsonResponse, errorResponse, getUserFromRequest } from '../../types';
import { ensureTraitsTable } from './traits';

// rankings 와이드 테이블의 컬럼 접두어 → 게임 표기. 게임별 점수 컬럼은 런타임 ALTER로
// 늘어나는 구조라(스키마에 없음), 알려진 접두어만 골라 보여준다. 새 게임 = 여기에 한 줄.
const GAME_COLS: Record<string, { game: string; label: string; unit?: string }> = {
    best_weapon_level: { game: 'enhance', label: '무기강화 최고 강화' },
    total_kills:       { game: 'hunting', label: '사냥 누적 처치' },
    pvp_rating:        { game: 'pvp', label: 'PVP 레이팅' },
    snake_best_score:  { game: 'snake', label: '스네이크 최고점' },
    bj_best_profit:    { game: 'blackjack', label: '블랙잭 최고 수익' },
    blockblast_best_score: { game: 'blockblast', label: '블록블라스트 최고점' },
    beatdrop_best_score:   { game: 'beatdrop', label: '비트드랍 최고점' },
    bulletdodge_best_time: { game: 'bulletdodge', label: '탄막피하기 생존', unit: '초' },
    gostop_best_score: { game: 'gostop', label: '고스톱 최고점' },
    jokerrun_best_score: { game: 'jokerrun', label: '조커런 최고점' },
    linerush_best_stage: { game: 'linerush', label: '라인러시 최고 스테이지' },
    mahjong_best_score:  { game: 'mahjong', label: '마작 최고점' },
    match3_best_score:   { game: 'match3', label: '매치3 최고점' },
    melodyecho_best_score: { game: 'melodyecho', label: '멜로디에코 최고점' },
    minesweeper_best_score: { game: 'minesweeper', label: '지뢰찾기 최고점' },
    pingtan_best_time_sec: { game: 'pingtan', label: '핑탄 기록', unit: '초' },
    ppingpae_best_score: { game: 'ppingpae', label: '삥빼기 최고점' },
    sudoku_best_score:   { game: 'sudoku', label: '스도쿠 최고점' },
    wrongnote_best_score: { game: 'wrongnote', label: '틀린음찾기 최고점' },
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
    const user = getUserFromRequest(ctx.request);
    if (!user) return errorResponse('Unauthorized', 401);
    const db = ctx.env.DB;
    try {
        const account = await db.prepare(`
            SELECT id, nickname, is_anonymous, email, email_verified,
                   (google_id IS NOT NULL) AS has_google,
                   (password_hash IS NOT NULL) AS has_password,
                   avatar_url, created_at
            FROM users WHERE id = ?
        `).bind(user.userId).first<any>();
        if (!account) return errorResponse('user not found', 404);

        await ensureTraitsTable(db);
        const traitRows = await db.prepare(
            'SELECT trait, value, updated_at FROM user_traits WHERE user_id = ?'
        ).bind(user.userId).all();
        const traits: Record<string, any> = {};
        for (const r of (traitRows.results || []) as any[]) {
            try { traits[r.trait] = { value: JSON.parse(r.value), updated_at: r.updated_at }; }
            catch { /* skip */ }
        }

        // 보이스매치: 아티스트별 최고 매치율. 최신순 첫 행이 "마지막으로 닮았던 가수".
        let voicematch: any[] = [];
        try {
            const vm = await db.prepare(`
                SELECT artist, pct, updated_at FROM voicematch_rankings
                WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10
            `).bind(user.userId).all();
            voicematch = (vm.results || []) as any[];
        } catch { /* 테이블 없으면 빈 배열 */ }

        // 게임 기록: 와이드 rankings 한 행에서 아는 컬럼만 추린다.
        const games: any[] = [];
        try {
            const row = await db.prepare('SELECT * FROM rankings WHERE user_id = ?')
                .bind(user.userId).first<any>();
            if (row) {
                for (const [col, meta] of Object.entries(GAME_COLS)) {
                    const v = row[col];
                    if (v !== null && v !== undefined && v !== 0) {
                        games.push({ ...meta, col, value: v });
                    }
                }
                // 무기 이름은 레벨에 딸린 부가정보로만 붙인다
                if (row.best_weapon_name) {
                    const w = games.find(g => g.col === 'best_weapon_level');
                    if (w) w.detail = row.best_weapon_name;
                }
            }
        } catch { /* rankings 행 없으면 빈 배열 */ }

        return jsonResponse({
            success: true,
            account: {
                id: account.id,
                nickname: account.nickname,
                isAnonymous: !!account.is_anonymous,
                email: account.email,
                emailVerified: !!account.email_verified,
                hasGoogle: !!account.has_google,
                hasPassword: !!account.has_password,
                avatarUrl: account.avatar_url,
                createdAt: account.created_at,
            },
            traits,
            voicematch,
            games,
        });
    } catch (e: any) {
        return errorResponse(e.message, 500);
    }
};
