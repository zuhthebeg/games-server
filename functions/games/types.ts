/**
 * Game Plugin System Types
 * 
 * 새 게임 추가 시 GamePlugin 인터페이스만 구현하면 됨
 */

export interface Player {
    id: string;
    nickname: string;
    seat: number;
}

export interface GameAction {
    type: string;
    payload?: any;
}

export interface GameEvent {
    type: string;
    playerId?: string;
    payload?: any;
    timestamp?: string;
}

export interface GameResult {
    winnerId?: string;
    winnerIds?: string[];  // 복수 승자 (팀전)
    scores?: Record<string, number>;
    reason?: string;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

export interface ActionResult {
    newState: any;
    events: GameEvent[];
}

/**
 * 게임 플러그인 인터페이스
 * 
 * 모든 게임은 이 인터페이스를 구현해야 함
 */
export interface GamePlugin {
    // === 메타데이터 ===
    id: string;             // "poker", "uno", "chess"
    name: string;           // "텍사스 홀덤", "우노"
    minPlayers: number;
    maxPlayers: number;
    
    // === 초기화 ===
    /** 게임 시작 시 초기 상태 생성 */
    createInitialState(players: Player[], config?: any): any;
    
    // === 액션 처리 ===
    /** 액션 유효성 검증 (상태 변경 없음) */
    validateAction(state: any, action: GameAction, playerId: string): ValidationResult;
    
    /** 액션 적용 후 새 상태 반환 */
    applyAction(state: any, action: GameAction, playerId: string): ActionResult;
    
    // === 상태 확인 ===
    /** 현재 턴인 플레이어 ID (null이면 동시 턴) */
    getCurrentTurn(state: any): string | null;
    
    /** 게임 종료 여부 */
    isGameOver(state: any): boolean;
    
    /** 게임 결과 (게임 종료 시) */
    getResult(state: any): GameResult | null;
    
    // === 뷰 ===
    /** 모든 플레이어에게 공개되는 상태 */
    getPublicState(state: any): any;
    
    /** 특정 플레이어 시점의 상태 (비공개 정보 포함) */
    getPlayerView(state: any, playerId: string): any;
    
    // === 선택적 ===
    /** 타임아웃 시 자동 액션 (선택) */
    getTimeoutAction?(state: any, playerId: string): GameAction | null;
    
    /** AI 플레이어 액션 (선택) */
    getAIAction?(state: any, playerId: string, difficulty?: string): GameAction;
}

/**
 * 게임 설정 (방 생성 시)
 */
export interface GameConfig {
    [key: string]: any;
}

/**
 * 플러그인 등록 정보
 */
export interface GameRegistryEntry {
    plugin: GamePlugin;
    defaultConfig?: GameConfig;
}
