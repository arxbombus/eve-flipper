package api

import (
	"math"
	"net/http"
	"sort"
	"strings"

	"eve-flipper/internal/config"
	"eve-flipper/internal/esi"
)

type importExportRestockingWarehouseItem struct {
	TypeID    int32  `json:"type_id"`
	TypeName  string `json:"type_name"`
	Quantity  int64  `json:"quantity"`
	HasStock  bool   `json:"has_stock"`
	RouteRefs int    `json:"route_refs"`
}

type importExportRestockingWarehouseView struct {
	config.ImportExportWarehouse
	Items []importExportRestockingWarehouseItem `json:"items"`
}

type importExportRestockingOrder struct {
	CharacterID   int64   `json:"character_id"`
	CharacterName string  `json:"character_name"`
	OrderID       int64   `json:"order_id"`
	TypeID        int32   `json:"type_id"`
	TypeName      string  `json:"type_name"`
	LocationID    int64   `json:"location_id"`
	LocationName  string  `json:"location_name"`
	RegionID      int32   `json:"region_id"`
	Price         float64 `json:"price"`
	VolumeRemain  int32   `json:"volume_remain"`
	VolumeTotal   int32   `json:"volume_total"`
	IsBuyOrder    bool    `json:"is_buy_order"`
	Issued        string  `json:"issued"`
}

type importExportRestockingItemSummary struct {
	RouteBreakdowns            []importExportRestockingRouteBreakdown `json:"route_breakdowns"`
	SuggestedBuyQty            int64                                  `json:"suggested_buy_qty"`
	SuggestedMoveQty           int64                                  `json:"suggested_move_qty"`
	TypeID                     int32                                  `json:"type_id"`
	TypeName                   string                                 `json:"type_name"`
	RouteRefs                  int                                    `json:"route_refs"`
	TargetStock                int64                                  `json:"target_stock"`
	WarehouseStock             int64                                  `json:"warehouse_stock"`
	TransitStock               int64                                  `json:"transit_stock"`
	BuyOrderQty                int64                                  `json:"buy_order_qty"`
	SellOrderQty               int64                                  `json:"sell_order_qty"`
	NetAvailable               int64                                  `json:"net_available"`
	RestockNeeded              int64                                  `json:"restock_needed"`
	AggregatedDemandPerDay     float64                                `json:"aggregated_demand_per_day"`
	EffectiveDemandDaysAverage float64                                `json:"effective_demand_days_average"`
}

type importExportRestockingRouteBreakdown struct {
	AllocatedSharedSupply int64                                      `json:"allocated_shared_supply"`
	TransferSuggestions   []importExportRestockingTransferSuggestion `json:"transfer_suggestions"`
	RouteID               int64                                      `json:"route_id"`
	RouteName             string                                     `json:"route_name"`
	TargetSystemName      string                                     `json:"target_system_name"`
	TargetLocationName    string                                     `json:"target_location_name"`
	TargetStock           int64                                      `json:"target_stock"`
	DemandPerDay          float64                                    `json:"demand_per_day"`
	EffectiveDemandDays   float64                                    `json:"effective_demand_days"`
	DestinationStock      int64                                      `json:"destination_stock"`
	DestinationSellQty    int64                                      `json:"destination_sell_qty"`
	RouteDeficit          int64                                      `json:"route_deficit"`
	SuggestedHaulQty      int64                                      `json:"suggested_haul_qty"`
	SuggestedBuyQty       int64                                      `json:"suggested_buy_qty"`
}

type importExportRestockingTransferSuggestion struct {
	WarehouseID   int64  `json:"warehouse_id"`
	WarehouseName string `json:"warehouse_name"`
	LocationName  string `json:"location_name"`
	Quantity      int64  `json:"quantity"`
}

type importExportRestockingOverview struct {
	Warehouses []importExportRestockingWarehouseView `json:"warehouses"`
	Orders     []importExportRestockingOrder         `json:"orders"`
	Transit    []config.ImportExportTransitEntry     `json:"transit"`
	Items      []importExportRestockingItemSummary   `json:"items"`
}

func (s *Server) handleGetImportExportRestockingOverview(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromRequest(r)

	routes, err := s.db.ListImportExportRoutesForUser(userID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	warehouses, err := s.db.ListImportExportWarehousesForUser(userID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	transitEntries, err := s.db.ListImportExportTransitEntriesForUser(userID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	type trackedItemMeta struct {
		TypeName  string
		RouteRefs int
	}
	typeIDs := make([]int32, 0)
	tracked := make(map[int32]trackedItemMeta)
	itemsByRoute := make(map[int64][]config.ImportExportRouteItem, len(routes))
	itemByRouteAndType := make(map[int64]map[int32]config.ImportExportRouteItem, len(routes))
	routeByID := make(map[int64]config.ImportExportRoute, len(routes))
	for _, route := range routes {
		routeByID[route.ID] = route
		items, itemsErr := s.db.ListImportExportRouteItemsForUser(userID, route.ID)
		if itemsErr != nil {
			writeError(w, 500, itemsErr.Error())
			return
		}
		itemsByRoute[route.ID] = items
		itemByRouteAndType[route.ID] = make(map[int32]config.ImportExportRouteItem, len(items))
		for _, item := range items {
			itemByRouteAndType[route.ID][item.TypeID] = item
			meta, exists := tracked[item.TypeID]
			if !exists {
				typeIDs = append(typeIDs, item.TypeID)
				meta = trackedItemMeta{TypeName: item.TypeName}
			}
			meta.RouteRefs++
			if strings.TrimSpace(meta.TypeName) == "" {
				meta.TypeName = item.TypeName
			}
			tracked[item.TypeID] = meta
		}
	}

	warehouseStockByLocation := make(map[int64]map[int32]int64, len(warehouses))
	for _, warehouse := range warehouses {
		warehouseStockByLocation[warehouse.LocationID] = make(map[int32]int64)
	}
	warehouseStockByType := make(map[int32]int64, len(typeIDs))
	orderViews := make([]importExportRestockingOrder, 0)
	buyOrderQtyByType := make(map[int32]int64, len(typeIDs))
	sellOrderQtyByType := make(map[int32]int64, len(typeIDs))
	destinationSellQtyByRouteAndType := make(map[int64]map[int32]int64, len(routes))
	destinationStockByRouteAndType := make(map[int64]map[int32]int64, len(routes))
	targetRegionByRoute := make(map[int64]int32, len(routes))
	for _, route := range routes {
		destinationSellQtyByRouteAndType[route.ID] = make(map[int32]int64)
		destinationStockByRouteAndType[route.ID] = make(map[int32]int64)
		s.mu.RLock()
		if s.sdeData != nil {
			if sys, ok := s.sdeData.Systems[route.TargetMarketSystemID]; ok {
				targetRegionByRoute[route.ID] = sys.RegionID
			}
		}
		s.mu.RUnlock()
	}

	if len(typeIDs) > 0 && s.sessions != nil && s.esi != nil && s.sso != nil {
		sessions := s.sessions.ListForUser(userID)
		locationIDs := make(map[int64]bool)
		for _, sess := range sessions {
			token, tokenErr := s.sessions.EnsureValidTokenForUserCharacter(s.sso, userID, sess.CharacterID)
			if tokenErr != nil {
				continue
			}

			orders, orderErr := s.esi.GetCharacterOrders(sess.CharacterID, token)
			if orderErr == nil {
				for _, order := range orders {
					if _, ok := tracked[order.TypeID]; !ok || order.VolumeRemain <= 0 {
						continue
					}
					locationIDs[order.LocationID] = true
					orderViews = append(orderViews, importExportRestockingOrder{
						CharacterID:   sess.CharacterID,
						CharacterName: sess.CharacterName,
						OrderID:       order.OrderID,
						TypeID:        order.TypeID,
						TypeName:      tracked[order.TypeID].TypeName,
						LocationID:    order.LocationID,
						RegionID:      order.RegionID,
						Price:         order.Price,
						VolumeRemain:  order.VolumeRemain,
						VolumeTotal:   order.VolumeTotal,
						IsBuyOrder:    order.IsBuyOrder,
						Issued:        order.Issued,
					})
					if order.IsBuyOrder {
						buyOrderQtyByType[order.TypeID] += int64(order.VolumeRemain)
					} else {
						sellOrderQtyByType[order.TypeID] += int64(order.VolumeRemain)
						for _, route := range routes {
							if orderMatchesImportExportRouteDestination(order, route, targetRegionByRoute[route.ID], s) {
								destinationSellQtyByRouteAndType[route.ID][order.TypeID] += int64(order.VolumeRemain)
							}
						}
					}
				}
			}

			assets, assetsErr := s.esi.GetCharacterAssets(sess.CharacterID, token)
			if assetsErr == nil {
				assetByItemID := make(map[int64]esi.CharacterAsset, len(assets))
				for _, asset := range assets {
					if asset.ItemID > 0 {
						assetByItemID[asset.ItemID] = asset
					}
				}
				for _, asset := range assets {
					if _, ok := tracked[asset.TypeID]; !ok || asset.IsBlueprintCopy {
						continue
					}
					qty := asset.Quantity
					if qty <= 0 {
						if asset.IsSingleton {
							qty = 1
						} else {
							continue
						}
					}
					rootLocationID := resolveAssetRootLocationID(asset.LocationID, assetByItemID)
					stockByType, ok := warehouseStockByLocation[rootLocationID]
					if !ok {
						continue
					}
					stockByType[asset.TypeID] += qty
					warehouseStockByType[asset.TypeID] += qty
					for _, route := range routes {
						if warehouseLocationMatchesImportExportRouteDestination(rootLocationID, route, targetRegionByRoute[route.ID], s) {
							destinationStockByRouteAndType[route.ID][asset.TypeID] += qty
						}
					}
				}
			}
		}

		if len(locationIDs) > 0 {
			s.esi.PrefetchStationNames(locationIDs)
		}
		for i := range orderViews {
			orderViews[i].LocationName = s.esi.StationName(orderViews[i].LocationID)
			if orderViews[i].TypeName == "" {
				orderViews[i].TypeName = tracked[orderViews[i].TypeID].TypeName
			}
		}
	}

	sort.Slice(orderViews, func(i, j int) bool {
		if orderViews[i].TypeName == orderViews[j].TypeName {
			if orderViews[i].CharacterName == orderViews[j].CharacterName {
				return orderViews[i].OrderID > orderViews[j].OrderID
			}
			return orderViews[i].CharacterName < orderViews[j].CharacterName
		}
		return orderViews[i].TypeName < orderViews[j].TypeName
	})

	transitQtyByType := make(map[int32]int64, len(typeIDs))
	for _, entry := range transitEntries {
		for _, item := range entry.Items {
			if _, ok := tracked[item.TypeID]; !ok {
				continue
			}
			transitQtyByType[item.TypeID] += item.Quantity
		}
	}

	targetStockByType := make(map[int32]int64, len(typeIDs))
	demandPerDayByType := make(map[int32]float64, len(typeIDs))
	effectiveDemandDaysByType := make(map[int32]float64, len(typeIDs))
	routeRefsByType := make(map[int32]int, len(typeIDs))
	routeBreakdownsByType := make(map[int32][]importExportRestockingRouteBreakdown, len(typeIDs))

	s.mu.RLock()
	scanner := s.scanner
	s.mu.RUnlock()
	accessToken := ""
	for _, route := range routes {
		if !route.IncludeStructures {
			continue
		}
		if token, tokenErr := s.sessions.EnsureValidTokenForUser(s.sso, userID); tokenErr == nil {
			accessToken = token
			break
		}
	}
	for _, route := range routes {
		items := itemsByRoute[route.ID]
		if len(items) == 0 {
			continue
		}
		analysis, analysisErr := scanner.AnalyzeImportExportRoute(route, items, accessToken)
		if analysisErr != nil {
			continue
		}
		for _, row := range analysis.Rows {
			itemMeta, ok := itemByRouteAndType[route.ID][row.TypeID]
			if !ok {
				continue
			}
			effectiveDemandDays := route.PurchaseDemandDays
			if itemMeta.CustomPurchaseDemandDays != nil && *itemMeta.CustomPurchaseDemandDays > 0 {
				effectiveDemandDays = *itemMeta.CustomPurchaseDemandDays
			}
			targetStockByType[row.TypeID] += int64(math.Ceil(row.DayTargetDemandPerDay * effectiveDemandDays))
			demandPerDayByType[row.TypeID] += row.DayTargetDemandPerDay
			effectiveDemandDaysByType[row.TypeID] += effectiveDemandDays
			routeRefsByType[row.TypeID]++
			routeTargetStock := int64(math.Ceil(row.DayTargetDemandPerDay * effectiveDemandDays))
			destinationStock := destinationStockByRouteAndType[route.ID][row.TypeID]
			destinationSellQty := destinationSellQtyByRouteAndType[route.ID][row.TypeID]
			routeDeficit := routeTargetStock - destinationStock - destinationSellQty
			if routeDeficit < 0 {
				routeDeficit = 0
			}
			routeBreakdownsByType[row.TypeID] = append(routeBreakdownsByType[row.TypeID], importExportRestockingRouteBreakdown{
				RouteID:             route.ID,
				RouteName:           route.Name,
				TargetSystemName:    route.TargetMarketSystemName,
				TargetLocationName:  route.TargetMarketLocationName,
				TargetStock:         routeTargetStock,
				DemandPerDay:        row.DayTargetDemandPerDay,
				EffectiveDemandDays: effectiveDemandDays,
				DestinationStock:    destinationStock,
				DestinationSellQty:  destinationSellQty,
				RouteDeficit:        routeDeficit,
			})
		}
	}

	warehouseViews := make([]importExportRestockingWarehouseView, 0, len(warehouses))
	warehouseRegionByID := make(map[int64]int32, len(warehouses))
	for _, warehouse := range warehouses {
		s.mu.RLock()
		if s.sdeData != nil {
			if sys, ok := s.sdeData.Systems[warehouse.SystemID]; ok {
				warehouseRegionByID[warehouse.ID] = sys.RegionID
			}
		}
		s.mu.RUnlock()
		items := make([]importExportRestockingWarehouseItem, 0, len(typeIDs))
		for _, typeID := range typeIDs {
			meta := tracked[typeID]
			qty := warehouseStockByLocation[warehouse.LocationID][typeID]
			items = append(items, importExportRestockingWarehouseItem{
				TypeID:    typeID,
				TypeName:  meta.TypeName,
				Quantity:  qty,
				HasStock:  qty > 0,
				RouteRefs: meta.RouteRefs,
			})
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].HasStock != items[j].HasStock {
				return items[i].HasStock
			}
			return items[i].TypeName < items[j].TypeName
		})
		warehouseViews = append(warehouseViews, importExportRestockingWarehouseView{
			ImportExportWarehouse: warehouse,
			Items:                 items,
		})
	}

	itemSummaries := make([]importExportRestockingItemSummary, 0, len(typeIDs))
	for _, typeID := range typeIDs {
		meta := tracked[typeID]
		routeRefs := routeRefsByType[typeID]
		avgDemandDays := 0.0
		if routeRefs > 0 {
			avgDemandDays = effectiveDemandDaysByType[typeID] / float64(routeRefs)
		}
		netAvailable := warehouseStockByType[typeID] + transitQtyByType[typeID] + buyOrderQtyByType[typeID] - sellOrderQtyByType[typeID]
		restockNeeded := targetStockByType[typeID] - netAvailable
		if restockNeeded < 0 {
			restockNeeded = 0
		}
		routeBreakdowns := routeBreakdownsByType[typeID]
		if routeBreakdowns == nil {
			routeBreakdowns = make([]importExportRestockingRouteBreakdown, 0)
		}
		sort.Slice(routeBreakdowns, func(i, j int) bool {
			if routeBreakdowns[i].RouteDeficit == routeBreakdowns[j].RouteDeficit {
				if routeBreakdowns[i].DemandPerDay == routeBreakdowns[j].DemandPerDay {
					return routeBreakdowns[i].RouteName < routeBreakdowns[j].RouteName
				}
				return routeBreakdowns[i].DemandPerDay > routeBreakdowns[j].DemandPerDay
			}
			return routeBreakdowns[i].RouteDeficit > routeBreakdowns[j].RouteDeficit
		})
		remainingSharedSupply := warehouseStockByType[typeID] + transitQtyByType[typeID] + buyOrderQtyByType[typeID]
		suggestedMoveQty := int64(0)
		suggestedBuyQty := int64(0)
		remainingWarehouseQty := make(map[int64]int64, len(warehouses))
		for _, warehouse := range warehouses {
			remainingWarehouseQty[warehouse.ID] = warehouseStockByLocation[warehouse.LocationID][typeID]
		}
		for i := range routeBreakdowns {
			if routeBreakdowns[i].TransferSuggestions == nil {
				routeBreakdowns[i].TransferSuggestions = make([]importExportRestockingTransferSuggestion, 0)
			}
			if routeBreakdowns[i].RouteDeficit <= 0 {
				continue
			}
			allocated := routeBreakdowns[i].RouteDeficit
			if allocated > remainingSharedSupply {
				allocated = remainingSharedSupply
			}
			routeBreakdowns[i].AllocatedSharedSupply = allocated
			routeBreakdowns[i].SuggestedHaulQty = allocated
			routeBreakdowns[i].SuggestedBuyQty = routeBreakdowns[i].RouteDeficit - allocated
			if allocated > 0 {
				candidates := make([]config.ImportExportWarehouse, 0, len(warehouses))
				routeCfg := routeByID[routeBreakdowns[i].RouteID]
				for _, warehouse := range warehouses {
					if remainingWarehouseQty[warehouse.ID] <= 0 {
						continue
					}
					if warehouseLocationMatchesImportExportRouteDestination(warehouse.LocationID, routeCfg, targetRegionByRoute[routeCfg.ID], s) {
						continue
					}
					candidates = append(candidates, warehouse)
				}
				sort.Slice(candidates, func(a, b int) bool {
					aMatch := warehouseRegionByID[candidates[a].ID] == routeCfg.SourceRegionID
					bMatch := warehouseRegionByID[candidates[b].ID] == routeCfg.SourceRegionID
					if aMatch != bMatch {
						return aMatch
					}
					if remainingWarehouseQty[candidates[a].ID] == remainingWarehouseQty[candidates[b].ID] {
						return candidates[a].Name < candidates[b].Name
					}
					return remainingWarehouseQty[candidates[a].ID] > remainingWarehouseQty[candidates[b].ID]
				})
				remainingToSource := allocated
				for _, warehouse := range candidates {
					if remainingToSource <= 0 {
						break
					}
					qty := remainingWarehouseQty[warehouse.ID]
					if qty <= 0 {
						continue
					}
					if qty > remainingToSource {
						qty = remainingToSource
					}
					routeBreakdowns[i].TransferSuggestions = append(routeBreakdowns[i].TransferSuggestions, importExportRestockingTransferSuggestion{
						WarehouseID:   warehouse.ID,
						WarehouseName: warehouse.Name,
						LocationName:  warehouse.LocationName,
						Quantity:      qty,
					})
					remainingWarehouseQty[warehouse.ID] -= qty
					remainingToSource -= qty
				}
			}
			remainingSharedSupply -= allocated
			suggestedMoveQty += allocated
			suggestedBuyQty += routeBreakdowns[i].SuggestedBuyQty
		}
		itemSummaries = append(itemSummaries, importExportRestockingItemSummary{
			RouteBreakdowns:            routeBreakdowns,
			SuggestedBuyQty:            suggestedBuyQty,
			SuggestedMoveQty:           suggestedMoveQty,
			TypeID:                     typeID,
			TypeName:                   meta.TypeName,
			RouteRefs:                  meta.RouteRefs,
			TargetStock:                targetStockByType[typeID],
			WarehouseStock:             warehouseStockByType[typeID],
			TransitStock:               transitQtyByType[typeID],
			BuyOrderQty:                buyOrderQtyByType[typeID],
			SellOrderQty:               sellOrderQtyByType[typeID],
			NetAvailable:               netAvailable,
			RestockNeeded:              restockNeeded,
			AggregatedDemandPerDay:     demandPerDayByType[typeID],
			EffectiveDemandDaysAverage: avgDemandDays,
		})
	}
	sort.Slice(itemSummaries, func(i, j int) bool {
		if itemSummaries[i].RestockNeeded == itemSummaries[j].RestockNeeded {
			return itemSummaries[i].TypeName < itemSummaries[j].TypeName
		}
		return itemSummaries[i].RestockNeeded > itemSummaries[j].RestockNeeded
	})
	if transitEntries == nil {
		transitEntries = make([]config.ImportExportTransitEntry, 0)
	}

	writeJSON(w, importExportRestockingOverview{
		Warehouses: warehouseViews,
		Orders:     orderViews,
		Transit:    transitEntries,
		Items:      itemSummaries,
	})
}

func orderMatchesImportExportRouteDestination(order esi.CharacterOrder, route config.ImportExportRoute, targetRegionID int32, s *Server) bool {
	if order.LocationID <= 0 {
		return false
	}
	if route.TargetMarketLocationID > 0 {
		return order.LocationID == route.TargetMarketLocationID
	}
	if route.TargetMarketSystemID > 0 {
		return s.matchesSystemByLocationID(order.LocationID, route.TargetMarketSystemID)
	}
	if targetRegionID > 0 {
		return order.RegionID == targetRegionID || s.matchesRegionByLocationID(order.LocationID, targetRegionID)
	}
	return false
}

func warehouseLocationMatchesImportExportRouteDestination(locationID int64, route config.ImportExportRoute, targetRegionID int32, s *Server) bool {
	if locationID <= 0 {
		return false
	}
	if route.TargetMarketLocationID > 0 {
		return locationID == route.TargetMarketLocationID
	}
	if route.TargetMarketSystemID > 0 {
		return s.matchesSystemByLocationID(locationID, route.TargetMarketSystemID)
	}
	if targetRegionID > 0 {
		return s.matchesRegionByLocationID(locationID, targetRegionID)
	}
	return false
}
