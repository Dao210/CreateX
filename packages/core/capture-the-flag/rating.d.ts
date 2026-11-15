export function calculateLeaderboard(
  records: { team_id: string; team_name: string; enhancement_mode?: string }[],
  matches: {
    arena_run_id: string;
    uploaded_at: string;
    red_strategy_id: string;
    blue_strategy_id: string;
    red_strategy_name: string;
    blue_strategy_name: string;
    series_result: string;
  }[],
): {
  entries: {
    strategy_id: string;
    strategy_name: string;
    rating: number;
    rating_deviation: number;
    conservative_rating: number;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    rank: number;
    provisional: boolean;
  }[];
};
