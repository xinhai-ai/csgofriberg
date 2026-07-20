export type FeedbackLevel = 'correct' | 'close' | 'wrong';

export interface AttributeFeedback {
  value: string | number | boolean;
  level: FeedbackLevel;
  hint?: 'higher' | 'lower';
}

export interface GuessFeedback {
  playerId: number;
  nickname: string;
  correct: boolean;
  attributes: {
    nationality: AttributeFeedback;
    region: AttributeFeedback;
    team: AttributeFeedback;
    age: AttributeFeedback;
    role: AttributeFeedback;
    majorChampionships: AttributeFeedback;
    majorAppearances: AttributeFeedback;
    isActive: AttributeFeedback;
  };
}

export type HiddenAttributeFeedback = Pick<AttributeFeedback, 'level' | 'hint'>;

export interface HiddenGuessFeedback {
  hidden: true;
  correct: boolean;
  attributes: {
    nationality: HiddenAttributeFeedback;
    region: HiddenAttributeFeedback;
    team: HiddenAttributeFeedback;
    age: HiddenAttributeFeedback;
    role: HiddenAttributeFeedback;
    majorChampionships: HiddenAttributeFeedback;
    majorAppearances: HiddenAttributeFeedback;
    isActive: HiddenAttributeFeedback;
  };
}

export type MultiplayerGuessFeedback = GuessFeedback | HiddenGuessFeedback;

export interface UserInfo {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

export interface PlayerInfo {
  id: number;
  nickname: string;
  nationality: string;
  region: string;
  team: string;
  age: number;
  role: string;
  majorChampionships: number;
  majorAppearances: number;
  isActive: boolean;
}

export interface RoomPlayer {
  key: string;
  name: string;
  ready: boolean;
  connected: boolean;
  score: number;
  guessCount: number;
  guesses: MultiplayerGuessFeedback[];
}

export interface RoomState {
  id: string;
  hostKey: string;
  status: 'waiting' | 'playing' | 'round_over' | 'finished';
  dbType: 'easy' | 'normal';
  boType: number;
  allowSpectators: boolean;
  anonymous: boolean;
  round: number;
  roundId: number;
  stateVersion: number;
  winsNeeded: number;
  maxGuesses: number;
  roundEndsAt: number | null;
  spectators: { key: string; name: string }[];
  players: RoomPlayer[];
  roundResult: {
    winnerKey: string | null;
    reason: string;
    answer: {
      nickname: string;
      team: string;
      nationality: string;
      role: string;
      majorChampionships: number;
      majorAppearances: number;
    } | null;
    matchOver: boolean;
    nextRoundInMs?: number;
  } | null;
  matchResult: {
    winnerKey: string | null;
    reason: string;
    answer: {
      nickname: string;
      team: string;
      nationality: string;
      role: string;
      majorChampionships: number;
      majorAppearances: number;
    } | null;
  } | null;
}

export interface RoomPatch {
  roomId: string;
  baseVersion: number;
  stateVersion: number;
  hostKey?: string;
  players?: {
    added?: RoomPlayer[];
    updated?: Array<Partial<RoomPlayer> & { key: string }>;
    removed?: string[];
  };
  spectators?: {
    added?: Array<{ key: string; name: string }>;
    removed?: string[];
  };
}

export interface PresenceStats {
  onlineUsers: number;
  multiplayerRooms: number;
  singleGames: number;
  updatedAt: number;
}
