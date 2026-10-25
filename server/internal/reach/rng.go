package reach

// Deterministic pseudo-randomness. The world never uses math/rand: every draw
// is derived from the season seed plus a stable key, so a replay of beat 4,000
// lands on the same wander target as the original run.

func mix64(x uint64) uint64 {
	x += 0x9E3779B97F4A7C15
	x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9
	x = (x ^ (x >> 27)) * 0x94D049BB133111EB
	return x ^ (x >> 31)
}

func hashString(key string) uint64 {
	const offset, prime = 14695981039346656037, 1099511628211
	h := uint64(offset)
	for i := 0; i < len(key); i++ {
		h ^= uint64(key[i])
		h *= prime
	}
	return h
}

// draw returns a value in [0, n) derived from seed, beat and key. It is stable
// across processes and machines.
func draw(seed uint64, beat int64, key string, n int64) int64 {
	if n <= 0 {
		return 0
	}
	v := mix64(seed ^ uint64(beat)<<17 ^ hashString(key))
	return int64(v % uint64(n))
}

// drawUnit returns milli-units in [0, 1000), handy for probability checks.
func drawUnit(seed uint64, beat int64, key string) int64 {
	return draw(seed, beat, key, 1000)
}
