package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

func VerifyHookSignature(secretHex, timestamp string, body []byte, presented string, now time.Time) error {
	secretHex = strings.TrimPrefix(secretHex, "whsec_")
	key, err := hex.DecodeString(secretHex)
	if err != nil {
		return errors.New("signing secret is not valid hex")
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return errors.New("timestamp is not an integer")
	}
	drift := now.Sub(time.Unix(seconds, 0))
	if drift < 0 {
		drift = -drift
	}
	if drift > 5*time.Minute {
		return errors.New("timestamp is outside the accepted window")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	presented = strings.TrimPrefix(presented, hookSignatureVersion+"=")
	// Constant time: a byte-at-a-time comparison leaks how much of a guessed
	// signature was right, which is enough to find the rest.
	if subtle.ConstantTimeCompare([]byte(expected), []byte(presented)) != 1 {
		return errors.New("signature does not match")
	}
	return nil
}
