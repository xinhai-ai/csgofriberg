import { Player, GuessFeedback, AttributeFeedback } from '../types';

const CURRENT_YEAR = new Date().getFullYear();

function textAttr(guess: string, target: string): AttributeFeedback {
  return { value: guess, level: guess === target ? 'correct' : 'wrong' };
}

/** 国籍: 相同 correct;不同但同赛区 close */
function nationalityAttr(guess: Player, target: Player): AttributeFeedback {
  if (guess.nationality === target.nationality)
    return { value: guess.nationality, level: 'correct' };
  if (guess.region && guess.region === target.region)
    return { value: guess.nationality, level: 'close' };
  return { value: guess.nationality, level: 'wrong' };
}

function numberAttr(
  guessVal: number,
  targetVal: number,
  closeRange: number
): AttributeFeedback {
  if (guessVal === targetVal) return { value: guessVal, level: 'correct' };
  const level = Math.abs(guessVal - targetVal) <= closeRange ? 'close' : 'wrong';
  return {
    value: guessVal,
    level,
    hint: targetVal > guessVal ? 'higher' : 'lower',
  };
}

export function ageOf(p: Player): number {
  return CURRENT_YEAR - p.birth_year;
}

/** 逐属性对比猜测选手与目标选手,产出反馈 */
export function compareGuess(guess: Player, target: Player): GuessFeedback {
  const correct = guess.id === target.id;
  return {
    playerId: guess.id,
    nickname: guess.nickname,
    correct,
    attributes: {
      nationality: nationalityAttr(guess, target),
      region: textAttr(guess.region, target.region),
      team: textAttr(guess.team, target.team),
      age: numberAttr(ageOf(guess), ageOf(target), 2),
      role: textAttr(guess.role, target.role),
      majorChampionships: numberAttr(
        guess.major_championships,
        target.major_championships,
        1
      ),
      majorAppearances: numberAttr(
        guess.major_appearances,
        target.major_appearances,
        2
      ),
      isActive: {
        value: Boolean(guess.is_active),
        level: Boolean(guess.is_active) === Boolean(target.is_active) ? 'correct' : 'wrong',
      },
    },
  };
}

/** Upgrade Redis game snapshots created before a feedback attribute was added. */
export function completeGuessFeedback(
  feedback: GuessFeedback,
  guess?: Player,
  target?: Player
): GuessFeedback {
  if (feedback.attributes.majorChampionships) return feedback;
  return {
    ...feedback,
    attributes: {
      ...feedback.attributes,
      majorChampionships: guess && target
        ? numberAttr(guess.major_championships, target.major_championships, 1)
        : { value: '-', level: 'wrong' },
    },
  };
}

export const MAX_GUESSES = 8;
