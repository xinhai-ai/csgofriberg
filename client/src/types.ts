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
    majorAppearances: AttributeFeedback;
    isActive: AttributeFeedback;
  };
}

export interface UserInfo {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

export interface PlayerInfo {
  id: number;
  nickname: string;
  realName: string;
  nationality: string;
  region: string;
  team: string;
  age: number;
  role: string;
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
  guesses: GuessFeedback[];
}

export interface RoomState {
  id: string;
  hostKey: string;
  status: 'waiting' | 'playing' | 'round_over' | 'finished';
  dbType: 'easy' | 'normal';
  boType: number;
  round: number;
  winsNeeded: number;
  maxGuesses: number;
  roundEndsAt: number | null;
  spectators: { key: string; name: string }[];
  players: RoomPlayer[];
}
