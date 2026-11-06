SELECT
    arrayJoin([1, 2, 3, 4, 5]) AS step,
    arrayElement(['首页访问', '点击开始', '注册成功', '引导完成', '首次开局'], step) AS funnel_step,
    countIf(reached >= step) AS users
FROM (
    SELECT person_id,
        windowFunnel(604800)(toDateTime(timestamp),
            event = '$pageview' AND properties.page = '/',
            event = 'cta_clicked' AND properties.cta = 'header_play',
            event = 'signup',
            event = 'onboarding_completed',
            event = 'battle_started') AS reached
    FROM events
    WHERE timestamp >= now() - INTERVAL 30 DAY
      AND properties.environment = 'production'
      AND ifNull(toString(properties.is_test), '') != 'true'
    GROUP BY person_id
)
GROUP BY step
ORDER BY step
