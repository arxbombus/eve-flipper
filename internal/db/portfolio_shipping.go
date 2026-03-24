package db

import (
	"errors"
	"strings"
	"time"

	"eve-flipper/internal/config"
)

func normalizePortfolioShippingRule(rule config.PortfolioShippingRule) config.PortfolioShippingRule {
	rule.LocationName = strings.TrimSpace(rule.LocationName)
	rule.SystemName = strings.TrimSpace(rule.SystemName)
	if rule.CostPerM3 < 0 {
		rule.CostPerM3 = 0
	}
	return rule
}

func scanPortfolioShippingRule(scanner rowScanner) (config.PortfolioShippingRule, error) {
	var rule config.PortfolioShippingRule
	err := scanner.Scan(
		&rule.ID,
		&rule.LocationID,
		&rule.LocationName,
		&rule.SystemID,
		&rule.SystemName,
		&rule.CostPerM3,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	)
	return rule, err
}

func (d *DB) ListPortfolioShippingRulesForUser(userID string) ([]config.PortfolioShippingRule, error) {
	userID = normalizeUserID(userID)
	rows, err := d.sql.Query(`
		SELECT id, location_id, location_name, system_id, system_name, cost_per_m3, created_at, updated_at
		  FROM portfolio_shipping_rules
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []config.PortfolioShippingRule
	for rows.Next() {
		rule, err := scanPortfolioShippingRule(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if rules == nil {
		return []config.PortfolioShippingRule{}, nil
	}
	return rules, nil
}

func (d *DB) GetPortfolioShippingRuleForUser(userID string, ruleID int64) (config.PortfolioShippingRule, error) {
	userID = normalizeUserID(userID)
	row := d.sql.QueryRow(`
		SELECT id, location_id, location_name, system_id, system_name, cost_per_m3, created_at, updated_at
		  FROM portfolio_shipping_rules
		 WHERE user_id = ? AND id = ?
	`, userID, ruleID)
	return scanPortfolioShippingRule(row)
}

func (d *DB) CreatePortfolioShippingRuleForUser(userID string, rule config.PortfolioShippingRule) (config.PortfolioShippingRule, error) {
	userID = normalizeUserID(userID)
	rule = normalizePortfolioShippingRule(rule)
	if rule.LocationID <= 0 {
		return config.PortfolioShippingRule{}, errors.New("location is required")
	}
	if rule.SystemID <= 0 {
		return config.PortfolioShippingRule{}, errors.New("system is required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.sql.Exec(`
		INSERT INTO portfolio_shipping_rules (
			user_id, location_id, location_name, system_id, system_name, cost_per_m3, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, userID, rule.LocationID, rule.LocationName, rule.SystemID, rule.SystemName, rule.CostPerM3, now, now)
	if err != nil {
		return config.PortfolioShippingRule{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return config.PortfolioShippingRule{}, err
	}
	return d.GetPortfolioShippingRuleForUser(userID, id)
}

func (d *DB) UpdatePortfolioShippingRuleForUser(userID string, ruleID int64, rule config.PortfolioShippingRule) (config.PortfolioShippingRule, error) {
	userID = normalizeUserID(userID)
	rule = normalizePortfolioShippingRule(rule)
	if rule.LocationID <= 0 {
		return config.PortfolioShippingRule{}, errors.New("location is required")
	}
	if rule.SystemID <= 0 {
		return config.PortfolioShippingRule{}, errors.New("system is required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.sql.Exec(`
		UPDATE portfolio_shipping_rules
		   SET location_id = ?, location_name = ?, system_id = ?, system_name = ?, cost_per_m3 = ?, updated_at = ?
		 WHERE user_id = ? AND id = ?
	`, rule.LocationID, rule.LocationName, rule.SystemID, rule.SystemName, rule.CostPerM3, now, userID, ruleID)
	if err != nil {
		return config.PortfolioShippingRule{}, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return config.PortfolioShippingRule{}, err
	}
	if affected == 0 {
		return config.PortfolioShippingRule{}, errors.New("shipping rule not found")
	}
	return d.GetPortfolioShippingRuleForUser(userID, ruleID)
}

func (d *DB) DeletePortfolioShippingRuleForUser(userID string, ruleID int64) error {
	userID = normalizeUserID(userID)
	_, err := d.sql.Exec(`DELETE FROM portfolio_shipping_rules WHERE user_id = ? AND id = ?`, userID, ruleID)
	return err
}
