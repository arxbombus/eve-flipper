package config

// PortfolioShippingRule applies an estimated hauling cost to realized sales at a location.
type PortfolioShippingRule struct {
	ID           int64   `json:"id"`
	LocationID   int64   `json:"location_id"`
	LocationName string  `json:"location_name"`
	SystemID     int32   `json:"system_id"`
	SystemName   string  `json:"system_name"`
	CostPerM3    float64 `json:"cost_per_m3"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}
