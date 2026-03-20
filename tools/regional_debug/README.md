# Regional Debug Toolkit (Go)

These commands are for investigation-only and do not modify app behavior.

## 1) Export snapshot to CSV

Exports:
- public region orders via `internal/esi.FetchRegionOrders`
- private structure orders via `internal/esi.FetchStructureOrders` (token required)

```bash
GOCACHE=$PWD/.gocache go run ./cmd/regional-debug-export \
  --region-ids 10000002,10000060 \
  --structure-ids <C_J6MT_KEEPSTAR_STRUCTURE_ID> \
  --access-token "$ESI_ACCESS_TOKEN" \
  --out-dir tmp/regional_debug \
  --tag jita_to_cj6mt
```

Outputs:
- `tmp/regional_debug/orders_<tag>.csv`
- `tmp/regional_debug/orders_<tag>.summary.json`

## 2) Analyze opportunity gap (instant vs sell-order)

Compares two candidate sets from the same snapshot:
- `instant`: source sell -> destination buy (current scanner-style gate)
- `sell_order`: source sell -> destination lowest ask (undercut model)

```bash
GOCACHE=$PWD/.gocache go run ./cmd/regional-debug-analyze \
  --orders-csv tmp/regional_debug/orders_jita_to_cj6mt.csv \
  --source-system-id 30000142 \
  --target-system-id <C_J6MT_SYSTEM_ID> \
  --target-location-id <C_J6MT_KEEPSTAR_STRUCTURE_ID> \
  --buy-broker-fee-pct 0 \
  --sell-broker-fee-pct 0 \
  --sell-sales-tax-pct 8 \
  --undercut-pct 0.1 \
  --min-margin-pct 0 \
  --out-dir tmp/regional_debug \
  --top 200
```

Outputs:
- `tmp/regional_debug/instant_opportunities.csv`
- `tmp/regional_debug/sell_order_opportunities.csv`
- `tmp/regional_debug/sell_order_only_opportunities.csv`
- `tmp/regional_debug/analysis_summary.json`

## How to read results

If `profitable_sell_order_only` is high while `profitable_instant` is low, the destination buy-book gate is likely suppressing sell-order opportunities in private structure markets.
