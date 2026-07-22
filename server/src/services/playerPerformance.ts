import { db } from '../db/knex';
import { StoredIdentity } from './roomStore';

function summary(row: any, includeGuessMetrics: boolean) {
  const games = Number(row?.games ?? 0);
  const wins = Number(row?.wins ?? 0);
  return {
    games,
    wins,
    losses: Math.max(0, games - wins),
    winRate: games ? wins / games : 0,
    ...(includeGuessMetrics
      ? {
          avgGuesses: row?.avgGuesses != null ? Number(row.avgGuesses) : null,
          bestGuesses: row?.bestGuesses != null ? Number(row.bestGuesses) : null,
        }
      : {}),
  };
}

/** Lightweight public performance summary for a room member. */
export async function getPlayerPerformance(identity: StoredIdentity) {
  const singleQuery = db('games').whereNot('status', 'playing');
  if (identity.userId !== null) {
    singleQuery.where({ user_id: identity.userId });
  } else if (identity.key.startsWith('g:')) {
    singleQuery.where({ guest_key: identity.key.slice(2) });
  } else {
    singleQuery.whereRaw('1 = 0');
  }

  const [single, multi] = await Promise.all([
    singleQuery
      .first()
      .count({ games: 'id' })
      .sum({ wins: db.raw("case when status = 'won' then 1 else 0 end") })
      .avg({ avgGuesses: db.raw("case when status = 'won' then guess_count else null end") })
      .min({ bestGuesses: db.raw("case when status = 'won' then guess_count else null end") }),
    db('match_players')
      .where({ player_key: identity.key })
      .first()
      .count({ games: 'id' })
      .sum({ wins: db.raw('case when is_winner then 1 else 0 end') }),
  ]);

  return {
    single: summary(single, true),
    multi: summary(multi, false),
  };
}
