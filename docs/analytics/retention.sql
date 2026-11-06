WITH first_plays AS (
    SELECT person_id, toString(properties.game) AS game,
           min(toDate(timestamp, 'Asia/Shanghai')) AS first_day
    FROM events
    WHERE event = 'battle_started'
      AND properties.environment = 'production'
      AND ifNull(toString(properties.is_test), '') != 'true'
    GROUP BY person_id, game
), plays AS (
    SELECT DISTINCT person_id, toString(properties.game) AS game,
                    toDate(timestamp, 'Asia/Shanghai') AS play_day
    FROM events
    WHERE event = 'battle_started'
      AND properties.environment = 'production'
      AND ifNull(toString(properties.is_test), '') != 'true'
      AND timestamp >= now() - INTERVAL 37 DAY
)
SELECT first_plays.first_day AS cohort_day,
       first_plays.game AS game,
       uniq(first_plays.person_id) AS new_players,
       if(dateDiff('day', cohort_day, toDate(now(), 'Asia/Shanghai')) >= 1,
          round(100.0 * uniqIf(first_plays.person_id, dateDiff('day', cohort_day, plays.play_day) = 1)
                / uniq(first_plays.person_id), 1), NULL) AS d1_percent,
       if(dateDiff('day', cohort_day, toDate(now(), 'Asia/Shanghai')) >= 7,
          round(100.0 * uniqIf(first_plays.person_id, dateDiff('day', cohort_day, plays.play_day) = 7)
                / uniq(first_plays.person_id), 1), NULL) AS d7_percent
FROM first_plays
LEFT JOIN plays ON first_plays.person_id = plays.person_id AND first_plays.game = plays.game
WHERE first_plays.first_day >= toDate(now(), 'Asia/Shanghai') - INTERVAL 30 DAY
GROUP BY cohort_day, game
ORDER BY cohort_day DESC, game
