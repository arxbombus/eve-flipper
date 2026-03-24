package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"eve-flipper/internal/auth"
	"eve-flipper/internal/db"
	"eve-flipper/internal/esi"
)

const outputPath = "/tmp/eve-flipper-corp-assets-debug.json"

type corpAssetSample struct {
	ItemID       int64  `json:"item_id"`
	TypeID       int32  `json:"type_id"`
	LocationID   int64  `json:"location_id"`
	LocationType string `json:"location_type"`
	LocationFlag string `json:"location_flag"`
	Quantity     int64  `json:"quantity"`
	IsSingleton  bool   `json:"is_singleton"`
}

type corpAttempt struct {
	CharacterID   int64             `json:"character_id"`
	CharacterName string            `json:"character_name"`
	Success       bool              `json:"success"`
	Error         string            `json:"error,omitempty"`
	AssetCount    int               `json:"asset_count"`
	Samples       []corpAssetSample `json:"samples,omitempty"`
}

type corpReport struct {
	CorporationID   int32         `json:"corporation_id"`
	CorporationName string        `json:"corporation_name,omitempty"`
	Attempts        []corpAttempt `json:"attempts"`
}

type report struct {
	GeneratedAt  string       `json:"generated_at"`
	DBPath       string       `json:"db_path"`
	SessionCount int          `json:"session_count"`
	Sessions     []sessionRef `json:"sessions"`
	Reports      []corpReport `json:"reports"`
}

type sessionRef struct {
	UserID        string `json:"user_id"`
	CharacterID   int64  `json:"character_id"`
	CharacterName string `json:"character_name"`
	ExpiresAt     string `json:"expires_at"`
	Active        bool   `json:"active"`
}

func loadDotEnv() {
	paths := []string{".env"}
	if exePath, err := os.Executable(); err == nil {
		if exeDir := filepath.Dir(exePath); exeDir != "" {
			paths = append(paths, filepath.Join(exeDir, ".env"))
		}
	}
	seen := make(map[string]bool)
	for _, p := range paths {
		if seen[p] {
			continue
		}
		seen[p] = true
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			if key != "" && os.Getenv(key) == "" {
				_ = os.Setenv(key, val)
			}
		}
	}
}

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func newSSOConfig() *auth.SSOConfig {
	clientID := envOrDefault("ESI_CLIENT_ID", "")
	clientSecret := envOrDefault("ESI_CLIENT_SECRET", "")
	callbackURL := envOrDefault("ESI_CALLBACK_URL", "http://localhost:13370/api/auth/callback")
	if clientID == "" || clientSecret == "" {
		return nil
	}
	return &auth.SSOConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		CallbackURL:  callbackURL,
		Scopes:       os.Getenv("ESI_SCOPES"),
	}
}

func main() {
	loadDotEnv()

	database, err := db.Open()
	if err != nil {
		fail(fmt.Errorf("open database: %w", err))
	}
	defer database.Close()

	sessionStore := auth.NewSessionStore(database.SqlDB())
	esiClient := esi.NewClient(database)
	userIDs, err := listUserIDs(database.SqlDB())
	if err != nil {
		fail(fmt.Errorf("list auth_session user IDs: %w", err))
	}
	ssoConfig := newSSOConfig()
	reportByCorp := make(map[int32]*corpReport)
	allSessions := make([]sessionRef, 0)

	for _, userID := range userIDs {
		sessions := sessionStore.ListForUser(userID)
		for _, sess := range sessions {
			allSessions = append(allSessions, sessionRef{
				UserID:        userID,
				CharacterID:   sess.CharacterID,
				CharacterName: sess.CharacterName,
				ExpiresAt:     sess.ExpiresAt.UTC().Format(time.RFC3339),
				Active:        sess.Active,
			})

			token, err := sessionStore.EnsureValidTokenForUserCharacter(ssoConfig, userID, sess.CharacterID)
			if err != nil {
				recordAttempt(reportByCorp, 0, "", corpAttempt{
					CharacterID:   sess.CharacterID,
					CharacterName: fmt.Sprintf("%s [%s]", sess.CharacterName, userID),
					Success:       false,
					Error:         "token: " + err.Error(),
				})
				continue
			}

			corpID, err := esiClient.GetCharacterCorporationID(sess.CharacterID)
			if err != nil {
				recordAttempt(reportByCorp, 0, "", corpAttempt{
					CharacterID:   sess.CharacterID,
					CharacterName: fmt.Sprintf("%s [%s]", sess.CharacterName, userID),
					Success:       false,
					Error:         "corporation: " + err.Error(),
				})
				continue
			}

			corpName := ""
			if info, infoErr := esiClient.GetCorporationInfo(corpID); infoErr == nil {
				corpName = info.CorporationName
			}

			assets, err := esiClient.GetCorporationAssets(corpID, token)
			attempt := corpAttempt{
				CharacterID:   sess.CharacterID,
				CharacterName: fmt.Sprintf("%s [%s]", sess.CharacterName, userID),
				Success:       err == nil,
			}
			if err != nil {
				attempt.Error = err.Error()
			} else {
				attempt.AssetCount = len(assets)
				limit := len(assets)
				if limit > 20 {
					limit = 20
				}
				attempt.Samples = make([]corpAssetSample, 0, limit)
				for _, asset := range assets[:limit] {
					attempt.Samples = append(attempt.Samples, corpAssetSample{
						ItemID:       asset.ItemID,
						TypeID:       asset.TypeID,
						LocationID:   asset.LocationID,
						LocationType: asset.LocationType,
						LocationFlag: asset.LocationFlag,
						Quantity:     asset.Quantity,
						IsSingleton:  asset.IsSingleton,
					})
				}
			}
			recordAttempt(reportByCorp, corpID, corpName, attempt)
		}
	}

	out := report{
		GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		DBPath:       filepath.Join(mustGetwd(), "flipper.db"),
		SessionCount: len(allSessions),
		Sessions:     allSessions,
		Reports:      make([]corpReport, 0, len(reportByCorp)),
	}
	for _, entry := range reportByCorp {
		sort.Slice(entry.Attempts, func(i, j int) bool {
			return entry.Attempts[i].CharacterName < entry.Attempts[j].CharacterName
		})
		out.Reports = append(out.Reports, *entry)
	}
	sort.Slice(out.Reports, func(i, j int) bool {
		if out.Reports[i].CorporationName == out.Reports[j].CorporationName {
			return out.Reports[i].CorporationID < out.Reports[j].CorporationID
		}
		return out.Reports[i].CorporationName < out.Reports[j].CorporationName
	})

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fail(fmt.Errorf("marshal report: %w", err))
	}
	if err := os.WriteFile(outputPath, data, 0644); err != nil {
		fail(fmt.Errorf("write %s: %w", outputPath, err))
	}
	fmt.Println(outputPath)
}

func recordAttempt(reportByCorp map[int32]*corpReport, corpID int32, corpName string, attempt corpAttempt) {
	entry := reportByCorp[corpID]
	if entry == nil {
		entry = &corpReport{
			CorporationID:   corpID,
			CorporationName: corpName,
			Attempts:        make([]corpAttempt, 0, 1),
		}
		reportByCorp[corpID] = entry
	}
	if entry.CorporationName == "" {
		entry.CorporationName = corpName
	}
	entry.Attempts = append(entry.Attempts, attempt)
}

func listUserIDs(sqlDB *sql.DB) ([]string, error) {
	rows, err := sqlDB.Query(`SELECT DISTINCT user_id FROM auth_session ORDER BY user_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		out = append(out, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
