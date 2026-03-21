package config

// ImportExportRoute represents a user-defined import/export lane.
type ImportExportRoute struct {
	ID                       int64   `json:"id"`
	Name                     string  `json:"name"`
	SourceRegionID           int32   `json:"source_region_id"`
	SourceRegionName         string  `json:"source_region_name"`
	TargetMarketSystemID     int32   `json:"target_market_system_id"`
	TargetMarketSystemName   string  `json:"target_market_system_name"`
	TargetMarketLocationID   int64   `json:"target_market_location_id"`
	TargetMarketLocationName string  `json:"target_market_location_name"`
	IncludeStructures        bool    `json:"include_structures"`
	AvgPricePeriod           int     `json:"avg_price_period"`
	PurchaseDemandDays       float64 `json:"purchase_demand_days"`
	TradeMode                string  `json:"trade_mode"`
	ShippingMode             string  `json:"shipping_mode"`
	ShippingCostPerM3Jump    float64 `json:"shipping_cost_per_m3_jump"`
	BuyBrokerFeePercent      float64 `json:"buy_broker_fee_percent"`
	BuySalesTaxPercent       float64 `json:"buy_sales_tax_percent"`
	SellBrokerFeePercent     float64 `json:"sell_broker_fee_percent"`
	SellSalesTaxPercent      float64 `json:"sell_sales_tax_percent"`
	CreatedAt                string  `json:"created_at"`
	UpdatedAt                string  `json:"updated_at"`
}

// ImportExportRouteItem represents a tracked type for a route.
type ImportExportRouteItem struct {
	ID                       int64    `json:"id"`
	RouteID                  int64    `json:"route_id"`
	TypeID                   int32    `json:"type_id"`
	TypeName                 string   `json:"type_name"`
	CategoryID               int32    `json:"category_id"`
	GroupID                  int32    `json:"group_id"`
	GroupName                string   `json:"group_name"`
	CustomPurchaseDemandDays *float64 `json:"custom_purchase_demand_days"`
	AddedAt                  string   `json:"added_at"`
}

// ImportExportWarehouse represents a tracked storage location for restocking.
type ImportExportWarehouse struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	SystemID     int32  `json:"system_id"`
	SystemName   string `json:"system_name"`
	LocationID   int64  `json:"location_id"`
	LocationName string `json:"location_name"`
	IsStructure  bool   `json:"is_structure"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type ImportExportTransitItem struct {
	TypeID   int32  `json:"type_id"`
	TypeName string `json:"type_name"`
	Quantity int64  `json:"quantity"`
}

// ImportExportTransitEntry represents a delivery contract with many items in transit.
type ImportExportTransitEntry struct {
	ID               int64                     `json:"id"`
	FromSystemID     int32                     `json:"from_system_id"`
	FromSystemName   string                    `json:"from_system_name"`
	FromLocationID   int64                     `json:"from_location_id"`
	FromLocationName string                    `json:"from_location_name"`
	ToSystemID       int32                     `json:"to_system_id"`
	ToSystemName     string                    `json:"to_system_name"`
	ToLocationID     int64                     `json:"to_location_id"`
	ToLocationName   string                    `json:"to_location_name"`
	Items            []ImportExportTransitItem `json:"items"`
	CreatedAt        string                    `json:"created_at"`
	UpdatedAt        string                    `json:"updated_at"`
}
