SELECT
    toString(properties.game) AS game,
    toString(properties.mode) AS mode,
    uniqIf(person_id, event = 'battle_started') AS players,
    countIf(event = 'battle_started') AS attempts,
    countIf(event = 'battle_ended') AS observed_ends,
    if(countIf(event = 'battle_ended') > 0,
       round(avgIf(toFloat(properties.active_duration_ms), event = 'battle_ended') / 60000, 2),
       NULL) AS avg_active_minutes
FROM events
WHERE event IN ('battle_started', 'battle_ended')
  AND properties.environment = 'production'
  AND ifNull(toString(properties.is_test), '') != 'true'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY game, mode
ORDER BY players DESC
