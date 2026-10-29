SELECT
    toDate(timestamp, 'Asia/Shanghai') AS day,
    coalesce(nullIf(toString(properties.utm_source), ''),
             nullIf(nullIf(toString(properties.$referring_domain), ''), '$direct'),
             'direct') AS source,
    ifNull(nullIf(toString(properties.$geoip_country_code), ''), 'unknown') AS country,
    ifNull(nullIf(toString(properties.language), ''), 'unknown') AS language,
    uniq(person_id) AS visitors,
    count() AS pageviews
FROM events
WHERE event = '$pageview' AND properties.page = '/'
  AND properties.environment = 'production'
  AND ifNull(toString(properties.is_test), '') != 'true'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY day, source, country, language
ORDER BY day DESC, visitors DESC
LIMIT 200
