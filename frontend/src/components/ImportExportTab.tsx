import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addImportExportRouteItem,
  analyzeImportExportRoute,
  createImportExportRoute,
  deleteImportExportRoute,
  deleteImportExportRouteItem,
  getCharacterInfo,
  getImportExportRoutes,
  getStations,
  getStructures,
  searchItems,
  updateImportExportRoute,
} from "@/lib/api";
import type {
  FlipResult,
  ImportExportRoute,
  ImportExportRouteAnalysis,
  ItemSearchResult,
  RegionalTradeMode,
  StationInfo,
} from "@/lib/types";
import { Modal } from "./Modal";
import { RegionAutocomplete } from "./RegionAutocomplete";
import { ScanResultsTable } from "./ScanResultsTable";
import { SystemAutocomplete } from "./SystemAutocomplete";
import {
  SettingsCheckbox,
  SettingsField,
  SettingsGrid,
  SettingsNumberInput,
  SettingsSelect,
  TabSettingsPanel,
} from "./TabSettingsPanel";
import { cn } from "@/lib/utils"

const SKILL_ACCOUNTING = 16622;
const SKILL_BROKER_RELATIONS = 3446;

const SIDEBAR_KEY = "import-export.sidebar.collapsed.v1";

type Props = {
  isLoggedIn: boolean;
};

type GoodsSortMode = "name_asc" | "name_desc" | "category" | "group" | "recent";
type GoodsGroupMode = "none" | "category" | "group";

type RouteFormState = {
  name: string;
  source_region_name: string;
  target_market_system_name: string;
  target_market_location_id: number;
  target_market_location_name: string;
  include_structures: boolean;
  avg_price_period: number;
  purchase_demand_days: number;
  trade_mode: RegionalTradeMode;
  shipping_mode: "per_route" | "per_jump";
  shipping_cost_per_m3_jump: number;
  buy_broker_fee_percent: number;
  buy_sales_tax_percent: number;
  sell_broker_fee_percent: number;
  sell_sales_tax_percent: number;
};

const DEFAULT_FORM: RouteFormState = {
  name: "",
  source_region_name: "",
  target_market_system_name: "Jita",
  target_market_location_id: 0,
  target_market_location_name: "",
  include_structures: false,
  avg_price_period: 14,
  purchase_demand_days: 0.5,
  trade_mode: "instant_instant",
  shipping_mode: "per_route",
  shipping_cost_per_m3_jump: 0,
  buy_broker_fee_percent: 0,
  buy_sales_tax_percent: 0,
  sell_broker_fee_percent: 0,
  sell_sales_tax_percent: 8,
};

function importExportCategoryName(categoryID: number) {
  const categories: Record<number, string> = {
    6: "Ships",
    7: "Modules",
    8: "Charges",
    9: "Blueprints",
    17: "Commodities",
    18: "Drones",
    20: "Implants",
    22: "Deployables",
    23: "Structures",
    25: "Ore",
    32: "Structure Modules",
    43: "PI Commodities",
    87: "Fighters",
  };
  return categories[categoryID] ?? `Category ${categoryID || 0}`;
}

function routeToForm(route: ImportExportRoute): RouteFormState {
  return {
    name: route.name,
    source_region_name: route.source_region_name,
    target_market_system_name: route.target_market_system_name,
    target_market_location_id: route.target_market_location_id,
    target_market_location_name: route.target_market_location_name,
    include_structures: route.include_structures,
    avg_price_period: route.avg_price_period,
    purchase_demand_days: route.purchase_demand_days,
    trade_mode: route.trade_mode,
    shipping_mode: route.shipping_mode,
    shipping_cost_per_m3_jump: route.shipping_cost_per_m3_jump,
    buy_broker_fee_percent: route.buy_broker_fee_percent,
    buy_sales_tax_percent: route.buy_sales_tax_percent,
    sell_broker_fee_percent: route.sell_broker_fee_percent,
    sell_sales_tax_percent: route.sell_sales_tax_percent,
  };
}

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

export function ImportExportTab({ isLoggedIn }: Props) {
  const [routes, setRoutes] = useState<ImportExportRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [routeForm, setRouteForm] = useState<RouteFormState>(DEFAULT_FORM);
  const [analysis, setAnalysis] = useState<ImportExportRouteAnalysis | null>(null);
  const [rows, setRows] = useState<FlipResult[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [mutatingItems, setMutatingItems] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<RouteFormState>(DEFAULT_FORM);
  const [esiMsg, setEsiMsg] = useState<string | null>(null);
  const [esiLoading, setEsiLoading] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ItemSearchResult[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemSearchResult | null>(null);
  const [goodsSort, setGoodsSort] = useState<GoodsSortMode>("name_asc");
  const [goodsGroup, setGoodsGroup] = useState<GoodsGroupMode>("none");
  const [targetStations, setTargetStations] = useState<StationInfo[]>([]);
  const [targetStructures, setTargetStructures] = useState<StationInfo[]>([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [loadingStructures, setLoadingStructures] = useState(false);
  const [targetSystemID, setTargetSystemID] = useState(0);
  const [targetRegionID, setTargetRegionID] = useState(0);
  const [createTargetStations, setCreateTargetStations] = useState<StationInfo[]>([]);
  const [createTargetStructures, setCreateTargetStructures] = useState<StationInfo[]>([]);
  const [createLoadingStations, setCreateLoadingStations] = useState(false);
  const [createLoadingStructures, setCreateLoadingStructures] = useState(false);
  const [createTargetSystemID, setCreateTargetSystemID] = useState(0);
  const [createTargetRegionID, setCreateTargetRegionID] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const esiMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );
  const selectedRouteFormSnapshot = useMemo(
    () => (selectedRoute ? JSON.stringify(routeToForm(selectedRoute)) : ""),
    [selectedRoute],
  );
  const routeFormSnapshot = useMemo(() => JSON.stringify(routeForm), [routeForm]);

  const targetMarketplaceStations = useMemo(() => {
    const merged = routeForm.include_structures && isLoggedIn
      ? [...targetStations, ...targetStructures]
      : [...targetStations];
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [isLoggedIn, routeForm.include_structures, targetStations, targetStructures]);

  const createTargetMarketplaceStations = useMemo(() => {
    const merged = createForm.include_structures && isLoggedIn
      ? [...createTargetStations, ...createTargetStructures]
      : [...createTargetStations];
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [createForm.include_structures, createTargetStations, createTargetStructures, isLoggedIn]);

  const loadRoutes = useCallback(async (preferredRouteId?: number | null) => {
    setLoadingRoutes(true);
    setError("");
    try {
      const nextRoutes = await getImportExportRoutes();
      setRoutes(nextRoutes);
      const nextSelected =
        preferredRouteId ??
        (nextRoutes.some((route) => route.id === selectedRouteId) ? selectedRouteId : nextRoutes[0]?.id ?? null);
      setSelectedRouteId(nextSelected);
      if (nextSelected == null) {
        setRouteForm(DEFAULT_FORM);
        setAnalysis(null);
        setRows([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load routes");
    } finally {
      setLoadingRoutes(false);
    }
  }, [selectedRouteId]);

  const refreshAnalysis = useCallback(async (routeId: number) => {
    setAnalyzing(true);
    setProgress("Refreshing route analysis...");
    setError("");
    try {
      const next = await analyzeImportExportRoute(routeId);
      setAnalysis(next);
      setRows(next.rows ?? []);
      setProgress("");
    } catch (e) {
      setAnalysis(null);
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to analyze route");
      setProgress("");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    void loadRoutes();
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
      if (esiMsgTimerRef.current) clearTimeout(esiMsgTimerRef.current);
    };
  }, [loadRoutes]);

  useEffect(() => {
    if (!selectedRoute) return;
    setRouteForm(routeToForm(selectedRoute));
    setAnalysis(null);
    setRows([]);
    setProgress("");
  }, [selectedRoute]);

  useEffect(() => {
    const targetSystem = routeForm.target_market_system_name.trim();
    if (!targetSystem) {
      setTargetStations([]);
      setTargetStructures([]);
      setTargetSystemID(0);
      setTargetRegionID(0);
      return;
    }

    const controller = new AbortController();
    setLoadingStations(true);
    getStations(targetSystem, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setTargetStations(resp.stations);
        setTargetSystemID(resp.system_id);
        setTargetRegionID(resp.region_id);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTargetStations([]);
        setTargetSystemID(0);
        setTargetRegionID(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingStations(false);
      });

    return () => controller.abort();
  }, [routeForm.target_market_system_name]);

  useEffect(() => {
    if (!routeForm.include_structures || !isLoggedIn || targetSystemID <= 0 || targetRegionID <= 0) {
      setTargetStructures([]);
      setLoadingStructures(false);
      return;
    }
    const controller = new AbortController();
    setLoadingStructures(true);
    getStructures(targetSystemID, targetRegionID, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setTargetStructures(resp);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTargetStructures([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingStructures(false);
      });
    return () => controller.abort();
  }, [isLoggedIn, routeForm.include_structures, targetRegionID, targetSystemID]);

  useEffect(() => {
    const targetSystem = createForm.target_market_system_name.trim();
    if (!targetSystem || !createModalOpen) {
      setCreateTargetStations([]);
      setCreateTargetStructures([]);
      setCreateTargetSystemID(0);
      setCreateTargetRegionID(0);
      return;
    }

    const controller = new AbortController();
    setCreateLoadingStations(true);
    getStations(targetSystem, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setCreateTargetStations(resp.stations);
        setCreateTargetSystemID(resp.system_id);
        setCreateTargetRegionID(resp.region_id);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCreateTargetStations([]);
        setCreateTargetSystemID(0);
        setCreateTargetRegionID(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCreateLoadingStations(false);
      });

    return () => controller.abort();
  }, [createForm.target_market_system_name, createModalOpen]);

  useEffect(() => {
    if (!createModalOpen || !createForm.include_structures || !isLoggedIn || createTargetSystemID <= 0 || createTargetRegionID <= 0) {
      setCreateTargetStructures([]);
      setCreateLoadingStructures(false);
      return;
    }
    const controller = new AbortController();
    setCreateLoadingStructures(true);
    getStructures(createTargetSystemID, createTargetRegionID, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setCreateTargetStructures(resp);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCreateTargetStructures([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCreateLoadingStructures(false);
      });
    return () => controller.abort();
  }, [createForm.include_structures, createModalOpen, createTargetRegionID, createTargetSystemID, isLoggedIn]);

  useEffect(() => {
    const selectedLocationID = routeForm.target_market_location_id ?? 0;
    if (selectedLocationID <= 0) return;
    if (loadingStations || loadingStructures) return;
    if (!targetMarketplaceStations.some((station) => station.id === selectedLocationID)) {
      setRouteForm((prev) => ({ ...prev, target_market_location_id: 0, target_market_location_name: "" }));
    }
  }, [loadingStations, loadingStructures, routeForm.target_market_location_id, targetMarketplaceStations]);

  useEffect(() => {
    const selectedLocationID = createForm.target_market_location_id ?? 0;
    if (selectedLocationID <= 0) return;
    if (createLoadingStations || createLoadingStructures) return;
    if (!createTargetMarketplaceStations.some((station) => station.id === selectedLocationID)) {
      setCreateForm((prev) => ({ ...prev, target_market_location_id: 0, target_market_location_name: "" }));
    }
  }, [
    createForm.target_market_location_id,
    createLoadingStations,
    createLoadingStructures,
    createTargetMarketplaceStations,
  ]);

  const persistSidebar = useCallback((next: boolean) => {
    setSidebarCollapsed(next);
    writeSidebarCollapsed(next);
  }, []);

  const openCreateModal = useCallback(() => {
    setError("");
    setCreateForm(DEFAULT_FORM);
    setCreateModalOpen(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setCreateForm(DEFAULT_FORM);
  }, []);

  const handleCreateRoute = useCallback(async () => {
    setSavingRoute(true);
    setError("");
    try {
      const created = await createImportExportRoute(createForm);
      closeCreateModal();
      await loadRoutes(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create route");
    } finally {
      setSavingRoute(false);
    }
  }, [closeCreateModal, createForm, loadRoutes]);

  useEffect(() => {
    if (!selectedRoute) return;
    if (routeFormSnapshot === selectedRouteFormSnapshot) return;

    const timer = window.setTimeout(async () => {
      setSavingRoute(true);
      setError("");
      try {
        const updated = await updateImportExportRoute(selectedRoute.id, routeForm);
        setRoutes((prev) =>
          prev.map((route) => (route.id === updated.id ? { ...updated, items: route.items } : route)),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save route");
      } finally {
        setSavingRoute(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [routeForm, routeFormSnapshot, selectedRoute, selectedRouteFormSnapshot]);

  const handleFetchEsiSkills = useCallback(async () => {
    setEsiLoading(true);
    setEsiMsg(null);
    try {
      const info = await getCharacterInfo();
      const skills = info.skills?.skills ?? [];
      const accounting = skills.find((s) => s.skill_id === SKILL_ACCOUNTING)?.active_skill_level ?? 0;
      const brokerRel = skills.find((s) => s.skill_id === SKILL_BROKER_RELATIONS)?.active_skill_level ?? 0;
      const salesTax = parseFloat((8 * (1 - 0.11 * accounting)).toFixed(2));
      const brokerFee = parseFloat(Math.max(0, 3 - brokerRel * 0.3).toFixed(2));
      setRouteForm((prev) => ({
        ...prev,
        buy_broker_fee_percent: brokerFee,
        sell_broker_fee_percent: brokerFee,
        sell_sales_tax_percent: salesTax,
      }));
      setEsiMsg(`Accounting L${accounting} -> tax ${salesTax}% | Broker L${brokerRel} -> fee ${brokerFee}%`);
    } catch {
      setEsiMsg("ESI error — check character login");
    } finally {
      setEsiLoading(false);
      if (esiMsgTimerRef.current) clearTimeout(esiMsgTimerRef.current);
      esiMsgTimerRef.current = setTimeout(() => setEsiMsg(null), 6000);
    }
  }, []);

  const runItemSearch = useCallback((query: string) => {
    setItemQuery(query);
    setSelectedItem(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchAbortRef.current?.abort();
    if (query.trim().length < 2) {
      setItemResults([]);
      setItemOpen(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const results = await searchItems(query, 20, controller.signal);
        setItemResults(results);
        setItemOpen(results.length > 0);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setItemResults([]);
        setItemOpen(false);
      }
    }, 200);
  }, []);

  const handleAddItem = useCallback(async () => {
    if (!selectedRoute || !selectedItem) return;
    setMutatingItems(true);
    setError("");
    try {
      await addImportExportRouteItem(selectedRoute.id, {
        type_id: selectedItem.type_id,
        type_name: selectedItem.type_name,
        category_id: selectedItem.category_id,
        group_id: selectedItem.group_id,
        group_name: selectedItem.group_name,
      });
      setItemQuery("");
      setSelectedItem(null);
      setItemResults([]);
      setItemOpen(false);
      await loadRoutes(selectedRoute.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    } finally {
      setMutatingItems(false);
    }
  }, [loadRoutes, selectedItem, selectedRoute]);

  const handleDeleteItem = useCallback(async (itemId: number) => {
    if (!selectedRoute) return;
    setMutatingItems(true);
    setError("");
    try {
      await deleteImportExportRouteItem(selectedRoute.id, itemId);
      await loadRoutes(selectedRoute.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove item");
    } finally {
      setMutatingItems(false);
    }
  }, [loadRoutes, selectedRoute]);

  const routeItems = selectedRoute?.items ?? [];
  const organizedRouteItems = useMemo(() => {
    const items = [...routeItems];
    items.sort((a, b) => {
      switch (goodsSort) {
        case "name_desc":
          return b.type_name.localeCompare(a.type_name);
        case "category": {
          const catOrder = importExportCategoryName(a.category_id).localeCompare(importExportCategoryName(b.category_id));
          return catOrder !== 0 ? catOrder : a.type_name.localeCompare(b.type_name);
        }
        case "group": {
          const groupOrder = (a.group_name || "").localeCompare(b.group_name || "");
          return groupOrder !== 0 ? groupOrder : a.type_name.localeCompare(b.type_name);
        }
        case "recent":
          return (b.added_at || "").localeCompare(a.added_at || "");
        default:
          return a.type_name.localeCompare(b.type_name);
      }
    });
    return items;
  }, [goodsSort, routeItems]);

  const groupedRouteItems = useMemo(() => {
    if (goodsGroup === "none") {
      return [{ key: "all", label: "", items: organizedRouteItems }];
    }
    const groups = new Map<string, typeof organizedRouteItems>();
    for (const item of organizedRouteItems) {
      const label = goodsGroup === "category"
        ? importExportCategoryName(item.category_id)
        : item.group_name || "Ungrouped";
      const existing = groups.get(label) ?? [];
      existing.push(item);
      groups.set(label, existing);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ key: label, label, items }));
  }, [goodsGroup, organizedRouteItems]);

  return (
    <div className="flex-1 min-h-0 min-w-0 flex gap-3 overflow-auto">
      <aside
        className={`${
          sidebarCollapsed ? "w-12" : "w-72 xl:w-80"
        } shrink-0 transition-all duration-200 bg-eve-panel border border-eve-border rounded-sm p-2 flex flex-col min-h-0`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          {!sidebarCollapsed && (
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-eve-dim">Import / Export</div>
              <div className="text-sm text-eve-text">{routes.length} routes</div>
            </div>
          )}
          <div className="flex items-center gap-1">
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={openCreateModal}
                className="px-2 py-1 rounded-sm bg-eve-accent/15 text-eve-accent text-[11px] uppercase tracking-[0.12em] hover:bg-eve-accent/25"
              >
                New
              </button>
            )}
            <div className={cn(sidebarCollapsed ? "flex-col" : "flex-row")}>
              <button
                type="button"
                onClick={() => persistSidebar(!sidebarCollapsed)}
                className="w-8 h-8 rounded-sm border border-eve-border text-eve-dim hover:text-eve-accent hover:border-eve-accent/40"
                title={sidebarCollapsed ? "Expand routes" : "Collapse routes"}
              >
                {sidebarCollapsed ? "»" : "«"}
              </button>
              {sidebarCollapsed && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="w-8 h-8 mt-2 rounded-sm border border-eve-accent/40 text-eve-accent hover:bg-eve-accent/15"
                  title="Create route"
                >
                  +
                </button>
              )}
            </div>
          </div>
        </div>

        {!sidebarCollapsed && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {loadingRoutes && <div className="text-sm text-eve-dim">Loading routes...</div>}
            {!loadingRoutes && routes.map((route) => (
              <div
                key={route.id}
                className={`rounded-sm border px-3 py-2 transition-colors ${
                  route.id === selectedRouteId
                    ? "border-eve-accent bg-eve-accent/10"
                    : "border-eve-border bg-eve-panel/40 hover:bg-eve-panel-hover"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRouteId(route.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-sm text-eve-text font-medium truncate">{route.name}</div>
                    <div className="mt-1 text-[11px] text-eve-dim">
                      {route.source_region_name} {"->"} {route.target_market_system_name}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-eve-dim">
                      {route.items.length} tracked goods
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setSavingRoute(true);
                      setError("");
                      try {
                        await deleteImportExportRoute(route.id);
                        await loadRoutes(route.id === selectedRouteId ? null : selectedRouteId);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Failed to delete route");
                      } finally {
                        setSavingRoute(false);
                      }
                    }}
                    className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-eve-error hover:text-eve-error/80"
                    title="Delete route"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!loadingRoutes && routes.length === 0 && (
              <div className="text-sm text-eve-dim border border-dashed border-eve-border rounded-sm px-3 py-4">
                No routes yet.
              </div>
            )}
          </div>
        )}
      </aside>

      <section className="flex-1 min-h-0 min-w-0 flex flex-col gap-3 overflow-auto">
        {!selectedRoute && (
          <div className="flex-1 min-h-0 bg-eve-panel border border-eve-border rounded-sm flex items-center justify-center text-eve-dim">
            No routes created yet
          </div>
        )}

        {selectedRoute && (
          <>
            <div className="flex items-center justify-between gap-3 bg-eve-panel border border-eve-border rounded-sm px-3 py-2">
              <div>
                <div className="text-sm text-eve-text font-medium">{selectedRoute.name}</div>
                <div className="text-[11px] text-eve-dim">
                  {routeForm.source_region_name} {"->"} {routeForm.target_market_system_name}
                  {routeForm.target_market_location_name ? ` / ${routeForm.target_market_location_name}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshAnalysis(selectedRoute.id)}
                  disabled={analyzing || savingRoute}
                  className="px-3 py-1.5 rounded-sm border border-eve-border text-xs uppercase tracking-[0.12em] hover:bg-eve-panel-hover disabled:opacity-50"
                >
                  Scan
                </button>
              </div>
            </div>

            <TabSettingsPanel
              title="Route Config"
              hint="Saved per route"
              icon=""
              defaultExpanded
              persistKey="import-export-route-config"
            >
              <SettingsGrid cols={4}>
                <SettingsField label="Route Name">
                  <input
                    value={routeForm.name}
                    onChange={(e) => setRouteForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                  />
                </SettingsField>
                <SettingsField label="Source Region">
                  <RegionAutocomplete
                    value={routeForm.source_region_name}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, source_region_name: value }))}
                    placeholder="The Forge"
                  />
                </SettingsField>
                <SettingsField label="Target Marketplace System">
                  <SystemAutocomplete
                    value={routeForm.target_market_system_name}
                    onChange={(value) =>
                      setRouteForm((prev) => ({
                        ...prev,
                        target_market_system_name: value,
                        target_market_location_id: 0,
                        target_market_location_name: "",
                      }))
                    }
                    showLocationButton={false}
                    isLoggedIn={isLoggedIn}
                    includeStructures={routeForm.include_structures}
                    onIncludeStructuresChange={(value) =>
                      setRouteForm((prev) => ({
                        ...prev,
                        include_structures: value,
                        target_market_location_id: 0,
                        target_market_location_name: "",
                      }))
                    }
                  />
                </SettingsField>
                <SettingsField label="Target Marketplace Station">
                  <select
                    value={String(routeForm.target_market_location_id || 0)}
                    onChange={(e) => {
                      const nextId = Number(e.target.value) || 0;
                      const station = targetMarketplaceStations.find((entry) => entry.id === nextId);
                      setRouteForm((prev) => ({
                        ...prev,
                        target_market_location_id: nextId,
                        target_market_location_name: station?.name ?? "",
                      }));
                    }}
                    className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                  >
                    <option value="0">
                      {loadingStations || loadingStructures ? "Loading..." : "Any station in target system"}
                    </option>
                    {targetMarketplaceStations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </SettingsField>
                <SettingsField label="Period (days)">
                  <SettingsNumberInput
                    value={routeForm.avg_price_period}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, avg_price_period: value }))}
                    min={1}
                    max={90}
                    step={1}
                  />
                </SettingsField>
                <SettingsField label="Purchase Demand Days">
                  <SettingsNumberInput
                    value={routeForm.purchase_demand_days}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, purchase_demand_days: value }))}
                    min={0.01}
                    max={30}
                    step={0.1}
                  />
                </SettingsField>
                <SettingsField label="Shipping Mode">
                  <SettingsSelect
                    value={routeForm.shipping_mode}
                    onChange={(value) =>
                      setRouteForm((prev) => ({
                        ...prev,
                        shipping_mode: value as "per_route" | "per_jump",
                      }))
                    }
                    options={[
                      { value: "per_route", label: "ISK / m3 (total route)" },
                      { value: "per_jump", label: "ISK / m3 / jump" },
                    ]}
                  />
                </SettingsField>
                <SettingsField
                  label={
                    routeForm.shipping_mode === "per_jump"
                      ? "Shipping ISK / m3 / jump"
                      : "Shipping ISK / m3"
                  }
                >
                  <SettingsNumberInput
                    value={routeForm.shipping_cost_per_m3_jump}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, shipping_cost_per_m3_jump: value }))}
                    min={0}
                    max={1000000}
                    step={0.01}
                  />
                </SettingsField>
                <SettingsField label="Trade Mode">
                  <SettingsSelect
                    value={routeForm.trade_mode}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, trade_mode: value as RegionalTradeMode }))}
                    options={[
                      { value: "instant_instant", label: "Instant -> Instant" },
                      { value: "instant_sell_order", label: "Instant -> Sell Order" },
                      { value: "buy_order_sell_order", label: "Buy Order -> Sell Order" },
                    ]}
                  />
                </SettingsField>
                <SettingsField label="Include Structures">
                  <SettingsCheckbox
                    checked={routeForm.include_structures}
                    onChange={(value) =>
                      setRouteForm((prev) => ({
                        ...prev,
                        include_structures: value,
                        target_market_location_id: 0,
                        target_market_location_name: "",
                      }))
                    }
                  />
                </SettingsField>
                <SettingsField label="Buy Broker %">
                  <SettingsNumberInput
                    value={routeForm.buy_broker_fee_percent}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, buy_broker_fee_percent: value }))}
                    min={0}
                    max={10}
                    step={0.1}
                  />
                </SettingsField>
                <SettingsField label="Buy Tax %">
                  <SettingsNumberInput
                    value={routeForm.buy_sales_tax_percent}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, buy_sales_tax_percent: value }))}
                    min={0}
                    max={10}
                    step={0.1}
                  />
                </SettingsField>
                <SettingsField label="Sell Broker %">
                  <SettingsNumberInput
                    value={routeForm.sell_broker_fee_percent}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, sell_broker_fee_percent: value }))}
                    min={0}
                    max={10}
                    step={0.1}
                  />
                </SettingsField>
                <SettingsField label="Sell Tax %">
                  <SettingsNumberInput
                    value={routeForm.sell_sales_tax_percent}
                    onChange={(value) => setRouteForm((prev) => ({ ...prev, sell_sales_tax_percent: value }))}
                    min={0}
                    max={10}
                    step={0.1}
                  />
                </SettingsField>
              </SettingsGrid>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!isLoggedIn || esiLoading}
                  onClick={handleFetchEsiSkills}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] border border-eve-accent/40 text-eve-accent bg-eve-accent/10 hover:bg-eve-accent/20 disabled:opacity-40"
                >
                  {esiLoading ? "Loading..." : "Fetch from ESI"}
                </button>
                <span className="text-[10px] text-eve-dim">Accounting + Broker Relations skills</span>
              </div>
              {esiMsg && <div className="mt-2 text-[11px] font-mono text-eve-dim">{esiMsg}</div>}
            </TabSettingsPanel>

            <TabSettingsPanel
              title="Tracked Goods"
              hint="Add and remove SKUs for this route"
              icon=""
              defaultExpanded
              persistKey="import-export-tracked-goods"
              headerExtra={
                <div className="flex items-center gap-2">
                  <select
                    value={goodsSort}
                    onChange={(e) => setGoodsSort(e.target.value as GoodsSortMode)}
                    className="px-2 py-1 bg-eve-input border border-eve-border rounded-sm text-[11px] text-eve-text"
                  >
                    <option value="name_asc">Name A-Z</option>
                    <option value="name_desc">Name Z-A</option>
                    <option value="category">Sort by Category</option>
                    <option value="group">Sort by Group</option>
                    <option value="recent">Newest First</option>
                  </select>
                  <select
                    value={goodsGroup}
                    onChange={(e) => setGoodsGroup(e.target.value as GoodsGroupMode)}
                    className="px-2 py-1 bg-eve-input border border-eve-border rounded-sm text-[11px] text-eve-text"
                  >
                    <option value="none">No Grouping</option>
                    <option value="category">Group by Category</option>
                    <option value="group">Group by Group</option>
                  </select>
                </div>
              }
            >
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                <div className="relative">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim mb-1">Search Item</div>
                  <input
                    value={itemQuery}
                    onChange={(e) => runItemSearch(e.target.value)}
                    onFocus={() => itemResults.length > 0 && setItemOpen(true)}
                    placeholder="Search any market item"
                    className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                  />
                  {itemOpen && itemResults.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-eve-panel border border-eve-border rounded-sm shadow-eve-glow max-h-64 overflow-y-auto">
                      {itemResults.map((item) => (
                        <button
                          key={item.type_id}
                          type="button"
                          onClick={() => {
                            setSelectedItem(item);
                            setItemQuery(item.type_name);
                            setItemOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-eve-panel-hover"
                        >
                          <div className="text-sm text-eve-text">{item.type_name}</div>
                          <div className="text-[11px] text-eve-dim">Vol {item.volume.toFixed(2)} m3</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleAddItem}
                  disabled={!selectedItem || mutatingItems}
                  className="px-3 py-1.5 rounded-sm bg-eve-accent/15 text-eve-accent text-xs uppercase tracking-[0.12em] disabled:opacity-40"
                >
                  Add tracked good
                </button>
              </div>

              <div className="mt-3 space-y-2 max-h-64 overflow-auto pr-1">
                {routeItems.length === 0 && (
                  <div className="text-sm text-eve-dim border border-dashed border-eve-border rounded-sm p-3">
                    No tracked goods added for this route yet.
                  </div>
                )}
                {groupedRouteItems.map((group) => (
                  <div key={group.key} className="space-y-2">
                    {group.label && (
                      <div className="px-1 text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                        {group.label}
                      </div>
                    )}
                    {group.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 border border-eve-border rounded-sm px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-eve-text truncate">{item.type_name}</div>
                          <div className="text-[11px] text-eve-dim truncate">
                            {importExportCategoryName(item.category_id)}
                            {item.group_name ? ` / ${item.group_name}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id)}
                          className="text-[11px] uppercase tracking-[0.12em] text-eve-error hover:text-eve-error/80"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </TabSettingsPanel>

            <div className="flex-1 min-h-0">
              {error && (
                <div className="mb-2 rounded-sm border border-eve-error/40 bg-eve-error/10 px-3 py-2 text-sm text-eve-error">
                  {error}
                </div>
              )}
              {routeItems.length === 0 && !analyzing ? (
                <div className="h-full bg-eve-panel border border-eve-border rounded-sm flex items-center justify-center text-eve-dim">
                  Add tracked goods to see route analysis results.
                </div>
              ) : (
                <div className="h-full bg-eve-panel border border-eve-border rounded-sm overflow-hidden">
                  <div className="px-3 py-2 border-b border-eve-border/60 text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                    Route jumps: <span className="text-eve-accent">{analysis?.route_jumps ?? 0}</span>
                    {" · "}
                    Period: <span className="text-eve-accent">{analysis?.period_days ?? routeForm.avg_price_period}d</span>
                    {" · "}
                    Tracked rows: <span className="text-eve-accent">{rows.length}</span>
                  </div>
                  <div className="h-[calc(100%-33px)] overflow-auto">
                    <ScanResultsTable
                      results={rows}
                      scanning={analyzing}
                      progress={progress}
                      tradeStateTab="region"
                      salesTaxPercent={routeForm.sell_sales_tax_percent}
                      brokerFeePercent={routeForm.sell_broker_fee_percent}
                      splitTradeFees
                      buyBrokerFeePercent={routeForm.buy_broker_fee_percent}
                      sellBrokerFeePercent={routeForm.sell_broker_fee_percent}
                      buySalesTaxPercent={routeForm.buy_sales_tax_percent}
                      sellSalesTaxPercent={routeForm.sell_sales_tax_percent}
                      showRegions
                      columnProfile="region_eveguru"
                      isLoggedIn={isLoggedIn}
                      cargoLimit={1_000_000_000}
                      detailScenariosByType={analysis?.scenarios_by_type}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <Modal open={createModalOpen} onClose={closeCreateModal} title="Create Import / Export Route" width="max-w-lg">
        <div className="p-4 space-y-4 overflow-auto max-h-[70vh]">
          {error && (
            <div className="rounded-sm border border-eve-error/40 bg-eve-error/10 px-3 py-2 text-sm text-eve-error">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-eve-dim">Route Name</span>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text"
                placeholder="Delve -> Jita"
              />
            </label>
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-eve-dim">Source</span>
              <RegionAutocomplete
                value={createForm.source_region_name}
                onChange={(value) => setCreateForm((prev) => ({ ...prev, source_region_name: value }))}
                placeholder="Source region"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-eve-dim">Destination</span>
              <SystemAutocomplete
                value={createForm.target_market_system_name}
                onChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    target_market_system_name: value,
                    target_market_location_id: 0,
                    target_market_location_name: "",
                  }))
                }
                showLocationButton={false}
                isLoggedIn={isLoggedIn}
                includeStructures={createForm.include_structures}
                onIncludeStructuresChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    include_structures: value,
                    target_market_location_id: 0,
                    target_market_location_name: "",
                  }))
                }
              />
            </div>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-eve-dim">Target Station / Structure</span>
              <select
                value={String(createForm.target_market_location_id || 0)}
                onChange={(e) => {
                  const nextId = Number(e.target.value) || 0;
                  const station = createTargetMarketplaceStations.find((entry) => entry.id === nextId);
                  setCreateForm((prev) => ({
                    ...prev,
                    target_market_location_id: nextId,
                    target_market_location_name: station?.name ?? "",
                  }));
                }}
                className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text"
              >
                <option value="0">
                  {createLoadingStations || createLoadingStructures
                    ? "Loading..."
                    : "Any station / structure in target system"}
                </option>
                {createTargetMarketplaceStations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreateRoute}
              disabled={
                savingRoute ||
                createLoadingStations ||
                createLoadingStructures ||
                !createForm.name.trim() ||
                !createForm.source_region_name.trim() ||
                !createForm.target_market_system_name.trim()
              }
              className="px-4 py-2 rounded-sm bg-eve-accent text-eve-dark text-xs uppercase tracking-[0.12em] disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
