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
	"time"

	"eve-flipper/internal/esi"
)

type row struct {
	Source       string
	RegionID     int32
	StructureID  int64
	OrderID      int64
	TypeID       int32
	LocationID   int64
	SystemID     int32
	IsBuyOrder   bool
	Price        float64
	VolumeRemain int32
	MinVolume    int32
}

type summary struct {
	Rows       int     `json:"rows"`
	BuyOrders  int     `json:"buy_orders"`
	SellOrders int     `json:"sell_orders"`
	Regions    []int32 `json:"regions"`
	Structures []int64 `json:"structures"`
	CSV        string  `json:"csv"`
}

func main() {
	var (
		regionIDsRaw    = flag.String("region-ids", "", "Comma-separated region IDs (e.g. 10000002,10000043)")
		structureIDsRaw = flag.String("structure-ids", "", "Comma-separated structure IDs")
		accessToken     = flag.String("access-token", os.Getenv("ESI_ACCESS_TOKEN"), "ESI bearer token (or ESI_ACCESS_TOKEN)")
		outDir          = flag.String("out-dir", "tmp/regional_debug", "Output directory")
		tag             = flag.String("tag", "", "Output tag (default: UTC timestamp)")
	)
	flag.Parse()

	regions, err := parseInt32CSV(*regionIDsRaw)
	if err != nil {
		die("invalid --region-ids: %v", err)
	}
	structures, err := parseInt64CSV(*structureIDsRaw)
	if err != nil {
		die("invalid --structure-ids: %v", err)
	}
	if len(regions) == 0 && len(structures) == 0 {
		die("provide --region-ids and/or --structure-ids")
	}
	if len(structures) > 0 && strings.TrimSpace(*accessToken) == "" {
		die("--structure-ids requires --access-token (or ESI_ACCESS_TOKEN)")
	}

	if strings.TrimSpace(*tag) == "" {
		*tag = time.Now().UTC().Format("20060102T150405Z")
	}
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		die("create out dir: %v", err)
	}

	client := esi.NewClient(nil)
	client.LoadEVERefStructures()

	all := make([]row, 0, 500000)
	for _, rid := range regions {
		orders, ferr := client.FetchRegionOrders(rid, "all")
		if ferr != nil {
			fmt.Fprintf(os.Stderr, "[warn] region %d fetch failed: %v\n", rid, ferr)
			continue
		}
		for _, o := range orders {
			all = append(all, row{
				Source:       "region",
				RegionID:     rid,
				StructureID:  0,
				OrderID:      o.OrderID,
				TypeID:       o.TypeID,
				LocationID:   o.LocationID,
				SystemID:     o.SystemID,
				IsBuyOrder:   o.IsBuyOrder,
				Price:        o.Price,
				VolumeRemain: o.VolumeRemain,
				MinVolume:    o.MinVolume,
			})
		}
		fmt.Printf("[info] region %d: fetched %d orders\n", rid, len(orders))
	}

	for _, sid := range structures {
		_ = client.StructureName(sid, *accessToken)
		systemID, _ := client.StructureSystemID(sid)
		orders, ferr := client.FetchStructureOrders(sid, *accessToken)
		if ferr != nil {
			fmt.Fprintf(os.Stderr, "[warn] structure %d fetch failed: %v\n", sid, ferr)
			continue
		}
		for _, o := range orders {
			locID := o.LocationID
			if locID == 0 {
				locID = sid
			}
			sysID := o.SystemID
			if sysID <= 0 {
				sysID = systemID
			}
			all = append(all, row{
				Source:       "structure",
				RegionID:     0,
				StructureID:  sid,
				OrderID:      o.OrderID,
				TypeID:       o.TypeID,
				LocationID:   locID,
				SystemID:     sysID,
				IsBuyOrder:   o.IsBuyOrder,
				Price:        o.Price,
				VolumeRemain: o.VolumeRemain,
				MinVolume:    o.MinVolume,
			})
		}
		fmt.Printf("[info] structure %d: fetched %d orders (system_id=%d)\n", sid, len(orders), systemID)
	}

	csvPath := filepath.Join(*outDir, fmt.Sprintf("orders_%s.csv", *tag))
	if werr := writeCSV(csvPath, all); werr != nil {
		die("write csv: %v", werr)
	}

	sum := buildSummary(all)
	sum.CSV = csvPath
	sumBytes, _ := json.MarshalIndent(sum, "", "  ")
	metaPath := filepath.Join(*outDir, fmt.Sprintf("orders_%s.summary.json", *tag))
	if werr := os.WriteFile(metaPath, sumBytes, 0o644); werr != nil {
		die("write summary: %v", werr)
	}

	fmt.Printf("[ok] csv: %s\n", csvPath)
	fmt.Printf("[ok] summary: %s\n", metaPath)
	fmt.Println(string(sumBytes))
}

func writeCSV(path string, rows []row) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	defer w.Flush()

	header := []string{"source", "region_id", "structure_id", "order_id", "type_id", "location_id", "system_id", "is_buy_order", "price", "volume_remain", "min_volume"}
	if err := w.Write(header); err != nil {
		return err
	}
	for _, r := range rows {
		rec := []string{
			r.Source,
			strconv.FormatInt(int64(r.RegionID), 10),
			strconv.FormatInt(r.StructureID, 10),
			strconv.FormatInt(r.OrderID, 10),
			strconv.FormatInt(int64(r.TypeID), 10),
			strconv.FormatInt(r.LocationID, 10),
			strconv.FormatInt(int64(r.SystemID), 10),
			strconv.FormatBool(r.IsBuyOrder),
			strconv.FormatFloat(r.Price, 'f', 6, 64),
			strconv.FormatInt(int64(r.VolumeRemain), 10),
			strconv.FormatInt(int64(r.MinVolume), 10),
		}
		if err := w.Write(rec); err != nil {
			return err
		}
	}
	return nil
}

func buildSummary(rows []row) summary {
	regSet := map[int32]bool{}
	strSet := map[int64]bool{}
	buy := 0
	sell := 0
	for _, r := range rows {
		if r.RegionID > 0 {
			regSet[r.RegionID] = true
		}
		if r.StructureID > 0 {
			strSet[r.StructureID] = true
		}
		if r.IsBuyOrder {
			buy++
		} else {
			sell++
		}
	}
	regions := make([]int32, 0, len(regSet))
	for id := range regSet {
		regions = append(regions, id)
	}
	sort.Slice(regions, func(i, j int) bool { return regions[i] < regions[j] })

	structures := make([]int64, 0, len(strSet))
	for id := range strSet {
		structures = append(structures, id)
	}
	sort.Slice(structures, func(i, j int) bool { return structures[i] < structures[j] })

	return summary{
		Rows:       len(rows),
		BuyOrders:  buy,
		SellOrders: sell,
		Regions:    regions,
		Structures: structures,
	}
}

func parseInt32CSV(raw string) ([]int32, error) {
	parts := splitCSV(raw)
	out := make([]int32, 0, len(parts))
	for _, p := range parts {
		v, err := strconv.ParseInt(p, 10, 32)
		if err != nil {
			return nil, err
		}
		out = append(out, int32(v))
	}
	return out, nil
}

func parseInt64CSV(raw string) ([]int64, error) {
	parts := splitCSV(raw)
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		v, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func splitCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(2)
}
