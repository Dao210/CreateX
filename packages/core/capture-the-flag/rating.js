const INITIAL_RATING = 1500;
const INITIAL_RD = 350;
const INITIAL_VOLATILITY = 0.06;
const SCALE = 173.7178;
const TAU = 0.5;
const EPSILON = 0.000001;
const VALID_SERIES_RESULTS = new Set(["red", "blue", "draw"]);

function calculateLeaderboard(strategyRecords, matches) {
  const players = new Map();
  for (const record of strategyRecords)
    ensurePlayer(
      players,
      record.team_id,
      record.team_name,
      record.enhancement_mode,
    );
  for (const match of matches) {
    ensurePlayer(
      players,
      match.red_strategy_id,
      match.red_strategy_name,
      match.red_enhancement_mode,
    );
    ensurePlayer(
      players,
      match.blue_strategy_id,
      match.blue_strategy_name,
      match.blue_enhancement_mode,
    );
  }

  const ratedSeries = collapseSeriesResults(matches);
  const periods = groupRatingPeriods(ratedSeries);
  for (const period of periods) {
    const before = new Map(
      [...players].map(([id, player]) => [id, { ...player }]),
    );
    const results = new Map();
    for (const match of period.matches) {
      const red = players.get(match.red_strategy_id);
      const blue = players.get(match.blue_strategy_id);
      if (!red || !blue) continue;
      const redScore =
        match.winner === "red" ? 1 : match.winner === "blue" ? 0 : 0.5;
      addResult(results, red.id, before.get(blue.id), redScore);
      addResult(results, blue.id, before.get(red.id), 1 - redScore);
      updateStats(red, redScore);
      updateStats(blue, 1 - redScore);
    }
    for (const [id, games] of results) {
      const current = players.get(id);
      Object.assign(current, updateRating(before.get(id), games));
    }
  }

  const entries = [...players.values()].map((player) => ({
    strategy_id: player.id,
    strategy_name: player.name,
    enhancement_mode: player.enhancement_mode,
    rating: round(player.rating),
    rating_deviation: round(player.rd),
    volatility: Number(player.volatility.toFixed(6)),
    conservative_rating: round(player.rating - 2 * player.rd),
    games: player.games,
    wins: player.wins,
    draws: player.draws,
    losses: player.losses,
    score_rate: player.games
      ? Number(((player.wins + player.draws * 0.5) / player.games).toFixed(4))
      : 0,
    provisional: player.games < 10,
  }));
  entries.sort(
    (a, b) =>
      b.conservative_rating - a.conservative_rating ||
      b.rating - a.rating ||
      a.strategy_id.localeCompare(b.strategy_id, "zh-CN"),
  );
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });
  return {
    algorithm: "Glicko-2",
    initial_rating: INITIAL_RATING,
    initial_rating_deviation: INITIAL_RD,
    initial_volatility: INITIAL_VOLATILITY,
    rating_period: "每份已上传竞技场批次为一个评级周期；静态策略不应用闲置衰减",
    calculated_at: new Date().toISOString(),
    match_count: matches.length,
    rated_series_count: ratedSeries.length,
    period_count: periods.length,
    entries,
  };
}

function collapseSeriesResults(matches) {
  const series = new Map();
  for (const match of matches) {
    const key = `${match.arena_run_id}\u0000${match.red_strategy_id}\u0000${match.blue_strategy_id}`;
    if (series.has(key)) continue;
    series.set(key, {
      arena_run_id: match.arena_run_id,
      uploaded_at: match.uploaded_at,
      red_strategy_id: match.red_strategy_id,
      red_strategy_name: match.red_strategy_name,
      red_enhancement_mode: match.red_enhancement_mode,
      blue_strategy_id: match.blue_strategy_id,
      blue_strategy_name: match.blue_strategy_name,
      blue_enhancement_mode: match.blue_enhancement_mode,
      winner: VALID_SERIES_RESULTS.has(match.series_result)
        ? match.series_result
        : "draw",
    });
  }
  return [...series.values()];
}

function ensurePlayer(players, id, name, enhancementMode) {
  if (!id || players.has(id)) return;
  players.set(id, {
    id,
    name: name || id,
    enhancement_mode: enhancementMode || "standard",
    rating: INITIAL_RATING,
    rd: INITIAL_RD,
    volatility: INITIAL_VOLATILITY,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
  });
}

function groupRatingPeriods(matches) {
  const grouped = new Map();
  for (const match of matches) {
    const id = match.arena_run_id;
    if (!grouped.has(id))
      grouped.set(id, {
        id,
        uploaded_at: match.uploaded_at || "",
        matches: [],
      });
    grouped.get(id).matches.push(match);
  }
  return [...grouped.values()].sort(
    (a, b) =>
      a.uploaded_at.localeCompare(b.uploaded_at) || a.id.localeCompare(b.id),
  );
}

function addResult(results, playerId, opponent, score) {
  if (!results.has(playerId)) results.set(playerId, []);
  results.get(playerId).push({ opponent, score });
}

function updateStats(player, score) {
  player.games += 1;
  if (score === 1) player.wins += 1;
  else if (score === 0) player.losses += 1;
  else player.draws += 1;
}

function updateRating(player, results) {
  const mu = (player.rating - INITIAL_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const converted = results.map(({ opponent, score }) => ({
    mu: (opponent.rating - INITIAL_RATING) / SCALE,
    phi: opponent.rd / SCALE,
    score,
  }));
  const variance =
    1 /
    converted.reduce((sum, result) => {
      const expected = expectedScore(mu, result.mu, result.phi);
      return sum + Math.pow(g(result.phi), 2) * expected * (1 - expected);
    }, 0);
  const improvement =
    variance *
    converted.reduce((sum, result) => {
      return (
        sum +
        g(result.phi) *
          (result.score - expectedScore(mu, result.mu, result.phi))
      );
    }, 0);
  const volatility = updateVolatility(
    phi,
    player.volatility,
    variance,
    improvement,
  );
  const preRatingPhi = Math.sqrt(phi * phi + volatility * volatility);
  const newPhi =
    1 / Math.sqrt(1 / (preRatingPhi * preRatingPhi) + 1 / variance);
  const scoreAdjustment = converted.reduce((sum, result) => {
    return (
      sum +
      g(result.phi) * (result.score - expectedScore(mu, result.mu, result.phi))
    );
  }, 0);
  const newMu = mu + newPhi * newPhi * scoreAdjustment;
  return {
    rating: newMu * SCALE + INITIAL_RATING,
    rd: Math.min(INITIAL_RD, newPhi * SCALE),
    volatility,
  };
}

function updateVolatility(phi, volatility, variance, improvement) {
  const a = Math.log(volatility * volatility);
  const f = (x) => {
    const expX = Math.exp(x);
    const numerator =
      expX * (improvement * improvement - phi * phi - variance - expX);
    const denominator = 2 * Math.pow(phi * phi + variance + expX, 2);
    return numerator / denominator - (x - a) / (TAU * TAU);
  };
  let lower = a;
  let upper;
  if (improvement * improvement > phi * phi + variance) {
    upper = Math.log(improvement * improvement - phi * phi - variance);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    upper = a - k * TAU;
  }
  let fLower = f(lower);
  let fUpper = f(upper);
  while (Math.abs(upper - lower) > EPSILON) {
    const candidate = lower + ((lower - upper) * fLower) / (fUpper - fLower);
    const fCandidate = f(candidate);
    if (fCandidate * fUpper <= 0) {
      lower = upper;
      fLower = fUpper;
    } else {
      fLower /= 2;
    }
    upper = candidate;
    fUpper = fCandidate;
  }
  return Math.exp(lower / 2);
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu, opponentMu, opponentPhi) {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

function round(value) {
  return Number(value.toFixed(2));
}

export { calculateLeaderboard };
