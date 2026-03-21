package db

import (
	"errors"
	"strings"
	"time"

	"eve-flipper/internal/config"
	"eve-flipper/internal/engine"
)

func normalizeImportExportRoute(route config.ImportExportRoute) config.ImportExportRoute {
	route.Name = strings.TrimSpace(route.Name)
	route.SourceRegionName = strings.TrimSpace(route.SourceRegionName)
	route.TargetMarketSystemName = strings.TrimSpace(route.TargetMarketSystemName)
	route.TargetMarketLocationName = strings.TrimSpace(route.TargetMarketLocationName)
	route.TradeMode = engine.NormalizeTradeMode(route.TradeMode)
	route.ShippingMode = strings.TrimSpace(strings.ToLower(route.ShippingMode))
	if route.ShippingMode != "per_jump" {
		route.ShippingMode = "per_route"
	}
	if route.AvgPricePeriod <= 0 {
		route.AvgPricePeriod = 14
	}
	if route.PurchaseDemandDays <= 0 {
		route.PurchaseDemandDays = 0.5
	}
	if route.ShippingCostPerM3Jump < 0 {
		route.ShippingCostPerM3Jump = 0
	}
	if route.BuyBrokerFeePercent < 0 {
		route.BuyBrokerFeePercent = 0
	}
	if route.BuySalesTaxPercent < 0 {
		route.BuySalesTaxPercent = 0
	}
	if route.SellBrokerFeePercent < 0 {
		route.SellBrokerFeePercent = 0
	}
	if route.SellSalesTaxPercent < 0 {
		route.SellSalesTaxPercent = 0
	}
	return route
}

func scanImportExportRoute(scanner rowScanner) (config.ImportExportRoute, error) {
	var route config.ImportExportRoute
	err := scanner.Scan(
		&route.ID,
		&route.Name,
		&route.SourceRegionID,
		&route.SourceRegionName,
		&route.TargetMarketSystemID,
		&route.TargetMarketSystemName,
		&route.TargetMarketLocationID,
		&route.TargetMarketLocationName,
		&route.IncludeStructures,
		&route.AvgPricePeriod,
		&route.PurchaseDemandDays,
		&route.TradeMode,
		&route.ShippingMode,
		&route.ShippingCostPerM3Jump,
		&route.BuyBrokerFeePercent,
		&route.BuySalesTaxPercent,
		&route.SellBrokerFeePercent,
		&route.SellSalesTaxPercent,
		&route.CreatedAt,
		&route.UpdatedAt,
	)
	return route, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func (d *DB) ListImportExportRoutesForUser(userID string) ([]config.ImportExportRoute, error) {
	userID = normalizeUserID(userID)
	rows, err := d.sql.Query(`
		SELECT id, name, source_region_id, source_region_name, target_market_system_id, target_market_system_name,
		       target_market_location_id, target_market_location_name, include_structures, avg_price_period,
		       purchase_demand_days, trade_mode, shipping_mode, shipping_cost_per_m3_jump,
		       buy_broker_fee_percent, buy_sales_tax_percent, sell_broker_fee_percent, sell_sales_tax_percent,
		       created_at, updated_at
		  FROM import_export_routes
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var routes []config.ImportExportRoute
	for rows.Next() {
		route, err := scanImportExportRoute(rows)
		if err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if routes == nil {
		return []config.ImportExportRoute{}, nil
	}
	return routes, nil
}

func (d *DB) GetImportExportRouteForUser(userID string, routeID int64) (config.ImportExportRoute, error) {
	userID = normalizeUserID(userID)
	row := d.sql.QueryRow(`
		SELECT id, name, source_region_id, source_region_name, target_market_system_id, target_market_system_name,
		       target_market_location_id, target_market_location_name, include_structures, avg_price_period,
		       purchase_demand_days, trade_mode, shipping_mode, shipping_cost_per_m3_jump,
		       buy_broker_fee_percent, buy_sales_tax_percent, sell_broker_fee_percent, sell_sales_tax_percent,
		       created_at, updated_at
		  FROM import_export_routes
		 WHERE user_id = ? AND id = ?
	`, userID, routeID)
	return scanImportExportRoute(row)
}

func (d *DB) CreateImportExportRouteForUser(userID string, route config.ImportExportRoute) (config.ImportExportRoute, error) {
	userID = normalizeUserID(userID)
	route = normalizeImportExportRoute(route)
	if route.Name == "" {
		return config.ImportExportRoute{}, errors.New("route name is required")
	}
	if route.SourceRegionID <= 0 || route.TargetMarketSystemID <= 0 {
		return config.ImportExportRoute{}, errors.New("source region and target marketplace system are required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.sql.Exec(`
		INSERT INTO import_export_routes (
			user_id, name, source_region_id, source_region_name, target_market_system_id, target_market_system_name,
			target_market_location_id, target_market_location_name, include_structures, avg_price_period,
			purchase_demand_days, trade_mode, shipping_mode, shipping_cost_per_m3_jump,
			buy_broker_fee_percent, buy_sales_tax_percent, sell_broker_fee_percent, sell_sales_tax_percent,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		userID, route.Name, route.SourceRegionID, route.SourceRegionName, route.TargetMarketSystemID, route.TargetMarketSystemName,
		route.TargetMarketLocationID, route.TargetMarketLocationName, route.IncludeStructures, route.AvgPricePeriod,
		route.PurchaseDemandDays, route.TradeMode, route.ShippingMode, route.ShippingCostPerM3Jump,
		route.BuyBrokerFeePercent, route.BuySalesTaxPercent, route.SellBrokerFeePercent, route.SellSalesTaxPercent,
		now, now,
	)
	if err != nil {
		return config.ImportExportRoute{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return config.ImportExportRoute{}, err
	}
	return d.GetImportExportRouteForUser(userID, id)
}

func (d *DB) UpdateImportExportRouteForUser(userID string, routeID int64, route config.ImportExportRoute) (config.ImportExportRoute, error) {
	userID = normalizeUserID(userID)
	route = normalizeImportExportRoute(route)
	if route.Name == "" {
		return config.ImportExportRoute{}, errors.New("route name is required")
	}
	if route.SourceRegionID <= 0 || route.TargetMarketSystemID <= 0 {
		return config.ImportExportRoute{}, errors.New("source region and target marketplace system are required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.sql.Exec(`
		UPDATE import_export_routes
		   SET name = ?, source_region_id = ?, source_region_name = ?, target_market_system_id = ?, target_market_system_name = ?,
		       target_market_location_id = ?, target_market_location_name = ?, include_structures = ?, avg_price_period = ?,
		       purchase_demand_days = ?, trade_mode = ?, shipping_mode = ?, shipping_cost_per_m3_jump = ?,
		       buy_broker_fee_percent = ?, buy_sales_tax_percent = ?, sell_broker_fee_percent = ?, sell_sales_tax_percent = ?, updated_at = ?
		 WHERE user_id = ? AND id = ?
	`,
		route.Name, route.SourceRegionID, route.SourceRegionName, route.TargetMarketSystemID, route.TargetMarketSystemName,
		route.TargetMarketLocationID, route.TargetMarketLocationName, route.IncludeStructures, route.AvgPricePeriod,
		route.PurchaseDemandDays, route.TradeMode, route.ShippingMode, route.ShippingCostPerM3Jump,
		route.BuyBrokerFeePercent, route.BuySalesTaxPercent, route.SellBrokerFeePercent, route.SellSalesTaxPercent,
		now, userID, routeID,
	)
	if err != nil {
		return config.ImportExportRoute{}, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return config.ImportExportRoute{}, err
	}
	if affected == 0 {
		return config.ImportExportRoute{}, errors.New("route not found")
	}
	return d.GetImportExportRouteForUser(userID, routeID)
}

func (d *DB) DeleteImportExportRouteForUser(userID string, routeID int64) error {
	userID = normalizeUserID(userID)
	_, err := d.sql.Exec(`DELETE FROM import_export_routes WHERE user_id = ? AND id = ?`, userID, routeID)
	return err
}

func (d *DB) ListImportExportRouteItemsForUser(userID string, routeID int64) ([]config.ImportExportRouteItem, error) {
	userID = normalizeUserID(userID)
	rows, err := d.sql.Query(`
		SELECT i.id, i.route_id, i.type_id, i.type_name, i.category_id, i.group_id, i.group_name, i.added_at
		  FROM import_export_route_items i
		  INNER JOIN import_export_routes r ON r.id = i.route_id
		 WHERE r.user_id = ? AND i.route_id = ?
		 ORDER BY i.type_name COLLATE NOCASE ASC, i.id ASC
	`, userID, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []config.ImportExportRouteItem
	for rows.Next() {
		var item config.ImportExportRouteItem
		if err := rows.Scan(
			&item.ID,
			&item.RouteID,
			&item.TypeID,
			&item.TypeName,
			&item.CategoryID,
			&item.GroupID,
			&item.GroupName,
			&item.AddedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		return []config.ImportExportRouteItem{}, nil
	}
	return items, nil
}

func (d *DB) AddImportExportRouteItemForUser(userID string, routeID int64, item config.ImportExportRouteItem) (config.ImportExportRouteItem, error) {
	userID = normalizeUserID(userID)
	if _, err := d.GetImportExportRouteForUser(userID, routeID); err != nil {
		return config.ImportExportRouteItem{}, err
	}
	if item.TypeID <= 0 || strings.TrimSpace(item.TypeName) == "" {
		return config.ImportExportRouteItem{}, errors.New("item type is required")
	}
	item.RouteID = routeID
	item.TypeName = strings.TrimSpace(item.TypeName)
	item.GroupName = strings.TrimSpace(item.GroupName)
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.sql.Exec(`
		INSERT OR IGNORE INTO import_export_route_items (route_id, type_id, type_name, category_id, group_id, group_name, added_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, routeID, item.TypeID, item.TypeName, item.CategoryID, item.GroupID, item.GroupName, now)
	if err != nil {
		return config.ImportExportRouteItem{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return config.ImportExportRouteItem{}, err
	}
	if id == 0 {
		err = d.sql.QueryRow(`
			SELECT i.id, i.route_id, i.type_id, i.type_name, i.category_id, i.group_id, i.group_name, i.added_at
			  FROM import_export_route_items i
			  INNER JOIN import_export_routes r ON r.id = i.route_id
			 WHERE r.user_id = ? AND i.route_id = ? AND i.type_id = ?
		`, userID, routeID, item.TypeID).Scan(
			&item.ID, &item.RouteID, &item.TypeID, &item.TypeName, &item.CategoryID, &item.GroupID, &item.GroupName, &item.AddedAt,
		)
		return item, err
	}
	item.ID = id
	item.AddedAt = now
	return item, nil
}

func (d *DB) DeleteImportExportRouteItemForUser(userID string, routeID, itemID int64) error {
	userID = normalizeUserID(userID)
	_, err := d.sql.Exec(`
		DELETE FROM import_export_route_items
		 WHERE id = ?
		   AND route_id = ?
		   AND EXISTS (
			   SELECT 1
			     FROM import_export_routes
			    WHERE id = ? AND user_id = ?
		   )
	`, itemID, routeID, routeID, userID)
	return err
}
