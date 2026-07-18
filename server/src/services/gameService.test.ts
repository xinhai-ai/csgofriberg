import { describe, it, expect } from 'vitest';
import { compareGuess, ageOf } from './gameService';
import { Player } from '../types';

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: 1,
    nickname: 'test',
    real_name: '',
    nationality: '瑞典',
    region: '欧洲',
    team: 'NIP',
    birth_year: 1991,
    role: 'Entry',
    major_appearances: 12,
    is_active: true,
    created_at: '',
    ...overrides,
  };
}

describe('compareGuess', () => {
  const target = makePlayer({ id: 10, nickname: 'friberg' });

  it('猜中时所有属性 correct', () => {
    const fb = compareGuess(target, target);
    expect(fb.correct).toBe(true);
    expect(Object.values(fb.attributes).every((a) => a.level === 'correct')).toBe(true);
  });

  it('同赛区不同国籍给 close', () => {
    const guess = makePlayer({ id: 2, nationality: '丹麦', region: '欧洲' });
    expect(compareGuess(guess, target).attributes.nationality.level).toBe('close');
  });

  it('不同赛区国籍给 wrong', () => {
    const guess = makePlayer({ id: 2, nationality: '巴西', region: '南美' });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.nationality.level).toBe('wrong');
    expect(fb.attributes.region.level).toBe('wrong');
  });

  it('年龄相差 2 岁以内给 close 并带方向提示', () => {
    const guess = makePlayer({ id: 2, birth_year: target.birth_year + 2 });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.age.level).toBe('close');
    // 猜的人更年轻,目标年龄更大
    expect(fb.attributes.age.hint).toBe('higher');
  });

  it('Major 次数差距大给 wrong 并带方向提示', () => {
    const guess = makePlayer({ id: 2, major_appearances: 2 });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.majorAppearances.level).toBe('wrong');
    expect(fb.attributes.majorAppearances.hint).toBe('higher');
  });

  it('现役状态不同给 wrong', () => {
    const guess = makePlayer({ id: 2, is_active: false });
    expect(compareGuess(guess, target).attributes.isActive.level).toBe('wrong');
  });

  it('ageOf 按当前年份计算', () => {
    expect(ageOf(makePlayer({ birth_year: new Date().getFullYear() - 25 }))).toBe(25);
  });
});
