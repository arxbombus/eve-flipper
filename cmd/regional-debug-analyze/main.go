package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type orderRow struct {
	TypeID       int32
	LocationID   int64
	SystemID     int32
	IsBuyOrder   bool
	Price        float64
	VolumeRemain int32
}

type opportunity struct {
	TypeID           int32
	Mode             string
	SourceSystemID   int32
	SourceLocationID int64
	SourcePrice      float64
	TargetSystemID   int32
	TargetLocationID int64
	TargetPrice      float64
	EffectiveBuy     float64
	EffectiveSell    float64
	UnitProfit       float64
	MarginPct        float64
}

type summary struct {
	SourceSystemID          int32             `json:"source_system_id"`
	TargetSystemID          int32             `json:"target_system_id"`
	TargetLocationID        int64             `json:"target_location_id"`
	OrdersTotal             int               `json:"orders_total"`
	SourceTypesWithSells    int               `json:"source_types_with_sells"`
	TargetTypesWithBuys     int               `json:"target_types_with_buys"`
	TargetTypesWithSells    int               `json:"target_types_with_sells"`
	ProfitableInstant       int               `json:"profitable_instant"`
	ProfitableSellOrder     int               `json:"profitable_sell_order"`
	ProfitableSellOrderOnly int               `json:"profitable_sell_order_only"`
	Files                   map[string]string `json:"files"`
}

func main() {
	var (
		ordersCSV        = flag.String("orders-csv", "", "Input CSV from regional-debug-export")
		sourceSystemID   = flag.Int("source-system-id", 0, "Source system ID (e.g. Jita)")
		targetSystemID   = flag.Int("target-system-id", 0, "Target system ID (e.g. C-J6MT)")
		targetLocationID = flag.Int64("target-location-id", 0, "Optional exact target location ID")
		buyBrokerFeePct  = flag.Float64("buy-broker-fee-pct", 0, "Buy-side broker fee percent")
		sellBrokerFeePct = flag.Float64("sell-broker-fee-pct", 0, "Sell-side broker fee percent")
		sellSalesTaxPct  = flag.Float64("sell-sales-tax-pct", 8, "Sell-side sales tax percent")
		undercutPct      = flag.Float64("undercut-pct", 0.1, "Sell-order mode undercut against lowest ask")
		minMarginPct     = flag.Float64("min-margin-pct", 0, "Minimum margin percent")
		outDir           = flag.String("out-dir", "tmp/regional_debug", "Output directory")
		topN             = flag.Int("top", 100, "Rows per output CSV")
	)
	flag.Parse()

	if strings.TrimSpace(*ordersCSV) == "" || *sourceSystemID <= 0 || *targetSystemID <= 0 {
		die("required: --orders-csv, --source-system-id, --target-system-id")
	}

	orders, err := loadOrders(*ordersCSV)
	if err != nil {
		die("load csv: %v", err)
	}

	sourceSells := bestSourceSellByType(orders, int32(*sourceSystemID))
	targetBuys := bestTargetBuyByType(orders, int32(*targetSystemID), *targetLocationID)
	targetSells := bestTargetSellByType(orders, int32(*targetSystemID), *targetLocationID)

	instant := computeInstant(sourceSells, targetBuys, *buyBrokerFeePct, *sellBrokerFeePct, *sellSalesTaxPct, *minMarginPct)
	sellOrder := computeSellOrder(sourceSells, targetSells, *undercutPct, *buyBrokerFeePct, *sellBrokerFeePct, *sellSalesTaxPct, *minMarginPct)

	instantTypeIDs := map[int32]bool{}
	for _, x := range instant {
		instantTypeIDs[x.TypeID] = true
	}
	sellOrderOnly := make([]opportunity, 0, len(sellOrder))
	for _, x := range sellOrder {
		if !instantTypeIDs[x.TypeID] {
			sellOrderOnly = append(sellOrderOnly, x)
		}
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		die("create out dir: %v", err)
	}
	instantPath := filepath.Join(*outDir, "instant_opportunities.csv")
	sellPath := filepath.Join(*outDir, "sell_order_opportunities.csv")
	onlyPath := filepath.Join(*outDir, "sell_order_only_opportunities.csv")
	if err := writeOppCSV(instantPath, instant, *topN); err != nil {
		die("write instant csv: %v", err)
	}
	if err := writeOppCSV(sellPath, sellOrder, *topN); err != nil {
		die("write sell-order csv: %v", err)
	}
	if err := writeOppCSV(onlyPath, sellOrderOnly, *topN); err != nil {
		die("write sell-order-only csv: %v", err)
	}

	s := summary{
		SourceSystemID:          int32(*sourceSystemID),
		TargetSystemID:          int32(*targetSystemID),
		TargetLocationID:        *targetLocationID,
		OrdersTotal:             len(orders),
		SourceTypesWithSells:    len(sourceSells),
		TargetTypesWithBuys:     len(targetBuys),
		TargetTypesWithSells:    len(targetSells),
		ProfitableInstant:       len(instant),
		ProfitableSellOrder:     len(sellOrder),
		ProfitableSellOrderOnly: len(sellOrderOnly),
		Files: map[string]string{
			"instant":         instantPath,
			"sell_order":      sellPath,
			"sell_order_only": onlyPath,
		},
	}

	sumPath := filepath.Join(*outDir, "analysis_summary.json")
	sumJSON, _ := json.MarshalIndent(s, "", "  ")
	if err := os.WriteFile(sumPath, sumJSON, 0o644); err != nil {
		die("write summary json: %v", err)
	}

	fmt.Println(string(sumJSON))
	fmt.Printf("[ok] summary: %s\n", sumPath)
}

func loadOrders(path string) ([]orderRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	headers, err := r.Read()
	if err != nil {
		return nil, err
	}
	index := map[string]int{}
	for i, h := range headers {
		index[h] = i
	}

	need := []string{"type_id", "location_id", "system_id", "is_buy_order", "price", "volume_remain"}
	for _, k := range need {
		if _, ok := index[k]; !ok {
			return nil, fmt.Errorf("missing column %q", k)
		}
	}

	out := make([]orderRow, 0, 200000)
	for {
		rec, err := r.Read()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, err
		}
		out = append(out, orderRow{
			TypeID:       int32(mustParseInt64(rec[index["type_id"]])),
			LocationID:   mustParseInt64(rec[index["location_id"]]),
			SystemID:     int32(mustParseInt64(rec[index["system_id"]])),
			IsBuyOrder:   strings.EqualFold(strings.TrimSpace(rec[index["is_buy_order"]]), "true"),
			Price:        mustParseFloat(rec[index["price"]]),
			VolumeRemain: int32(mustParseInt64(rec[index["volume_remain"]])),
		})
	}
	return out, nil
}

func bestSourceSellByType(rows []orderRow, sourceSystemID int32) map[int32]orderRow {
	out := map[int32]orderRow{}
	for _, r := range rows {
		if r.SystemID != sourceSystemID || r.IsBuyOrder || r.Price <= 0 || r.VolumeRemain <= 0 {
			continue
		}
		if cur, ok := out[r.TypeID]; !ok || r.Price < cur.Price {
			out[r.TypeID] = r
		}
	}
	return out
}

func bestTargetBuyByType(rows []orderRow, targetSystemID int32, targetLocationID int64) map[int32]orderRow {
	out := map[int32]orderRow{}
	for _, r := range rows {
		if r.SystemID != targetSystemID || !r.IsBuyOrder || r.Price <= 0 || r.VolumeRemain <= 0 {
			continue
		}
		if targetLocationID > 0 && r.LocationID != targetLocationID {
			continue
		}
		if cur, ok := out[r.TypeID]; !ok || r.Price > cur.Price {
			out[r.TypeID] = r
		}
	}
	return out
}

func bestTargetSellByType(rows []orderRow, targetSystemID int32, targetLocationID int64) map[int32]orderRow {
	out := map[int32]orderRow{}
	for _, r := range rows {
		if r.SystemID != targetSystemID || r.IsBuyOrder || r.Price <= 0 || r.VolumeRemain <= 0 {
			continue
		}
		if targetLocationID > 0 && r.LocationID != targetLocationID {
			continue
		}
		if cur, ok := out[r.TypeID]; !ok || r.Price < cur.Price {
			out[r.TypeID] = r
		}
	}
	return out
}

func computeInstant(source map[int32]orderRow, target map[int32]orderRow, buyFee, sellFee, salesTax, minMargin float64) []opportunity {
	out := make([]opportunity, 0, len(source))
	for typeID, src := range source {
		tgt, ok := target[typeID]
		if !ok {
			continue
		}
		eb, es, profit, margin := computeProfit(src.Price, tgt.Price, buyFee, sellFee, salesTax)
		if profit <= 0 || margin < minMargin {
			continue
		}
		out = append(out, opportunity{
			TypeID:           typeID,
			Mode:             "instant",
			SourceSystemID:   src.SystemID,
			SourceLocationID: src.LocationID,
			SourcePrice:      src.Price,
			TargetSystemID:   tgt.SystemID,
			TargetLocationID: tgt.LocationID,
			TargetPrice:      tgt.Price,
			EffectiveBuy:     eb,
			EffectiveSell:    es,
			UnitProfit:       profit,
			MarginPct:        margin,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UnitProfit > out[j].UnitProfit })
	return out
}

func computeSellOrder(source map[int32]orderRow, target map[int32]orderRow, undercutPct, buyFee, sellFee, salesTax, minMargin float64) []opportunity {
	out := make([]opportunity, 0, len(source))
	undercutMult := 1.0 - max(0, undercutPct)/100.0
	for typeID, src := range source {
		tgt, ok := target[typeID]
		if !ok {
			continue
		}
		listPrice := tgt.Price * undercutMult
		if listPrice <= 0 {
			continue
		}
		eb, es, profit, margin := computeProfit(src.Price, listPrice, buyFee, sellFee, salesTax)
		if profit <= 0 || margin < minMargin {
			continue
		}
		out = append(out, opportunity{
			TypeID:           typeID,
			Mode:             "sell_order",
			SourceSystemID:   src.SystemID,
			SourceLocationID: src.LocationID,
			SourcePrice:      src.Price,
			TargetSystemID:   tgt.SystemID,
			TargetLocationID: tgt.LocationID,
			TargetPrice:      listPrice,
			EffectiveBuy:     eb,
			EffectiveSell:    es,
			UnitProfit:       profit,
			MarginPct:        margin,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UnitProfit > out[j].UnitProfit })
	return out
}

func computeProfit(sourceBuyPrice, targetSellPrice, buyBrokerFeePct, sellBrokerFeePct, sellSalesTaxPct float64) (effectiveBuy, effectiveSell, unitProfit, marginPct float64) {
	effectiveBuy = sourceBuyPrice * (1 + max(0, buyBrokerFeePct)/100.0)
	effectiveSell = targetSellPrice * (1 - max(0, sellBrokerFeePct)/100.0 - max(0, sellSalesTaxPct)/100.0)
	unitProfit = effectiveSell - effectiveBuy
	if effectiveBuy <= 0 {
		return effectiveBuy, effectiveSell, unitProfit, -999999
	}
	marginPct = (unitProfit / effectiveBuy) * 100
	return effectiveBuy, effectiveSell, unitProfit, marginPct
}

func writeOppCSV(path string, rows []opportunity, top int) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := csv.NewWriter(f)
	defer w.Flush()

	header := []string{"type_id", "mode", "source_system_id", "source_location_id", "source_price", "target_system_id", "target_location_id", "target_price", "effective_buy", "effective_sell", "unit_profit", "margin_pct"}
	if err := w.Write(header); err != nil {
		return err
	}
	if top <= 0 || top > len(rows) {
		top = len(rows)
	}
	for i := 0; i < top; i++ {
		r := rows[i]
		rec := []string{
			strconv.FormatInt(int64(r.TypeID), 10),
			r.Mode,
			strconv.FormatInt(int64(r.SourceSystemID), 10),
			strconv.FormatInt(r.SourceLocationID, 10),
			strconv.FormatFloat(r.SourcePrice, 'f', 6, 64),
			strconv.FormatInt(int64(r.TargetSystemID), 10),
			strconv.FormatInt(r.TargetLocationID, 10),
			strconv.FormatFloat(r.TargetPrice, 'f', 6, 64),
			strconv.FormatFloat(r.EffectiveBuy, 'f', 6, 64),
			strconv.FormatFloat(r.EffectiveSell, 'f', 6, 64),
			strconv.FormatFloat(r.UnitProfit, 'f', 6, 64),
			strconv.FormatFloat(r.MarginPct, 'f', 4, 64),
		}
		if err := w.Write(rec); err != nil {
			return err
		}
	}
	return nil
}

func mustParseInt64(s string) int64 {
	v, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return v
}

func mustParseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(2)
}
