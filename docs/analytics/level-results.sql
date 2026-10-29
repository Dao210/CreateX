SELECT
    toString(properties.game) AS game,
    toString(properties.mode) AS mode,
    ifNull(toString(properties.level_id), 'workshop') AS level,
    ifNull(toString(properties.difficulty), 'standard') AS difficulty,
    countIf(event = 'battle_started') AS attempts,
    countIf(event = 'battle_ended' AND properties.result IN ('victory', 'level_cleared')) AS wins,
    countIf(event = 'battle_ended' AND properties.result = 'defeat') AS defeats,
    countIf(event = 'battle_ended' AND properties.result = 'completed') AS practice_completed,
    if(countIf(event = 'battle_ended') > 0,
       round(avgIf(toFloat(properties.active_duration_ms), event = 'battle_ended') / 60000, 2),
       NULL) AS avg_active_minutes
FROM events
WHERE event IN ('battle_started', 'battle_ended')
  AND properties.environment = 'production'
  AND ifNull(toString(properties.is_test), '') != 'true'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY game, mode, level, difficulty
ORDER BY game, mode, level
