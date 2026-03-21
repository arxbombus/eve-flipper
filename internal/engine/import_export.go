package engine

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"eve-flipper/internal/config"
)

const importExportSCCSurchargePercent = 0.5
const (
	importExportShippingPerRoute = "per_route"
	importExportShippingPerJump  = "per_jump"
)

type ImportExportRouteAnalysis struct {
	Route           config.ImportExportRoute              `json:"route"`
	RouteJumps      int                                   `json:"route_jumps"`
	ItemCount       int                                   `json:"item_count"`
	PeriodDays      int                                   `json:"period_days"`
	Rows            []FlipResult                          `json:"rows"`
	ScenariosByType map[int32][]ImportExportScenarioBrief `json:"scenarios_by_type,omitempty"`
}

type ImportExportScenarioBrief struct {
	Key                          string  `json:"key"`
	Label                        string  `json:"label"`
	TradeMode                    string  `json:"trade_mode"`
	PurchaseUnits                int32   `json:"purchase_units"`
	SourcePrice                  float64 `json:"source_price"`
	SourceGross                  float64 `json:"source_gross"`
	SourceTotal                  float64 `json:"source_total"`
	TargetNowPrice               float64 `json:"target_now_price"`
	TargetPeriodPrice            float64 `json:"target_period_price"`
	TargetGross                  float64 `json:"target_gross"`
	TargetTotal                  float64 `json:"target_total"`
	BuyOrderFees                 float64 `json:"buy_order_fees"`
	BuyBrokerFees                float64 `json:"buy_broker_fees"`
	BuySalesTaxes                float64 `json:"buy_sales_taxes"`
	BuySCCSurcharge              float64 `json:"buy_scc_surcharge"`
	SellOrderFees                float64 `json:"sell_order_fees"`
	SellBrokerFees               float64 `json:"sell_broker_fees"`
	SellSalesTaxes               float64 `json:"sell_sales_taxes"`
	SellSCCSurcharge             float64 `json:"sell_scc_surcharge"`
	NowProfit                    float64 `json:"now_profit"`
	PeriodProfit                 float64 `json:"period_profit"`
	MarginPercent                float64 `json:"margin_percent"`
	ROINow                       float64 `json:"roi_now"`
	ROIPeriod                    float64 `json:"roi_period"`
	CapitalRequired              float64 `json:"capital_required"`
	ShippingCost                 float64 `json:"shipping_cost"`
	TargetDemandPerDay           float64 `json:"target_demand_per_day"`
	TargetHistoricalDemandPerDay float64 `json:"target_historical_demand_per_day"`
	TargetSupplyUnits            int64   `json:"target_supply_units"`
	TargetDOS                    float64 `json:"target_dos"`
	TradeScore                   float64 `json:"trade_score"`
}

type importExportHistoryBundle struct {
	source regionalHistoryStats
	target regionalHistoryStats
}

func importExportScenarioMeta(mode string) (string, string) {
	switch NormalizeTradeMode(mode) {
	case TradeModeInstantSell:
		return TradeModeInstantSell, "Instant -> Sell Order"
	case TradeModeBuyOrderToSell:
		return TradeModeBuyOrderToSell, "Buy Order -> Sell Order"
	default:
		return TradeModeInstantInstant, "Instant -> Instant"
	}
}

func importExportScenarioBrief(mode string, row FlipResult) ImportExportScenarioBrief {
	key, label := importExportScenarioMeta(mode)
	return ImportExportScenarioBrief{
		Key:                          key,
		Label:                        label,
		TradeMode:                    key,
		PurchaseUnits:                row.UnitsToBuy,
		SourcePrice:                  row.DaySourceAvgPrice,
		SourceGross:                  row.DaySourceGross,
		SourceTotal:                  row.DaySourceTotal,
		TargetNowPrice:               row.DayTargetNowPrice,
		TargetPeriodPrice:            row.DayTargetPeriodPrice,
		TargetGross:                  row.DayTargetGross,
		TargetTotal:                  row.DayTargetTotal,
		BuyOrderFees:                 row.DayBuyOrderFees,
		BuyBrokerFees:                row.DayBuyBrokerFees,
		BuySalesTaxes:                row.DayBuySalesTaxes,
		BuySCCSurcharge:              row.DayBuySCCSurcharge,
		SellOrderFees:                row.DaySellOrderFees,
		SellBrokerFees:               row.DaySellBrokerFees,
		SellSalesTaxes:               row.DaySellSalesTaxes,
		SellSCCSurcharge:             row.DaySellSCCSurcharge,
		NowProfit:                    row.DayNowProfit,
		PeriodProfit:                 row.DayPeriodProfit,
		MarginPercent:                row.MarginPercent,
		ROINow:                       row.DayROINow,
		ROIPeriod:                    row.DayROIPeriod,
		CapitalRequired:              row.DayCapitalRequired,
		ShippingCost:                 row.DayShippingCost,
		TargetDemandPerDay:           row.DayTargetDemandPerDay,
		TargetHistoricalDemandPerDay: row.DayTargetHistoricalDemandPerDay,
		TargetSupplyUnits:            row.DayTargetSupplyUnits,
		TargetDOS:                    row.DayTargetDOS,
		TradeScore:                   row.DayTradeScore,
	}
}

func (s *Scanner) AnalyzeImportExportRoute(route config.ImportExportRoute, items []config.ImportExportRouteItem, accessToken string) (ImportExportRouteAnalysis, error) {
	if s == nil || s.SDE == nil || s.ESI == nil {
		return ImportExportRouteAnalysis{}, fmt.Errorf("scanner is not ready")
	}
	if route.SourceRegionID <= 0 || route.TargetMarketSystemID <= 0 {
		return ImportExportRouteAnalysis{}, fmt.Errorf("route source region and target marketplace system are required")
	}

	targetSystem, ok := s.SDE.Systems[route.TargetMarketSystemID]
	if !ok {
		return ImportExportRouteAnalysis{}, fmt.Errorf("target marketplace system not found")
	}

	routeJumps := 0
	for _, sys := range s.SDE.Systems {
		if sys.RegionID != route.SourceRegionID {
			continue
		}
		jumps := s.jumpsBetween(sys.ID, route.TargetMarketSystemID)
		if jumps < 0 {
			continue
		}
		if routeJumps == 0 || jumps < routeJumps {
			routeJumps = jumps
		}
	}

	if len(items) == 0 {
		return ImportExportRouteAnalysis{
			Route:      route,
			RouteJumps: routeJumps,
			ItemCount:  0,
			PeriodDays: route.AvgPricePeriod,
			Rows:       []FlipResult{},
		}, nil
	}

	typeIDs := make([]int32, 0, len(items))
	itemMeta := make(map[int32]config.ImportExportRouteItem, len(items))
	for _, item := range items {
		if item.TypeID > 0 {
			typeIDs = append(typeIDs, item.TypeID)
			itemMeta[item.TypeID] = item
		}
	}

	params := ScanParams{
		CurrentSystemID:        route.TargetMarketSystemID,
		CargoCapacity:          1_000_000_000,
		BuyRadius:              0,
		SellRadius:             0,
		MinMargin:              -100,
		AvgPricePeriod:         route.AvgPricePeriod,
		PurchaseDemandDays:     route.PurchaseDemandDays,
		ShippingCostPerM3Jump:  route.ShippingCostPerM3Jump,
		ShippingMode:           route.ShippingMode,
		SourceRegionIDs:        []int32{route.SourceRegionID},
		IncludeTypeIDs:         typeIDs,
		TargetRegionID:         targetSystem.RegionID,
		TargetMarketSystemID:   route.TargetMarketSystemID,
		TargetMarketLocationID: route.TargetMarketLocationID,
		TradeMode:              NormalizeTradeMode(route.TradeMode),
		IncludeStructures:      route.IncludeStructures,
		AccessToken:            accessToken,
		SplitTradeFees:         true,
		BuyBrokerFeePercent:    route.BuyBrokerFeePercent,
		BuySalesTaxPercent:     route.BuySalesTaxPercent,
		SellBrokerFeePercent:   route.SellBrokerFeePercent,
		SellSalesTaxPercent:    route.SellSalesTaxPercent,
	}

	historyByType := s.importExportHistoryBundles(typeIDs, route, targetSystem.RegionID)
	selectedMode := NormalizeTradeMode(route.TradeMode)
	scenarioModes := []string{
		TradeModeInstantInstant,
		TradeModeInstantSell,
		TradeModeBuyOrderToSell,
	}

	var selectedRows []FlipResult
	scenariosByType := make(map[int32][]ImportExportScenarioBrief, len(typeIDs))
	for _, mode := range scenarioModes {
		scenarioParams := params
		scenarioParams.TradeMode = mode
		rawRows, err := s.importExportCollectRows(scenarioParams)
		if err != nil {
			return ImportExportRouteAnalysis{}, err
		}
		enrichedRows := s.importExportRowsForMode(scenarioParams, rawRows, historyByType, itemMeta)
		for _, row := range enrichedRows {
			scenariosByType[row.TypeID] = append(scenariosByType[row.TypeID], importExportScenarioBrief(mode, row))
		}
		if mode == TradeModeBuyOrderToSell && route.SourceRegionID == 10000002 {
			for _, row := range enrichedRows {
				scenariosByType[row.TypeID] = append(
					scenariosByType[row.TypeID],
					importExportStructureBuyScenarioBrief(row),
				)
			}
		}
		if mode == selectedMode {
			selectedRows = enrichedRows
		}
	}

	return ImportExportRouteAnalysis{
		Route:           route,
		RouteJumps:      routeJumps,
		ItemCount:       len(selectedRows),
		PeriodDays:      regionalPeriodDays(params),
		Rows:            selectedRows,
		ScenariosByType: scenariosByType,
	}, nil
}

func (s *Scanner) importExportCollectRows(params ScanParams) ([]FlipResult, error) {
	ignored := ignoredSystemSetFromIDs(params.IgnoredSystemIDs)

	buyRegions := make(map[int32]bool, len(params.SourceRegionIDs))
	for _, regionID := range params.SourceRegionIDs {
		if regionID > 0 {
			buyRegions[regionID] = true
		}
	}
	buySystems := filterSystemDistanceMap(s.SDE.Universe.SystemsInRegions(buyRegions), ignored)
	buySystemsRadius := make(map[int32]int)

	sellRegions := map[int32]bool{params.TargetRegionID: true}
	sellSystems := filterSystemDistanceMap(s.SDE.Universe.SystemsInRegions(sellRegions), ignored)
	if len(buySystems) == 0 || len(sellSystems) == 0 {
		return []FlipResult{}, nil
	}

	idx := s.fetchAndIndex(params, buyRegions, buySystems, sellRegions, sellSystems)
	return s.importExportCalculateResults(params, idx, buySystemsRadius)
}

func (s *Scanner) importExportCalculateResults(
	params ScanParams,
	idx *scanIndex,
	bfsDistances map[int32]int,
) ([]FlipResult, error) {
	type sellLocBest struct {
		sellInfo
		BestPriceVolume int32
	}
	type buyLocBest struct {
		buyInfo
		BestPriceVolume int32
	}

	buyCostMult, sellRevenueMult := tradeFeeMultipliers(tradeFeeInputs{
		SplitTradeFees:       params.SplitTradeFees,
		BrokerFeePercent:     params.BrokerFeePercent,
		SalesTaxPercent:      params.SalesTaxPercent,
		BuyBrokerFeePercent:  params.BuyBrokerFeePercent,
		SellBrokerFeePercent: params.SellBrokerFeePercent,
		BuySalesTaxPercent:   params.BuySalesTaxPercent,
		SellSalesTaxPercent:  params.SellSalesTaxPercent,
	})

	minSec := params.MinRouteSecurity
	targetMarketSystemID := params.TargetMarketSystemID
	targetMarketLocationID := params.TargetMarketLocationID
	useSourceBuyOrders := params.UsesSourceBuyOrders()
	useSellOrderRevenue := params.UsesSellOrderRevenue()

	candidateTypes := make(map[int32]struct{})
	if len(params.IncludeTypeIDs) > 0 {
		for _, typeID := range params.IncludeTypeIDs {
			if typeID > 0 {
				candidateTypes[typeID] = struct{}{}
			}
		}
	}

	results := make([]FlipResult, 0, len(candidateTypes))
	for typeID := range candidateTypes {
		sourceSells := idx.sellByType[typeID]
		sourceBuys := idx.sourceBuyByType[typeID]
		destBuys := idx.buyByType[typeID]
		destSells := idx.sellSideSellByType[typeID]

		if useSourceBuyOrders {
			if len(sourceBuys) == 0 {
				continue
			}
		} else if len(sourceSells) == 0 {
			continue
		}
		if useSellOrderRevenue {
			if len(destSells) == 0 {
				continue
			}
		} else if len(destBuys) == 0 && targetMarketSystemID <= 0 && targetMarketLocationID <= 0 {
			continue
		}

		itemType, ok := s.SDE.Types[typeID]
		if !ok || itemType.Volume <= 0 {
			continue
		}

		maxUnits := int32(math.MaxInt32)
		if params.CargoCapacity > 0 {
			maxUnitsF := math.Floor(params.CargoCapacity / itemType.Volume)
			if maxUnitsF > math.MaxInt32 {
				maxUnitsF = math.MaxInt32
			}
			maxUnits = int32(maxUnitsF)
			if maxUnits <= 0 {
				continue
			}
		}

		bestSourceSellByLoc := make(map[int64]*sellLocBest)
		for _, sell := range sourceSells {
			if existing, ok := bestSourceSellByLoc[sell.LocationID]; ok {
				existing.VolumeRemain += sell.VolumeRemain
				if sell.Price < existing.Price {
					existing.Price = sell.Price
					existing.SystemID = sell.SystemID
					existing.OrderCount = sell.OrderCount
					existing.BestPriceVolume = sell.VolumeRemain
				} else if sell.Price == existing.Price {
					existing.BestPriceVolume += sell.VolumeRemain
				}
			} else {
				cp := sell
				bestSourceSellByLoc[sell.LocationID] = &sellLocBest{sellInfo: cp, BestPriceVolume: sell.VolumeRemain}
			}
		}

		bestSourceBuyByLoc := make(map[int64]*buyLocBest)
		for _, buy := range sourceBuys {
			if existing, ok := bestSourceBuyByLoc[buy.LocationID]; ok {
				existing.VolumeRemain += buy.VolumeRemain
				if buy.Price > existing.Price {
					existing.Price = buy.Price
					existing.SystemID = buy.SystemID
					existing.OrderCount = buy.OrderCount
					existing.BestPriceVolume = buy.VolumeRemain
				} else if buy.Price == existing.Price {
					existing.BestPriceVolume += buy.VolumeRemain
				}
			} else {
				cp := buy
				bestSourceBuyByLoc[buy.LocationID] = &buyLocBest{buyInfo: cp, BestPriceVolume: buy.VolumeRemain}
			}
		}

		bestDestBuyByLoc := make(map[int64]*buyLocBest)
		for _, buy := range destBuys {
			if existing, ok := bestDestBuyByLoc[buy.LocationID]; ok {
				existing.VolumeRemain += buy.VolumeRemain
				if buy.Price > existing.Price {
					existing.Price = buy.Price
					existing.SystemID = buy.SystemID
					existing.OrderCount = buy.OrderCount
					existing.BestPriceVolume = buy.VolumeRemain
				} else if buy.Price == existing.Price {
					existing.BestPriceVolume += buy.VolumeRemain
				}
			} else {
				cp := buy
				bestDestBuyByLoc[buy.LocationID] = &buyLocBest{buyInfo: cp, BestPriceVolume: buy.VolumeRemain}
			}
		}

		bestDestSellByLoc := make(map[int64]*sellLocBest)
		for _, sell := range destSells {
			if existing, ok := bestDestSellByLoc[sell.LocationID]; ok {
				existing.VolumeRemain += sell.VolumeRemain
				if sell.Price < existing.Price {
					existing.Price = sell.Price
					existing.SystemID = sell.SystemID
					existing.OrderCount = sell.OrderCount
					existing.BestPriceVolume = sell.VolumeRemain
				} else if sell.Price == existing.Price {
					existing.BestPriceVolume += sell.VolumeRemain
				}
			} else {
				cp := sell
				bestDestSellByLoc[sell.LocationID] = &sellLocBest{sellInfo: cp, BestPriceVolume: sell.VolumeRemain}
			}
		}

		var sourceLocID int64
		var sourcePrice float64
		var sourceVolume int32
		var sourceSystemID int32
		var sourceOrderCount int
		var sourceBestLevelQty int32
		if useSourceBuyOrders {
			bestPrice := -1.0
			for locID, source := range bestSourceBuyByLoc {
				if source.Price > bestPrice {
					bestPrice = source.Price
					sourceLocID = locID
					sourcePrice = source.Price
					sourceVolume = source.VolumeRemain
					sourceSystemID = source.SystemID
					sourceOrderCount = source.OrderCount
					sourceBestLevelQty = source.BestPriceVolume
				}
			}
		} else {
			bestPrice := math.MaxFloat64
			for locID, source := range bestSourceSellByLoc {
				if source.Price < bestPrice {
					bestPrice = source.Price
					sourceLocID = locID
					sourcePrice = source.Price
					sourceVolume = source.VolumeRemain
					sourceSystemID = source.SystemID
					sourceOrderCount = source.OrderCount
					sourceBestLevelQty = source.BestPriceVolume
				}
			}
		}
		if sourceLocID <= 0 || sourcePrice <= 0 {
			continue
		}

		var destLocID int64
		var destinationPrice float64
		var destinationVolume int32
		var destinationSystemID int32
		var destinationOrderCount int
		if useSellOrderRevenue {
			bestPrice := math.MaxFloat64
			for locID, destination := range bestDestSellByLoc {
				if targetMarketLocationID > 0 && locID != targetMarketLocationID {
					continue
				}
				if targetMarketSystemID > 0 && destination.SystemID != targetMarketSystemID {
					continue
				}
				if destination.Price < bestPrice {
					bestPrice = destination.Price
					destLocID = locID
					destinationPrice = destination.Price
					destinationVolume = destination.VolumeRemain
					destinationSystemID = destination.SystemID
					destinationOrderCount = destination.OrderCount
				}
			}
		} else {
			bestPrice := -1.0
			for locID, destination := range bestDestBuyByLoc {
				if targetMarketLocationID > 0 && locID != targetMarketLocationID {
					continue
				}
				if targetMarketSystemID > 0 && destination.SystemID != targetMarketSystemID {
					continue
				}
				if destination.Price > bestPrice {
					bestPrice = destination.Price
					destLocID = locID
					destinationPrice = destination.Price
					destinationVolume = destination.VolumeRemain
					destinationSystemID = destination.SystemID
					destinationOrderCount = destination.OrderCount
				}
			}
		}
		if destLocID <= 0 || destinationPrice <= 0 {
			if !useSellOrderRevenue && (targetMarketSystemID > 0 || targetMarketLocationID > 0) {
				destLocID = targetMarketLocationID
				destinationPrice = 0
				destinationVolume = 0
				destinationSystemID = targetMarketSystemID
				destinationOrderCount = 0
			} else {
				continue
			}
		}
		if sourceLocID == destLocID {
			continue
		}

		effectiveBuyPrice := sourcePrice * buyCostMult
		effectiveSellPrice := destinationPrice * sellRevenueMult
		profitPerUnit := effectiveSellPrice - effectiveBuyPrice
		margin := 0.0
		if effectiveBuyPrice > 0 {
			margin = profitPerUnit / effectiveBuyPrice * 100
		}

		units := maxUnits
		if sourceVolume < units {
			units = sourceVolume
		}
		if !useSellOrderRevenue && destinationVolume < units {
			units = destinationVolume
		}
		if units <= 0 {
			continue
		}

		totalProfit := profitPerUnit * float64(units)
		buyJumps := s.jumpsBetweenWithBFS(params.CurrentSystemID, sourceSystemID, bfsDistances, minSec)
		sellJumps := s.jumpsBetweenWithSecurity(sourceSystemID, destinationSystemID, minSec)
		if buyJumps >= UnreachableJumps || sellJumps >= UnreachableJumps {
			continue
		}

		totalJumps := buyJumps + sellJumps
		profitPerJump := 0.0
		if totalJumps > 0 {
			profitPerJump = totalProfit / float64(totalJumps)
		}

		targetSellSupply := int64(0)
		targetLowestSell := 0.0
		switch {
		case targetMarketLocationID > 0:
			locK := locKey{typeID, targetMarketLocationID}
			targetSellSupply = idx.sellSideSellDepthByLoc[locK]
			targetLowestSell = idx.sellSideSellMinPriceByLoc[locK]
		case targetMarketSystemID > 0:
			sysK := sysTypeKey{typeID, targetMarketSystemID}
			targetSellSupply = idx.sellSideSellDepthByTypeSystem[sysK]
			targetLowestSell = idx.sellSideSellMinPriceByTypeSystem[sysK]
		default:
			locK := locKey{typeID, destLocID}
			targetSellSupply = idx.sellSideSellDepthByLoc[locK]
			targetLowestSell = idx.sellSideSellMinPriceByLoc[locK]
			if targetSellSupply <= 0 {
				targetSellSupply = idx.sellSideSellDepthByType[typeID]
			}
		}

		buyRegionID := int32(0)
		if sys, ok := s.SDE.Systems[sourceSystemID]; ok {
			buyRegionID = sys.RegionID
		}
		sellRegionID := int32(0)
		if sys, ok := s.SDE.Systems[destinationSystemID]; ok {
			sellRegionID = sys.RegionID
		}

		bestAskPrice := 0.0
		bestAskQty := int32(0)
		if !useSourceBuyOrders {
			bestAskPrice = sourcePrice
			bestAskQty = sourceBestLevelQty
		}
		bestBidPrice := 0.0
		bestBidQty := int32(0)
		if useSourceBuyOrders {
			bestBidPrice = sourcePrice
			bestBidQty = sourceBestLevelQty
		}

		results = append(results, FlipResult{
			TypeID:           typeID,
			TypeName:         itemType.Name,
			Volume:           itemType.Volume,
			BuyPrice:         sourcePrice,
			BestAskPrice:     bestAskPrice,
			BestAskQty:       bestAskQty,
			BestBidPrice:     bestBidPrice,
			BestBidQty:       bestBidQty,
			BuyStation:       "",
			BuySystemName:    s.systemName(sourceSystemID),
			BuySystemID:      sourceSystemID,
			BuyRegionID:      buyRegionID,
			BuyRegionName:    s.regionName(buyRegionID),
			BuyLocationID:    sourceLocID,
			SellPrice:        destinationPrice,
			SellStation:      "",
			SellSystemName:   s.systemName(destinationSystemID),
			SellSystemID:     destinationSystemID,
			SellRegionID:     sellRegionID,
			SellRegionName:   s.regionName(sellRegionID),
			SellLocationID:   destLocID,
			ProfitPerUnit:    profitPerUnit,
			MarginPercent:    margin,
			UnitsToBuy:       units,
			BuyOrderRemain:   destinationVolume,
			SellOrderRemain:  sourceVolume,
			TotalProfit:      totalProfit,
			ProfitPerJump:    sanitizeFloat(profitPerJump),
			BuyJumps:         buyJumps,
			SellJumps:        sellJumps,
			TotalJumps:       totalJumps,
			BuyCompetitors:   sourceOrderCount,
			SellCompetitors:  destinationOrderCount,
			TargetSellSupply: targetSellSupply,
			TargetLowestSell: targetLowestSell,
		})
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].TypeName < results[j].TypeName
	})

	if len(results) > 0 {
		topStations := make(map[int64]bool)
		for i := range results {
			topStations[results[i].BuyLocationID] = true
			topStations[results[i].SellLocationID] = true
		}
		s.ESI.PrefetchStationNames(topStations)
		for i := range results {
			results[i].BuyStation = s.ESI.StationName(results[i].BuyLocationID)
			results[i].SellStation = s.ESI.StationName(results[i].SellLocationID)
			if strings.HasPrefix(results[i].SellStation, "Location ") {
				if sys, ok := s.SDE.Systems[results[i].SellSystemID]; ok {
					results[i].SellStation = fmt.Sprintf("Structure @ %s", sys.Name)
				}
			}
			if strings.HasPrefix(results[i].BuyStation, "Location ") {
				if sys, ok := s.SDE.Systems[results[i].BuySystemID]; ok {
					results[i].BuyStation = fmt.Sprintf("Structure @ %s", sys.Name)
				}
			}
		}
	}

	s.enrichWithHistory(results, func(string) {})
	for i := range results {
		s2b, bfs := estimateSideFlowsPerDay(
			float64(results[i].DailyVolume),
			idx.sellSideBuyDepthByType[results[i].TypeID],
			idx.sellSideSellDepthByType[results[i].TypeID],
		)
		results[i].S2BPerDay = sanitizeFloat(s2b)
		results[i].BfSPerDay = sanitizeFloat(bfs)
		if results[i].BfSPerDay > 0 {
			results[i].S2BBfSRatio = sanitizeFloat(results[i].S2BPerDay / results[i].BfSPerDay)
		}
		results[i].DailyProfit = results[i].ProfitPerUnit * float64(estimateFlipDailyExecutableUnitsPerDay(
			results[i].UnitsToBuy,
			results[i].S2BPerDay,
			results[i].BfSPerDay,
		))
	}
	return results, nil
}

func (s *Scanner) importExportHistoryBundles(typeIDs []int32, route config.ImportExportRoute, targetRegionID int32) map[int32]importExportHistoryBundle {
	out := make(map[int32]importExportHistoryBundle, len(typeIDs))
	periodDays := regionalPeriodDays(ScanParams{AvgPricePeriod: route.AvgPricePeriod})
	for _, typeID := range typeIDs {
		sourceEntries := s.historyEntries(route.SourceRegionID, typeID)
		targetEntries := s.historyEntries(targetRegionID, typeID)
		sourceAvg, _, _ := CalcAvgPriceStats(sourceEntries, periodDays)
		targetAvg, _, _ := CalcAvgPriceStats(targetEntries, periodDays)
		volWindowDays := periodDays
		if volWindowDays < 14 {
			volWindowDays = 14
		}
		if volWindowDays > 30 {
			volWindowDays = 30
		}
		out[typeID] = importExportHistoryBundle{
			source: regionalHistoryStats{
				avgPrice:      sanitizeFloat(sourceAvg),
				demandPerDay:  sanitizeFloat(avgDailyVolume(sourceEntries, periodDays)),
				drvi:          sanitizeFloat(CalcDRVI(sourceEntries, volWindowDays)),
				windowEntries: len(filterLastNDays(sourceEntries, periodDays)),
				entries:       sourceEntries,
			},
			target: regionalHistoryStats{
				avgPrice:      sanitizeFloat(targetAvg),
				demandPerDay:  sanitizeFloat(avgDailyVolume(targetEntries, periodDays)),
				drvi:          sanitizeFloat(CalcDRVI(targetEntries, volWindowDays)),
				windowEntries: len(filterLastNDays(targetEntries, periodDays)),
				entries:       targetEntries,
			},
		}
	}
	return out
}

func (s *Scanner) importExportRowsForMode(
	params ScanParams,
	rawRows []FlipResult,
	historyByType map[int32]importExportHistoryBundle,
	itemMeta map[int32]config.ImportExportRouteItem,
) []FlipResult {
	periodDays := regionalPeriodDays(params)
	feeInputs := tradeFeeInputs{
		SplitTradeFees:       params.SplitTradeFees,
		BrokerFeePercent:     params.BrokerFeePercent,
		SalesTaxPercent:      params.SalesTaxPercent,
		BuyBrokerFeePercent:  params.BuyBrokerFeePercent,
		SellBrokerFeePercent: params.SellBrokerFeePercent,
		BuySalesTaxPercent:   params.BuySalesTaxPercent,
		SellSalesTaxPercent:  params.SellSalesTaxPercent,
	}
	buyCostMult, sellRevenueMult := tradeFeeMultipliers(feeInputs)
	buyBrokerPct, buyTaxPct, sellBrokerPct, sellTaxPct := tradeFeePercents(feeInputs)
	rowsByType := make(map[int32]FlipResult, len(itemMeta))
	for _, row := range rawRows {
		meta, ok := itemMeta[row.TypeID]
		if !ok {
			continue
		}
		history := historyByType[row.TypeID]
		rowParams := params
		if meta.CustomPurchaseDemandDays != nil {
			rowParams.PurchaseDemandDays = *meta.CustomPurchaseDemandDays
		}
		enriched, ok := s.importExportEnrichRow(
			rowParams,
			row,
			history,
			buyCostMult,
			sellRevenueMult,
			buyBrokerPct,
			buyTaxPct,
			sellBrokerPct,
			sellTaxPct,
			meta,
			periodDays,
		)
		if !ok {
			continue
		}
		current, exists := rowsByType[row.TypeID]
		if !exists || enriched.DayPeriodProfit > current.DayPeriodProfit {
			rowsByType[row.TypeID] = enriched
		}
	}
	rows := make([]FlipResult, 0, len(rowsByType))
	for _, row := range rowsByType {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].DayPeriodProfit == rows[j].DayPeriodProfit {
			return rows[i].TypeName < rows[j].TypeName
		}
		return rows[i].DayPeriodProfit > rows[j].DayPeriodProfit
	})
	return rows
}

func (s *Scanner) importExportEnrichRow(
	params ScanParams,
	row FlipResult,
	history importExportHistoryBundle,
	buyCostMult, sellRevenueMult float64,
	buyBrokerPct, buyTaxPct, sellBrokerPct, sellTaxPct float64,
	meta config.ImportExportRouteItem,
	periodDays int,
) (FlipResult, bool) {
	sourceStats := history.source
	targetStats := history.target

	sourceAvgPrice := stabilizedSourceBuyPrice(
		row.ExpectedBuyPrice,
		row.BuyPrice,
		sourceStats,
		periodDays,
	)
	targetNowPrice := row.SellPrice
	if row.ExpectedSellPrice > 0 {
		targetNowPrice = row.ExpectedSellPrice
	}
	if params.UsesSellOrderRevenue() {
		if row.TargetLowestSell > 0 {
			targetNowPrice = row.TargetLowestSell
		} else if targetStats.avgPrice > 0 {
			targetNowPrice = targetStats.avgPrice
		}
	}
	targetPeriodPrice := stabilizedTargetPeriodPrice(
		targetStats,
		targetNowPrice,
		row.TargetLowestSell,
		periodDays,
		params.UsesSellOrderRevenue(),
	)
	targetDemandPerDay := blendedRegionalDemandPerDay(row, targetStats, periodDays)
	targetHistoricalDemandPerDay := sanitizeFloat(math.Max(targetStats.demandPerDay, 0))
	purchaseUnits := row.UnitsToBuy
	if params.UsesSellOrderRevenue() && row.SellOrderRemain > 0 {
		purchaseUnits = row.SellOrderRemain
	}
	if targetDemandPerDay > 0 {
		demandDays := regionalPurchaseDemandDays(params)
		demandCap := int32(math.Ceil(targetDemandPerDay * demandDays))
		if demandCap <= 0 {
			demandCap = 1
		}
		if demandCap < purchaseUnits || purchaseUnits <= 0 {
			purchaseUnits = demandCap
		}
	}
	if params.CargoCapacity > 0 && row.Volume > 0 {
		maxByCargoF := math.Floor(params.CargoCapacity / row.Volume)
		if maxByCargoF <= 0 {
			return FlipResult{}, false
		}
		if maxByCargoF > float64(math.MaxInt32) {
			maxByCargoF = float64(math.MaxInt32)
		}
		maxByCargo := int32(maxByCargoF)
		if purchaseUnits > maxByCargo {
			purchaseUnits = maxByCargo
		}
	}
	if purchaseUnits <= 0 {
		return FlipResult{}, false
	}

	jumps := row.SellJumps
	if jumps <= 0 {
		jumps = row.TotalJumps - row.BuyJumps
	}
	if jumps <= 0 {
		jumps = 1
	}

	shippingCost := params.ShippingCostPerM3Jump * row.Volume * float64(purchaseUnits)
	if routeShippingMode(params) == importExportShippingPerJump {
		shippingCost *= float64(jumps)
	}
	sourceGross := sourceAvgPrice * float64(purchaseUnits)
	targetNowGross := targetNowPrice * float64(purchaseUnits)
	targetPeriodGross := targetPeriodPrice * float64(purchaseUnits)
	buyBrokerFees := 0.0
	buySalesTaxes := 0.0
	buySCCSurcharge := 0.0
	if params.UsesSourceBuyOrders() {
		buyBrokerFees = sourceGross * (buyBrokerPct / 100.0)
		buySalesTaxes = sourceGross * (buyTaxPct / 100.0)
		buySCCSurcharge = sourceGross * (importExportSCCSurchargePercent / 100.0)
	}
	sellBrokerFeesNow := 0.0
	sellSalesTaxesNow := 0.0
	sellSCCSurchargeNow := 0.0
	sellBrokerFeesPeriod := 0.0
	sellSalesTaxesPeriod := 0.0
	sellSCCSurchargePeriod := 0.0
	if params.UsesSellOrderRevenue() {
		sellBrokerFeesNow = targetNowGross * (sellBrokerPct / 100.0)
		sellSalesTaxesNow = targetNowGross * (sellTaxPct / 100.0)
		sellSCCSurchargeNow = targetNowGross * (importExportSCCSurchargePercent / 100.0)
		sellBrokerFeesPeriod = targetPeriodGross * (sellBrokerPct / 100.0)
		sellSalesTaxesPeriod = targetPeriodGross * (sellTaxPct / 100.0)
		sellSCCSurchargePeriod = targetPeriodGross * (importExportSCCSurchargePercent / 100.0)
	}
	buyOrderFees := buyBrokerFees + buySalesTaxes + buySCCSurcharge
	sellOrderFeesNow := sellBrokerFeesNow + sellSalesTaxesNow + sellSCCSurchargeNow
	sellOrderFeesPeriod := sellBrokerFeesPeriod + sellSalesTaxesPeriod + sellSCCSurchargePeriod
	sourceTotal := sourceGross + buyOrderFees
	targetNowTotal := targetNowGross - sellOrderFeesNow
	targetPeriodTotal := targetPeriodGross - sellOrderFeesPeriod
	unitNowProfit := 0.0
	unitPeriodProfit := 0.0
	if purchaseUnits > 0 {
		unitNowProfit = (targetNowTotal - sourceTotal) / float64(purchaseUnits)
		unitPeriodProfit = (targetPeriodTotal - sourceTotal) / float64(purchaseUnits)
	}
	nowProfit := targetNowTotal - sourceTotal - shippingCost
	periodProfit := targetPeriodTotal - sourceTotal - shippingCost
	capitalRequired := sourceTotal

	marginNow := 0.0
	marginPeriod := 0.0
	roiNow := 0.0
	roiPeriod := 0.0
	if capitalRequired > 0 {
		effectiveUnitCost := sourceAvgPrice * buyCostMult
		marginNow = sanitizeFloat((unitNowProfit / effectiveUnitCost) * 100)
		marginPeriod = sanitizeFloat((unitPeriodProfit / effectiveUnitCost) * 100)
		totalDeployed := capitalRequired + shippingCost
		minExecutableCapitalForROI := 200_000.0
		if params.UsesSellOrderRevenue() {
			minExecutableCapitalForROI = 1_000_000.0
		}
		roiDenominator := totalDeployed
		if roiDenominator < minExecutableCapitalForROI {
			roiDenominator = minExecutableCapitalForROI
		}
		roiNow = sanitizeFloat((nowProfit / roiDenominator) * 100)
		roiPeriod = sanitizeFloat((periodProfit / roiDenominator) * 100)
	}

	targetSupplyUnits := regionalFallbackSupplyUnits(row, periodDays)
	targetDOS := 0.0
	if targetDemandPerDay > 0 {
		targetDOS = sanitizeFloat(float64(targetSupplyUnits) / targetDemandPerDay)
		if targetDOS > 9_999 {
			targetDOS = 9_999
		}
	}

	priceHistory := extractLastNAvgPrices(targetStats.entries, periodDays)
	tradeScore := computeTradeScore(regionalTradeScoreInput{
		ROIPeriod:           roiPeriod,
		DemandPerDay:        targetDemandPerDay,
		DOS:                 targetDOS,
		MarginPeriod:        marginPeriod,
		HistoryEntries:      targetStats.windowEntries,
		PeriodDays:          periodDays,
		VolatilityDRVI:      targetStats.drvi,
		PriceDislocationPct: regionalPriceDislocationPct(targetNowPrice, targetPeriodPrice),
		FlowBalanceScore:    regionalFlowBalanceScore(targetDemandPerDay, row.BfSPerDay),
	})

	row.UnitsToBuy = purchaseUnits
	row.TotalProfit = sanitizeFloat(nowProfit)
	row.RealProfit = sanitizeFloat(periodProfit)
	row.ExpectedProfit = sanitizeFloat(periodProfit)
	row.ProfitPerUnit = sanitizeFloat(unitNowProfit)
	row.MarginPercent = sanitizeFloat(marginNow)
	row.ProfitPerJump = sanitizeFloat(nowProfit / float64(jumps))
	row.DailyProfit = sanitizeFloat(unitNowProfit * targetDemandPerDay)
	row.DaySourceUnits = row.SellOrderRemain
	row.DayTargetDemandPerDay = sanitizeFloat(targetDemandPerDay)
	row.DayTargetHistoricalDemandPerDay = targetHistoricalDemandPerDay
	row.DayTargetSupplyUnits = targetSupplyUnits
	row.DayTargetDOS = targetDOS
	row.DaySourceAvgPrice = sanitizeFloat(sourceAvgPrice)
	row.DayTargetNowPrice = sanitizeFloat(targetNowPrice)
	row.DayTargetPeriodPrice = sanitizeFloat(targetPeriodPrice)
	row.DayNowProfit = sanitizeFloat(nowProfit)
	row.DayPeriodProfit = sanitizeFloat(periodProfit)
	row.DayROINow = roiNow
	row.DayROIPeriod = roiPeriod
	row.DayCapitalRequired = sanitizeFloat(capitalRequired)
	row.DayShippingCost = sanitizeFloat(shippingCost)
	row.DaySourceGross = sanitizeFloat(sourceGross)
	row.DaySourceTotal = sanitizeFloat(sourceTotal)
	row.DayTargetGross = sanitizeFloat(targetNowGross)
	row.DayTargetTotal = sanitizeFloat(targetNowTotal)
	row.DayBuyOrderFees = sanitizeFloat(buyOrderFees)
	row.DayBuyBrokerFees = sanitizeFloat(buyBrokerFees)
	row.DayBuySalesTaxes = sanitizeFloat(buySalesTaxes)
	row.DayBuySCCSurcharge = sanitizeFloat(buySCCSurcharge)
	row.DaySellOrderFees = sanitizeFloat(sellOrderFeesNow)
	row.DaySellBrokerFees = sanitizeFloat(sellBrokerFeesNow)
	row.DaySellSalesTaxes = sanitizeFloat(sellSalesTaxesNow)
	row.DaySellSCCSurcharge = sanitizeFloat(sellSCCSurchargeNow)
	row.DayCategoryID = meta.CategoryID
	row.DayGroupID = meta.GroupID
	row.DayGroupName = meta.GroupName
	row.DayTradeScore = tradeScore
	row.DayPriceHistory = priceHistory
	row.DayTargetLowestSell = sanitizeFloat(row.TargetLowestSell)
	row.S2BPerDay = sanitizeFloat(targetDemandPerDay)
	if row.Volume > 0 && jumps > 0 {
		row.DayIskPerM3Jump = sanitizeFloat(unitNowProfit / (row.Volume * float64(jumps)))
	}
	if params.UsesSellOrderRevenue() {
		row.ExpectedProfit = sanitizeFloat(targetPeriodTotal - sourceTotal - shippingCost)
	}
	return row, true
}

func routeShippingMode(params ScanParams) string {
	mode := strings.TrimSpace(strings.ToLower(params.ShippingMode))
	if mode == importExportShippingPerJump {
		return importExportShippingPerJump
	}
	return importExportShippingPerRoute
}

func importExportStructureBuyScenarioBrief(row FlipResult) ImportExportScenarioBrief {
	sourceGross := row.DaySourceGross
	if sourceGross <= 0 {
		sourceGross = row.DaySourceAvgPrice * float64(row.UnitsToBuy)
	}
	targetGross := row.DayTargetGross
	targetTotal := row.DayTargetTotal
	if targetGross <= 0 {
		targetGross = row.DayTargetNowPrice * float64(row.UnitsToBuy)
	}
	if targetTotal <= 0 {
		targetTotal = targetGross - row.DaySellOrderFees
	}
	targetPeriodGross := row.DayTargetPeriodPrice * float64(row.UnitsToBuy)
	targetPeriodTotal := targetPeriodGross - row.DaySellBrokerFees - row.DaySellSalesTaxes - (targetPeriodGross * (importExportSCCSurchargePercent / 100.0))
	buyBrokerFees := 100.0
	if row.UnitsToBuy <= 0 || sourceGross <= 0 {
		buyBrokerFees = 0
	}
	buySalesTaxes := row.DayBuySalesTaxes
	buySCCSurcharge := sourceGross * (importExportSCCSurchargePercent / 100.0)
	buyOrderFees := buyBrokerFees + buySalesTaxes + buySCCSurcharge
	sourceTotal := sourceGross + buyOrderFees
	nowProfit := targetTotal - sourceTotal - row.DayShippingCost
	periodProfit := targetPeriodTotal - sourceTotal - row.DayShippingCost
	marginPercent := 0.0
	roiNow := 0.0
	roiPeriod := 0.0
	if sourceTotal > 0 {
		marginPercent = sanitizeFloat(((targetTotal - sourceTotal) / sourceTotal) * 100)
		roiNow = sanitizeFloat((nowProfit / (sourceTotal + row.DayShippingCost)) * 100)
		roiPeriod = sanitizeFloat((periodProfit / (sourceTotal + row.DayShippingCost)) * 100)
	}
	return ImportExportScenarioBrief{
		Key:                          "buy_order_sell_order_structure",
		Label:                        "Buy Orders In Player Structures",
		TradeMode:                    TradeModeBuyOrderToSell,
		PurchaseUnits:                row.UnitsToBuy,
		SourcePrice:                  row.DaySourceAvgPrice,
		SourceGross:                  sanitizeFloat(sourceGross),
		SourceTotal:                  sanitizeFloat(sourceTotal),
		TargetNowPrice:               row.DayTargetNowPrice,
		TargetPeriodPrice:            row.DayTargetPeriodPrice,
		TargetGross:                  sanitizeFloat(targetGross),
		TargetTotal:                  sanitizeFloat(targetTotal),
		BuyOrderFees:                 sanitizeFloat(buyOrderFees),
		BuyBrokerFees:                sanitizeFloat(buyBrokerFees),
		BuySalesTaxes:                sanitizeFloat(buySalesTaxes),
		BuySCCSurcharge:              sanitizeFloat(buySCCSurcharge),
		SellOrderFees:                row.DaySellOrderFees,
		SellBrokerFees:               row.DaySellBrokerFees,
		SellSalesTaxes:               row.DaySellSalesTaxes,
		SellSCCSurcharge:             row.DaySellSCCSurcharge,
		NowProfit:                    sanitizeFloat(nowProfit),
		PeriodProfit:                 sanitizeFloat(periodProfit),
		MarginPercent:                marginPercent,
		ROINow:                       roiNow,
		ROIPeriod:                    roiPeriod,
		CapitalRequired:              sanitizeFloat(sourceTotal),
		ShippingCost:                 row.DayShippingCost,
		TargetDemandPerDay:           row.DayTargetDemandPerDay,
		TargetHistoricalDemandPerDay: row.DayTargetHistoricalDemandPerDay,
		TargetSupplyUnits:            row.DayTargetSupplyUnits,
		TargetDOS:                    row.DayTargetDOS,
		TradeScore:                   row.DayTradeScore,
	}
}
