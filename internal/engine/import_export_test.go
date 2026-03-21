package engine

import (
	"testing"

	"eve-flipper/internal/config"
)

func TestImportExportRowsForMode_UsesItemCustomPurchaseDemandDays(t *testing.T) {
	override := 0.5
	rows := (&Scanner{}).importExportRowsForMode(
		ScanParams{
			PurchaseDemandDays: 2,
			AvgPricePeriod:     14,
			TradeMode:          TradeModeInstantSell,
		},
		[]FlipResult{
			{
				TypeID:            34,
				TypeName:          "Tritanium",
				Volume:            1,
				BuyPrice:          5,
				SellPrice:         10,
				TargetLowestSell:  10,
				UnitsToBuy:        100,
				SellOrderRemain:   100,
				SellJumps:         5,
				TotalJumps:        5,
				S2BPerDay:         10,
				BfSPerDay:         10,
				TargetSellSupply:  20,
				HistoryAvailable:  true,
				ExpectedBuyPrice:  5,
				ExpectedSellPrice: 10,
			},
		},
		map[int32]importExportHistoryBundle{},
		map[int32]config.ImportExportRouteItem{
			34: {
				TypeID:                   34,
				TypeName:                 "Tritanium",
				CustomPurchaseDemandDays: &override,
			},
		},
	)
	if len(rows) != 1 {
		t.Fatalf("rows len = %d, want 1", len(rows))
	}
	if rows[0].UnitsToBuy != 5 {
		t.Fatalf("units to buy = %d, want 5", rows[0].UnitsToBuy)
	}
}
