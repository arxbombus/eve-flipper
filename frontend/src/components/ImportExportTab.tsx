import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment } from "react";
import {
  addImportExportRouteItem,
  analyzeImportExportRoute,
  createImportExportTransitEntry,
  createImportExportWarehouse,
  createImportExportRoute,
  deleteImportExportTransitEntry,
  deleteImportExportWarehouse,
  deleteImportExportRoute,
  deleteImportExportRouteItem,
  getCharacterInfo,
  getImportExportRoutes,
  getImportExportRestockingOverview,
  getImportExportTransitEntries,
  getImportExportWarehouses,
  getStations,
  getStructures,
  searchItems,
  updateImportExportRouteItem,
  updateImportExportRoute,
} from "@/lib/api";
import type {
  FlipResult,
  ImportExportRoute,
  ImportExportRouteAnalysis,
  ImportExportRouteItem,
  ImportExportRestockingOverview,
  ImportExportTransitItem,
  ImportExportTransitEntry,
  ImportExportWarehouse,
  ItemSearchResult,
  RegionalTradeMode,
  StationInfo,
} from "@/lib/types";
import { Modal } from "./Modal";
import { RegionAutocomplete } from "./RegionAutocomplete";
import { ImportExportResultsTable } from "./ImportExportResultsTable";
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
type ImportExportSubtab = "routes" | "restocking";

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

type WarehouseFormState = {
  name: string;
  system_name: string;
  system_id: number;
  region_id: number;
  location_id: number;
  location_name: string;
  is_structure: boolean;
  include_structures: boolean;
};

type TransitEndpointState = {
  system_name: string;
  system_id: number;
  region_id: number;
  location_id: number;
  location_name: string;
  is_structure: boolean;
  include_structures: boolean;
};

type TransitDraftMode = "search" | "clipboard";

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

const DEFAULT_WAREHOUSE_FORM: WarehouseFormState = {
  name: "",
  system_name: "",
  system_id: 0,
  region_id: 0,
  location_id: 0,
  location_name: "",
  is_structure: false,
  include_structures: false,
};

const DEFAULT_TRANSIT_ENDPOINT: TransitEndpointState = {
  system_name: "",
  system_id: 0,
  region_id: 0,
  location_id: 0,
  location_name: "",
  is_structure: false,
  include_structures: false,
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

function formatDemandDays(value: number | null | undefined) {
  if (value == null) return "-";
  return `${value}d`;
}

function parseDemandDaysDraft(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return "invalid";
  return parsed;
}

function formatTransitClipboardInput(raw: string) {
  return raw.replace(/\r/g, " ").replace(/\n/g, " ").trim();
}

function parseTransitClipboard(raw: string) {
  const normalized = formatTransitClipboardInput(raw);
  const matches = Array.from(normalized.matchAll(/(.+?)\s*x\s*([\d,]+)(?=[^\d]|$)/gi));
  return matches
    .map((match) => ({
      type_name: match[1]?.trim() ?? "",
      quantity: Number((match[2] ?? "").replace(/,/g, "")),
    }))
    .filter((entry) => entry.type_name.length > 0 && Number.isFinite(entry.quantity) && entry.quantity > 0);
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
  const [routeModalMode, setRouteModalMode] = useState<"create" | "edit">("create");
  const [createForm, setCreateForm] = useState<RouteFormState>(DEFAULT_FORM);
  const [esiMsg, setEsiMsg] = useState<string | null>(null);
  const [esiLoading, setEsiLoading] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ItemSearchResult[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemSearchResult | null>(null);
  const [goodsSort, setGoodsSort] = useState<GoodsSortMode>("name_asc");
  const [goodsGroup, setGoodsGroup] = useState<GoodsGroupMode>("none");
  const [activeSubtab, setActiveSubtab] = useState<ImportExportSubtab>("routes");
  const [restockingOverview, setRestockingOverview] = useState<ImportExportRestockingOverview | null>(null);
  const [restockingStale, setRestockingStale] = useState(false);
  const [warehouses, setWarehouses] = useState<ImportExportWarehouse[]>([]);
  const [transitEntries, setTransitEntries] = useState<ImportExportTransitEntry[]>([]);
  const [warehouseForm, setWarehouseForm] = useState<WarehouseFormState>(DEFAULT_WAREHOUSE_FORM);
  const [warehouseStations, setWarehouseStations] = useState<StationInfo[]>([]);
  const [warehouseStructures, setWarehouseStructures] = useState<StationInfo[]>([]);
  const [loadingWarehouseStations, setLoadingWarehouseStations] = useState(false);
  const [loadingWarehouseStructures, setLoadingWarehouseStructures] = useState(false);
  const [savingWarehouse, setSavingWarehouse] = useState(false);
  const [savingTransit, setSavingTransit] = useState(false);
  const [allDemandDaysDraft, setAllDemandDaysDraft] = useState("");
  const [groupDemandDaysDrafts, setGroupDemandDaysDrafts] = useState<Record<string, string>>({});
  const [itemDemandDaysDrafts, setItemDemandDaysDrafts] = useState<Record<number, string>>({});
  const [transitFrom, setTransitFrom] = useState<TransitEndpointState>(DEFAULT_TRANSIT_ENDPOINT);
  const [transitTo, setTransitTo] = useState<TransitEndpointState>(DEFAULT_TRANSIT_ENDPOINT);
  const [transitFromStations, setTransitFromStations] = useState<StationInfo[]>([]);
  const [transitFromStructures, setTransitFromStructures] = useState<StationInfo[]>([]);
  const [transitToStations, setTransitToStations] = useState<StationInfo[]>([]);
  const [transitToStructures, setTransitToStructures] = useState<StationInfo[]>([]);
  const [loadingTransitFromStations, setLoadingTransitFromStations] = useState(false);
  const [loadingTransitFromStructures, setLoadingTransitFromStructures] = useState(false);
  const [loadingTransitToStations, setLoadingTransitToStations] = useState(false);
  const [loadingTransitToStructures, setLoadingTransitToStructures] = useState(false);
  const [transitDraftMode, setTransitDraftMode] = useState<TransitDraftMode>("search");
  const [transitItemQuantity, setTransitItemQuantity] = useState(1);
  const [transitClipboardText, setTransitClipboardText] = useState("");
  const [transitDraftItems, setTransitDraftItems] = useState<ImportExportTransitItem[]>([]);
  const [transitItemQuery, setTransitItemQuery] = useState("");
  const [transitItemResults, setTransitItemResults] = useState<ItemSearchResult[]>([]);
  const [transitItemOpen, setTransitItemOpen] = useState(false);
  const [selectedTransitItem, setSelectedTransitItem] = useState<ItemSearchResult | null>(null);
  const [expandedWarehouseIds, setExpandedWarehouseIds] = useState<number[]>([]);
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

  const warehouseLocations = useMemo(() => {
    const merged = warehouseForm.include_structures && isLoggedIn
      ? [...warehouseStations, ...warehouseStructures]
      : [...warehouseStations];
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [isLoggedIn, warehouseForm.include_structures, warehouseStations, warehouseStructures]);

  const transitFromLocations = useMemo(() => {
    const merged = transitFrom.include_structures && isLoggedIn
      ? [...transitFromStations, ...transitFromStructures]
      : [...transitFromStations];
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [isLoggedIn, transitFrom.include_structures, transitFromStations, transitFromStructures]);

  const transitToLocations = useMemo(() => {
    const merged = transitTo.include_structures && isLoggedIn
      ? [...transitToStations, ...transitToStructures]
      : [...transitToStations];
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [isLoggedIn, transitTo.include_structures, transitToStations, transitToStructures]);

  const allTrackedItems = useMemo(() => {
    const itemsByType = new Map<number, ImportExportRouteItem>();
    for (const route of routes) {
      for (const item of route.items) {
        if (!itemsByType.has(item.type_id)) {
          itemsByType.set(item.type_id, item);
        }
      }
    }
    return Array.from(itemsByType.values()).sort((a, b) => a.type_name.localeCompare(b.type_name));
  }, [routes]);

  const displayedWarehouses = useMemo(
    () => restockingOverview?.warehouses ?? warehouses.map((warehouse) => ({ ...warehouse, items: [] })),
    [restockingOverview, warehouses],
  );

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

  const loadRestocking = useCallback(async () => {
    try {
      const [nextOverview, nextWarehouses, nextTransit] = await Promise.all([
        getImportExportRestockingOverview(),
        getImportExportWarehouses(),
        getImportExportTransitEntries(),
      ]);
      setRestockingOverview(nextOverview);
      setRestockingStale(false);
      setWarehouses(nextWarehouses);
      setTransitEntries(nextTransit);
      setExpandedWarehouseIds((prev) => prev.filter((id) => nextWarehouses.some((warehouse) => warehouse.id === id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load restocking data");
    }
  }, []);

  const markRestockingStale = useCallback(() => {
    setRestockingOverview(null);
    setRestockingStale(true);
  }, []);

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
    void loadRestocking();
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
      if (esiMsgTimerRef.current) clearTimeout(esiMsgTimerRef.current);
    };
  }, [loadRestocking, loadRoutes]);

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
    const targetSystem = warehouseForm.system_name.trim();
    if (!targetSystem) {
      setWarehouseStations([]);
      setWarehouseStructures([]);
      setWarehouseForm((prev) => ({ ...prev, system_id: 0, region_id: 0, location_id: 0, location_name: "", is_structure: false }));
      return;
    }

    const controller = new AbortController();
    setLoadingWarehouseStations(true);
    getStations(targetSystem, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setWarehouseStations(resp.stations);
        setWarehouseForm((prev) => ({ ...prev, system_id: resp.system_id, region_id: resp.region_id }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setWarehouseStations([]);
        setWarehouseForm((prev) => ({ ...prev, system_id: 0, region_id: 0 }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingWarehouseStations(false);
      });
    return () => controller.abort();
  }, [warehouseForm.system_name]);

  useEffect(() => {
    if (!warehouseForm.include_structures || !isLoggedIn || warehouseForm.system_id <= 0 || warehouseForm.region_id <= 0) {
      setWarehouseStructures([]);
      return;
    }
    const controller = new AbortController();
    setLoadingWarehouseStructures(true);
    getStructures(warehouseForm.system_id, warehouseForm.region_id, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setWarehouseStructures(resp);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWarehouseStructures([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingWarehouseStructures(false);
      });
    return () => controller.abort();
  }, [isLoggedIn, warehouseForm.include_structures, warehouseForm.region_id, warehouseForm.system_id]);

  useEffect(() => {
    const targetSystem = transitFrom.system_name.trim();
    if (!targetSystem) {
      setTransitFromStations([]);
      setTransitFromStructures([]);
      setTransitFrom((prev) => ({ ...prev, system_id: 0, region_id: 0, location_id: 0, location_name: "", is_structure: false }));
      return;
    }

    const controller = new AbortController();
    setLoadingTransitFromStations(true);
    getStations(targetSystem, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setTransitFromStations(resp.stations);
        setTransitFrom((prev) => ({ ...prev, system_id: resp.system_id, region_id: resp.region_id }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTransitFromStations([]);
        setTransitFrom((prev) => ({ ...prev, system_id: 0, region_id: 0 }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTransitFromStations(false);
      });
    return () => controller.abort();
  }, [transitFrom.system_name]);

  useEffect(() => {
    if (!transitFrom.include_structures || !isLoggedIn || transitFrom.system_id <= 0 || transitFrom.region_id <= 0) {
      setTransitFromStructures([]);
      return;
    }
    const controller = new AbortController();
    setLoadingTransitFromStructures(true);
    getStructures(transitFrom.system_id, transitFrom.region_id, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setTransitFromStructures(resp);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTransitFromStructures([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTransitFromStructures(false);
      });
    return () => controller.abort();
  }, [isLoggedIn, transitFrom.include_structures, transitFrom.region_id, transitFrom.system_id]);

  useEffect(() => {
    const targetSystem = transitTo.system_name.trim();
    if (!targetSystem) {
      setTransitToStations([]);
      setTransitToStructures([]);
      setTransitTo((prev) => ({ ...prev, system_id: 0, region_id: 0, location_id: 0, location_name: "", is_structure: false }));
      return;
    }

    const controller = new AbortController();
    setLoadingTransitToStations(true);
    getStations(targetSystem, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setTransitToStations(resp.stations);
        setTransitTo((prev) => ({ ...prev, system_id: resp.system_id, region_id: resp.region_id }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTransitToStations([]);
        setTransitTo((prev) => ({ ...prev, system_id: 0, region_id: 0 }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTransitToStations(false);
      });
    return () => controller.abort();
  }, [transitTo.system_name]);

  useEffect(() => {
    if (!transitTo.include_structures || !isLoggedIn || transitTo.system_id <= 0 || transitTo.region_id <= 0) {
      setTransitToStructures([]);
      return;
    }
    const controller = new AbortController();
    setLoadingTransitToStructures(true);
    getStructures(transitTo.system_id, transitTo.region_id, controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return;
        setTransitToStructures(resp);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTransitToStructures([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTransitToStructures(false);
      });
    return () => controller.abort();
  }, [isLoggedIn, transitTo.include_structures, transitTo.region_id, transitTo.system_id]);

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
    setRouteModalMode("create");
    setCreateForm(DEFAULT_FORM);
    setCreateModalOpen(true);
  }, []);

  const openEditModal = useCallback(() => {
    if (!selectedRoute) return;
    setError("");
    setRouteModalMode("edit");
    setCreateForm(routeToForm(selectedRoute));
    setCreateModalOpen(true);
  }, [selectedRoute]);

  const closeCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setRouteModalMode("create");
    setCreateForm(DEFAULT_FORM);
  }, []);

  const handleSubmitRoute = useCallback(async () => {
    setSavingRoute(true);
    setError("");
    try {
      if (routeModalMode === "edit" && selectedRoute) {
        const updated = await updateImportExportRoute(selectedRoute.id, createForm);
        setRoutes((prev) =>
          prev.map((route) => (route.id === updated.id ? { ...updated, items: route.items } : route)),
        );
        setSelectedRouteId(updated.id);
        setRouteForm(routeToForm(updated));
        closeCreateModal();
        return;
      }
      const created = await createImportExportRoute(createForm);
      closeCreateModal();
      await loadRoutes(created.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : routeModalMode === "edit"
            ? "Failed to update route"
            : "Failed to create route",
      );
    } finally {
      setSavingRoute(false);
    }
  }, [closeCreateModal, createForm, loadRoutes, routeModalMode, selectedRoute]);

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

  const runTransitItemSearch = useCallback((query: string) => {
    setTransitItemQuery(query);
    setSelectedTransitItem(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchAbortRef.current?.abort();
    if (query.trim().length < 2) {
      setTransitItemResults([]);
      setTransitItemOpen(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const results = await searchItems(query, 20, controller.signal);
        setTransitItemResults(results);
        setTransitItemOpen(results.length > 0);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setTransitItemResults([]);
        setTransitItemOpen(false);
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

  const persistCustomDemandDays = useCallback(async (items: ImportExportRouteItem[], nextValue: number | null) => {
    if (!selectedRoute || items.length === 0) return;
    setMutatingItems(true);
    setError("");
    try {
      await Promise.all(
        items.map((item) => updateImportExportRouteItem(selectedRoute.id, item.id, {
          custom_purchase_demand_days: nextValue,
        })),
      );
      await loadRoutes(selectedRoute.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update tracked goods");
    } finally {
      setMutatingItems(false);
    }
  }, [loadRoutes, selectedRoute]);

  const handleSubmitDemandDaysDraft = useCallback(async (
    items: ImportExportRouteItem[],
    rawValue: string,
    onReset: (value: string) => void,
  ) => {
    const parsed = parseDemandDaysDraft(rawValue);
    if (parsed === "invalid") {
      setError("Purchase demand days must be a positive number or blank.");
      onReset(items.length === 1 && items[0]?.custom_purchase_demand_days != null ? String(items[0].custom_purchase_demand_days) : "");
      return;
    }
    await persistCustomDemandDays(items, parsed);
  }, [persistCustomDemandDays]);

  const handleCreateWarehouse = useCallback(async () => {
    if (warehouseForm.system_id <= 0 || warehouseForm.location_id <= 0 || !warehouseForm.location_name.trim()) {
      setError("Choose a warehouse system and location.");
      return;
    }
    setSavingWarehouse(true);
    setError("");
    try {
      const created = await createImportExportWarehouse({
        name: warehouseForm.name.trim() || warehouseForm.location_name,
        system_id: warehouseForm.system_id,
        system_name: warehouseForm.system_name.trim(),
        location_id: warehouseForm.location_id,
        location_name: warehouseForm.location_name.trim(),
        is_structure: warehouseForm.is_structure,
      });
      setWarehouses((prev) => [created, ...prev.filter((warehouse) => warehouse.id !== created.id)]);
      setWarehouseForm(DEFAULT_WAREHOUSE_FORM);
      setWarehouseStations([]);
      setWarehouseStructures([]);
      markRestockingStale();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create warehouse");
    } finally {
      setSavingWarehouse(false);
    }
  }, [markRestockingStale, warehouseForm]);

  const handleDeleteWarehouse = useCallback(async (warehouseId: number) => {
    setSavingWarehouse(true);
    setError("");
    try {
      await deleteImportExportWarehouse(warehouseId);
      setWarehouses((prev) => prev.filter((warehouse) => warehouse.id !== warehouseId));
      markRestockingStale();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete warehouse");
    } finally {
      setSavingWarehouse(false);
    }
  }, [markRestockingStale]);

  const handleAddTransitDraftItem = useCallback(() => {
    if (!selectedTransitItem) {
      setError("Choose an item to add to the delivery contract.");
      return;
    }
    if (transitItemQuantity <= 0) {
      setError("Transit quantity must be positive.");
      return;
    }
    setTransitDraftItems((prev) => {
      const existing = prev.find((item) => item.type_id === selectedTransitItem.type_id);
      if (existing) {
        return prev.map((item) => item.type_id === selectedTransitItem.type_id
          ? { ...item, quantity: item.quantity + transitItemQuantity }
          : item);
      }
      return [...prev, {
        type_id: selectedTransitItem.type_id,
        type_name: selectedTransitItem.type_name,
        quantity: transitItemQuantity,
      }];
    });
    setTransitItemQuery("");
    setTransitItemResults([]);
    setTransitItemOpen(false);
    setSelectedTransitItem(null);
    setTransitItemQuantity(1);
  }, [selectedTransitItem, transitItemQuantity]);

  const handleImportTransitClipboard = useCallback(() => {
    const parsed = parseTransitClipboard(transitClipboardText);
    if (parsed.length === 0) {
      setError("Clipboard mode could not parse any item lines.");
      return;
    }
    const trackedByName = new Map(allTrackedItems.map((item) => [item.type_name.toLowerCase(), item]));
    const unresolved: string[] = [];
    const nextItems = new Map<number, ImportExportTransitItem>();
    for (const entry of parsed) {
      const matched = trackedByName.get(entry.type_name.toLowerCase());
      if (!matched) {
        unresolved.push(entry.type_name);
        continue;
      }
      const existing = nextItems.get(matched.type_id);
      nextItems.set(matched.type_id, {
        type_id: matched.type_id,
        type_name: matched.type_name,
        quantity: (existing?.quantity ?? 0) + entry.quantity,
      });
    }
    if (unresolved.length > 0) {
      setError(`Could not match tracked items: ${unresolved.join(", ")}`);
      return;
    }
    setTransitDraftItems((prev) => {
      const merged = new Map(prev.map((item) => [item.type_id, item]));
      for (const item of nextItems.values()) {
        const existing = merged.get(item.type_id);
        merged.set(item.type_id, {
          ...item,
          quantity: (existing?.quantity ?? 0) + item.quantity,
        });
      }
      return Array.from(merged.values()).sort((a, b) => a.type_name.localeCompare(b.type_name));
    });
    setTransitClipboardText("");
  }, [allTrackedItems, transitClipboardText]);

  const handleCreateTransitEntry = useCallback(async () => {
    if (transitFrom.system_id <= 0 || transitFrom.location_id <= 0 || !transitFrom.location_name.trim()) {
      setError("Choose a source system and station/structure.");
      return;
    }
    if (transitTo.system_id <= 0 || transitTo.location_id <= 0 || !transitTo.location_name.trim()) {
      setError("Choose a destination system and station/structure.");
      return;
    }
    if (transitDraftItems.length === 0) {
      setError("Add at least one item to the delivery contract.");
      return;
    }
    setSavingTransit(true);
    setError("");
    try {
      const created = await createImportExportTransitEntry({
        from_system_id: transitFrom.system_id,
        from_system_name: transitFrom.system_name.trim(),
        from_location_id: transitFrom.location_id,
        from_location_name: transitFrom.location_name.trim(),
        to_system_id: transitTo.system_id,
        to_system_name: transitTo.system_name.trim(),
        to_location_id: transitTo.location_id,
        to_location_name: transitTo.location_name.trim(),
        items: transitDraftItems.map((item) => ({
          type_id: item.type_id,
          type_name: item.type_name,
          quantity: item.quantity,
        })),
      });
      setTransitEntries((prev) => [created, ...prev.filter((entry) => entry.id !== created.id)]);
      setTransitFrom(DEFAULT_TRANSIT_ENDPOINT);
      setTransitTo(DEFAULT_TRANSIT_ENDPOINT);
      setTransitFromStations([]);
      setTransitFromStructures([]);
      setTransitToStations([]);
      setTransitToStructures([]);
      setTransitDraftItems([]);
      setTransitClipboardText("");
      setTransitItemQuery("");
      setTransitItemResults([]);
      setTransitItemOpen(false);
      setSelectedTransitItem(null);
      setTransitItemQuantity(1);
      markRestockingStale();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create transit entry");
    } finally {
      setSavingTransit(false);
    }
  }, [markRestockingStale, transitDraftItems, transitFrom, transitTo]);

  const handleDeleteTransitEntry = useCallback(async (entryId: number) => {
    setSavingTransit(true);
    setError("");
    try {
      await deleteImportExportTransitEntry(entryId);
      setTransitEntries((prev) => prev.filter((entry) => entry.id !== entryId));
      markRestockingStale();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete transit entry");
    } finally {
      setSavingTransit(false);
    }
  }, [markRestockingStale]);

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

  useEffect(() => {
    setAllDemandDaysDraft("");
    setItemDemandDaysDrafts(
      Object.fromEntries(routeItems.map((item) => [item.id, item.custom_purchase_demand_days == null ? "" : String(item.custom_purchase_demand_days)])),
    );
  }, [routeItems]);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (const group of groupedRouteItems) {
      if (!group.label) continue;
      const values = [...new Set(group.items.map((item) => item.custom_purchase_demand_days == null ? "" : String(item.custom_purchase_demand_days)))];
      drafts[group.key] = values.length === 1 ? values[0] : "";
    }
    setGroupDemandDaysDrafts(drafts);
  }, [groupedRouteItems]);

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-3 overflow-auto pr-1">
      <div className="flex items-center gap-2 bg-eve-panel border border-eve-border rounded-sm px-2 py-2">
        <button
          type="button"
          onClick={() => setActiveSubtab("routes")}
          className={cn(
            "px-3 py-1.5 rounded-sm text-xs uppercase tracking-[0.12em] border",
            activeSubtab === "routes"
              ? "border-eve-accent bg-eve-accent/15 text-eve-accent"
              : "border-eve-border text-eve-dim hover:text-eve-text hover:bg-eve-panel-hover",
          )}
        >
          Routes & Profitability
        </button>
        <button
          type="button"
          onClick={() => setActiveSubtab("restocking")}
          className={cn(
            "px-3 py-1.5 rounded-sm text-xs uppercase tracking-[0.12em] border",
            activeSubtab === "restocking"
              ? "border-eve-accent bg-eve-accent/15 text-eve-accent"
              : "border-eve-border text-eve-dim hover:text-eve-text hover:bg-eve-panel-hover",
          )}
        >
          Restocking
        </button>
      </div>

      <div className="flex-1 min-h-0 min-w-0 flex gap-3">
      {activeSubtab === "routes" && (
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
      )}

      <section className="flex-1 min-h-0 min-w-0 flex flex-col gap-3 overflow-visible">
        {activeSubtab === "routes" && !selectedRoute && (
          <div className="min-h-[16rem] bg-eve-panel border border-eve-border rounded-sm flex items-center justify-center text-eve-dim">
            No routes created yet
          </div>
        )}

        {(selectedRoute || activeSubtab === "restocking") && (
          <>
            {activeSubtab === "routes" && (
            <div className="flex items-center justify-between gap-3 bg-eve-panel border border-eve-border rounded-sm px-3 py-2">
              <div>
                <div className="text-sm text-eve-text font-medium">{selectedRoute!.name}</div>
                <div className="text-[11px] text-eve-dim">
                  {routeForm.source_region_name} {"->"} {routeForm.target_market_system_name}
                  {routeForm.target_market_location_name ? ` / ${routeForm.target_market_location_name}` : ""}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-eve-dim">
                  Route jumps: <span className="text-eve-accent">{analysis?.route_jumps ?? 0}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openEditModal}
                  disabled={analyzing || savingRoute}
                  className="px-3 py-1.5 rounded-sm border border-eve-border text-xs uppercase tracking-[0.12em] hover:bg-eve-panel-hover disabled:opacity-50"
                >
                  Edit Route
                </button>
                <button
                  type="button"
                  onClick={() => void refreshAnalysis(selectedRoute!.id)}
                  disabled={analyzing || savingRoute}
                  className="px-3 py-1.5 rounded-sm border border-eve-border text-xs uppercase tracking-[0.12em] hover:bg-eve-panel-hover disabled:opacity-50"
                >
                  Scan
                </button>
              </div>
            </div>
            )}

            {activeSubtab === "routes" ? (
              <>
            <TabSettingsPanel
              title="Route Config"
              hint="Saved per route"
              icon=""
              defaultExpanded
              persistKey="import-export-route-config"
            >
              <SettingsGrid cols={4}>
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
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                    <span>All DoD</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={allDemandDaysDraft}
                      placeholder="-"
                      onChange={(e) => setAllDemandDaysDraft(e.target.value)}
                      onBlur={() => void handleSubmitDemandDaysDraft(routeItems, allDemandDaysDraft, setAllDemandDaysDraft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSubmitDemandDaysDraft(routeItems, allDemandDaysDraft, setAllDemandDaysDraft);
                        }
                      }}
                      className="w-20 px-2 py-1 bg-eve-input border border-eve-border rounded-sm text-[11px] text-eve-text"
                    />
                  </label>
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
                      <div className="px-1 flex items-center justify-between gap-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                          {group.label}
                        </div>
                        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                          <span>Group DoD</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={groupDemandDaysDrafts[group.key] ?? ""}
                            placeholder="-"
                            onChange={(e) => setGroupDemandDaysDrafts((prev) => ({ ...prev, [group.key]: e.target.value }))}
                            onBlur={() => void handleSubmitDemandDaysDraft(
                              group.items,
                              groupDemandDaysDrafts[group.key] ?? "",
                              (value) => setGroupDemandDaysDrafts((prev) => ({ ...prev, [group.key]: value })),
                            )}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleSubmitDemandDaysDraft(
                                  group.items,
                                  groupDemandDaysDrafts[group.key] ?? "",
                                  (value) => setGroupDemandDaysDrafts((prev) => ({ ...prev, [group.key]: value })),
                                );
                              }
                            }}
                            className="w-20 px-2 py-1 bg-eve-input border border-eve-border rounded-sm text-[11px] text-eve-text"
                          />
                        </label>
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
                          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-eve-dim">
                            Custom DoD: <span className="text-eve-accent">{formatDemandDays(item.custom_purchase_demand_days)}</span>
                            {item.custom_purchase_demand_days == null ? ` · Route default ${formatDemandDays(routeForm.purchase_demand_days)}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                            <span>Custom DoD</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={itemDemandDaysDrafts[item.id] ?? ""}
                              placeholder="-"
                              onChange={(e) => setItemDemandDaysDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              onBlur={() => void handleSubmitDemandDaysDraft(
                                [item],
                                itemDemandDaysDrafts[item.id] ?? "",
                                (value) => setItemDemandDaysDrafts((prev) => ({ ...prev, [item.id]: value })),
                              )}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleSubmitDemandDaysDraft(
                                    [item],
                                    itemDemandDaysDrafts[item.id] ?? "",
                                    (value) => setItemDemandDaysDrafts((prev) => ({ ...prev, [item.id]: value })),
                                  );
                                }
                              }}
                              className="w-20 px-2 py-1 bg-eve-input border border-eve-border rounded-sm text-[11px] text-eve-text"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(item.id)}
                            className="text-[11px] uppercase tracking-[0.12em] text-eve-error hover:text-eve-error/80"
                          >
                            Remove
                          </button>
                        </div>
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
                <div className="min-h-[24rem] bg-eve-panel border border-eve-border rounded-sm flex items-center justify-center text-eve-dim">
                  Add tracked goods to see route analysis results.
                </div>
              ) : (
                <div className="bg-eve-panel border border-eve-border rounded-sm min-h-[24rem]">
                  <div className="px-3 py-2 border-b border-eve-border/60 text-[11px] uppercase tracking-[0.12em] text-eve-dim">
                    Route jumps: <span className="text-eve-accent">{analysis?.route_jumps ?? 0}</span>
                    {" · "}
                    Period: <span className="text-eve-accent">{analysis?.period_days ?? routeForm.avg_price_period}d</span>
                    {" · "}
                    Tracked rows: <span className="text-eve-accent">{rows.length}</span>
                  </div>
                  <div className="overflow-x-auto overflow-y-visible">
                    <ImportExportResultsTable
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
                      showRegions={false}
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
            ) : (
              <div className="space-y-3 overflow-auto pr-1">
                <div className="flex items-center justify-between gap-3 rounded-sm border border-eve-border bg-eve-panel px-3 py-2">
                  <div className="text-sm text-eve-dim">
                    {restockingStale
                      ? "Restocking cache is stale. Refresh to rebuild warehouse, order, transit, and target stock aggregates."
                      : "Restocking aggregates combine route targets, warehouses, transit contracts, and current orders."}
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadRestocking()}
                    disabled={savingWarehouse || savingTransit}
                    className="px-3 py-1.5 rounded-sm border border-eve-border text-xs uppercase tracking-[0.12em] hover:bg-eve-panel-hover disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
                  <div className="rounded-sm border border-eve-border bg-eve-panel px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">Routes</div>
                    <div className="mt-1 text-xl text-eve-text">{routes.length}</div>
                  </div>
                  <div className="rounded-sm border border-eve-border bg-eve-panel px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">Tracked Items</div>
                    <div className="mt-1 text-xl text-eve-text">{allTrackedItems.length}</div>
                  </div>
                  <div className="rounded-sm border border-eve-border bg-eve-panel px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">Warehouses</div>
                    <div className="mt-1 text-xl text-eve-text">{warehouses.length}</div>
                  </div>
                  <div className="rounded-sm border border-eve-border bg-eve-panel px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">Transit Units</div>
                    <div className="mt-1 text-xl text-eve-text">{transitEntries.reduce((sum, entry) => sum + entry.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)}</div>
                  </div>
                </div>

                <TabSettingsPanel
                  title="Warehouses"
                  hint="Tracked storage locations"
                  icon=""
                  defaultExpanded
                  persistKey="import-export-restocking-warehouses"
                >
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
                    <SettingsField label="System">
                      <SystemAutocomplete
                        value={warehouseForm.system_name}
                        onChange={(value) => setWarehouseForm((prev) => ({
                          ...prev,
                          system_name: value,
                          location_id: 0,
                          location_name: "",
                          is_structure: false,
                        }))}
                        showLocationButton={false}
                        isLoggedIn={isLoggedIn}
                        includeStructures={warehouseForm.include_structures}
                        onIncludeStructuresChange={(value) => setWarehouseForm((prev) => ({
                          ...prev,
                          include_structures: value,
                          location_id: 0,
                          location_name: "",
                          is_structure: false,
                        }))}
                      />
                    </SettingsField>
                    <SettingsField label="Station / Structure">
                      <select
                        value={String(warehouseForm.location_id || 0)}
                        onChange={(e) => {
                          const nextId = Number(e.target.value) || 0;
                          const location = warehouseLocations.find((entry) => entry.id === nextId);
                          setWarehouseForm((prev) => ({
                            ...prev,
                            location_id: nextId,
                            location_name: location?.name ?? "",
                            name: location?.name ?? prev.name,
                            is_structure: Boolean(location?.is_structure),
                          }));
                        }}
                        className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                      >
                        <option value="0">
                          {loadingWarehouseStations || loadingWarehouseStructures ? "Loading..." : "Select warehouse location"}
                        </option>
                        {warehouseLocations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </SettingsField>
                    <button
                      type="button"
                      onClick={() => void handleCreateWarehouse()}
                      disabled={savingWarehouse}
                      className="px-3 py-1.5 rounded-sm bg-eve-accent/15 text-eve-accent text-xs uppercase tracking-[0.12em] disabled:opacity-40"
                    >
                      Add Warehouse
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {warehouses.length === 0 && (
                      <div className="text-sm text-eve-dim border border-dashed border-eve-border rounded-sm p-3">
                        No warehouses added yet.
                      </div>
                    )}
                    {displayedWarehouses.map((warehouse) => {
                      const expanded = expandedWarehouseIds.includes(warehouse.id);
                      return (
                        <div key={warehouse.id} className="border border-eve-border rounded-sm bg-eve-panel/40">
                          <div className="flex items-center justify-between gap-3 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setExpandedWarehouseIds((prev) => expanded ? prev.filter((id) => id !== warehouse.id) : [...prev, warehouse.id])}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="text-sm text-eve-text">{warehouse.name}</div>
                              <div className="text-[11px] text-eve-dim">
                                {warehouse.system_name} / {warehouse.location_name}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteWarehouse(warehouse.id)}
                              className="text-[11px] uppercase tracking-[0.12em] text-eve-error hover:text-eve-error/80"
                            >
                              Remove
                            </button>
                          </div>
                          {expanded && (
                            <div className="border-t border-eve-border/60 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim mb-2">
                                Tracked Goods Snapshot
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                {(warehouse.items ?? []).slice(0, 12).map((item) => (
                                  <div key={`${warehouse.id}-${item.type_id}`} className="rounded-sm border border-eve-border px-2 py-2">
                                    <div className="text-sm text-eve-text truncate">{item.type_name}</div>
                                    <div className="text-[11px] text-eve-dim">
                                      {item.quantity.toLocaleString()} units
                                      {item.has_stock ? " in stock" : " tracked"}
                                    </div>
                                  </div>
                                ))}
                                {(!warehouse.items || warehouse.items.length === 0) && (
                                  <div className="text-sm text-eve-dim">No tracked goods available yet.</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </TabSettingsPanel>

                <TabSettingsPanel
                  title="Transit"
                  hint="Delivery contracts"
                  icon=""
                  defaultExpanded
                  persistKey="import-export-restocking-transit"
                >
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <div className="space-y-3">
                      <SettingsGrid cols={2}>
                        <SettingsField label="From System">
                          <SystemAutocomplete
                            value={transitFrom.system_name}
                            onChange={(value) => setTransitFrom((prev) => ({
                              ...prev,
                              system_name: value,
                              location_id: 0,
                              location_name: "",
                              is_structure: false,
                            }))}
                            showLocationButton={false}
                            isLoggedIn={isLoggedIn}
                            includeStructures={transitFrom.include_structures}
                            onIncludeStructuresChange={(value) => setTransitFrom((prev) => ({
                              ...prev,
                              include_structures: value,
                              location_id: 0,
                              location_name: "",
                              is_structure: false,
                            }))}
                          />
                        </SettingsField>
                        <SettingsField label="From Station / Structure">
                          <select
                            value={String(transitFrom.location_id || 0)}
                            onChange={(e) => {
                              const nextId = Number(e.target.value) || 0;
                              const location = transitFromLocations.find((entry) => entry.id === nextId);
                              setTransitFrom((prev) => ({
                                ...prev,
                                location_id: nextId,
                                location_name: location?.name ?? "",
                                is_structure: Boolean(location?.is_structure),
                              }));
                            }}
                            className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                          >
                            <option value="0">
                              {loadingTransitFromStations || loadingTransitFromStructures ? "Loading..." : "Select source location"}
                            </option>
                            {transitFromLocations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name}
                              </option>
                            ))}
                          </select>
                        </SettingsField>
                        <SettingsField label="To System">
                          <SystemAutocomplete
                            value={transitTo.system_name}
                            onChange={(value) => setTransitTo((prev) => ({
                              ...prev,
                              system_name: value,
                              location_id: 0,
                              location_name: "",
                              is_structure: false,
                            }))}
                            showLocationButton={false}
                            isLoggedIn={isLoggedIn}
                            includeStructures={transitTo.include_structures}
                            onIncludeStructuresChange={(value) => setTransitTo((prev) => ({
                              ...prev,
                              include_structures: value,
                              location_id: 0,
                              location_name: "",
                              is_structure: false,
                            }))}
                          />
                        </SettingsField>
                        <SettingsField label="To Station / Structure">
                          <select
                            value={String(transitTo.location_id || 0)}
                            onChange={(e) => {
                              const nextId = Number(e.target.value) || 0;
                              const location = transitToLocations.find((entry) => entry.id === nextId);
                              setTransitTo((prev) => ({
                                ...prev,
                                location_id: nextId,
                                location_name: location?.name ?? "",
                                is_structure: Boolean(location?.is_structure),
                              }));
                            }}
                            className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                          >
                            <option value="0">
                              {loadingTransitToStations || loadingTransitToStructures ? "Loading..." : "Select destination location"}
                            </option>
                            {transitToLocations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name}
                              </option>
                            ))}
                          </select>
                        </SettingsField>
                      </SettingsGrid>

                      <div className="rounded-sm border border-eve-border/70 bg-eve-panel/30 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">Add Items</div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setTransitDraftMode("search")}
                              className={cn(
                                "px-2 py-1 rounded-sm text-[11px] uppercase tracking-[0.12em] border",
                                transitDraftMode === "search"
                                  ? "border-eve-accent bg-eve-accent/15 text-eve-accent"
                                  : "border-eve-border text-eve-dim",
                              )}
                            >
                              Search
                            </button>
                            <button
                              type="button"
                              onClick={() => setTransitDraftMode("clipboard")}
                              className={cn(
                                "px-2 py-1 rounded-sm text-[11px] uppercase tracking-[0.12em] border",
                                transitDraftMode === "clipboard"
                                  ? "border-eve-accent bg-eve-accent/15 text-eve-accent"
                                  : "border-eve-border text-eve-dim",
                              )}
                            >
                              Clipboard
                            </button>
                          </div>
                        </div>

                        {transitDraftMode === "search" ? (
                          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_120px_auto] gap-3 items-end">
                            <div className="relative">
                              <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim mb-1">Transit Item</div>
                              <input
                                value={transitItemQuery}
                                onChange={(e) => runTransitItemSearch(e.target.value)}
                                onFocus={() => transitItemResults.length > 0 && setTransitItemOpen(true)}
                                placeholder="Search tracked or market item"
                                className="w-full px-3 py-1.5 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                              />
                              {transitItemOpen && transitItemResults.length > 0 && (
                                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-eve-panel border border-eve-border rounded-sm shadow-eve-glow max-h-64 overflow-y-auto">
                                  {transitItemResults.map((item) => (
                                    <button
                                      key={item.type_id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedTransitItem(item);
                                        setTransitItemQuery(item.type_name);
                                        setTransitItemOpen(false);
                                      }}
                                      className="w-full text-left px-3 py-2 hover:bg-eve-panel-hover"
                                    >
                                      <div className="text-sm text-eve-text">{item.type_name}</div>
                                      <div className="text-[11px] text-eve-dim">{item.group_name || "Ungrouped"}</div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <SettingsField label="Quantity">
                              <SettingsNumberInput
                                value={transitItemQuantity}
                                onChange={setTransitItemQuantity}
                                min={1}
                                max={1000000000}
                                step={1}
                              />
                            </SettingsField>
                            <button
                              type="button"
                              onClick={handleAddTransitDraftItem}
                              disabled={!selectedTransitItem || savingTransit}
                              className="px-3 py-1.5 rounded-sm bg-eve-accent/15 text-eve-accent text-xs uppercase tracking-[0.12em] disabled:opacity-40"
                            >
                              Add Item
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-[11px] text-eve-dim">
                              Paste item lines like: <span className="text-eve-text">Astero x 2Nocxium x 100000Magnate x 200</span>
                            </div>
                            <textarea
                              value={transitClipboardText}
                              onChange={(e) => setTransitClipboardText(e.target.value)}
                              rows={5}
                              className="w-full px-3 py-2 bg-eve-input border border-eve-border rounded-sm text-eve-text text-sm"
                            />
                            <button
                              type="button"
                              onClick={handleImportTransitClipboard}
                              disabled={!transitClipboardText.trim()}
                              className="px-3 py-1.5 rounded-sm bg-eve-accent/15 text-eve-accent text-xs uppercase tracking-[0.12em] disabled:opacity-40"
                            >
                              Parse Clipboard
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim">Draft Contract Items</div>
                        {transitDraftItems.length === 0 ? (
                          <div className="text-sm text-eve-dim border border-dashed border-eve-border rounded-sm p-3">
                            No items added to this delivery contract yet.
                          </div>
                        ) : (
                          transitDraftItems.map((item) => (
                            <div key={item.type_id} className="flex items-center justify-between gap-3 border border-eve-border rounded-sm px-3 py-2 bg-eve-panel/40">
                              <div>
                                <div className="text-sm text-eve-text">{item.type_name}</div>
                                <div className="text-[11px] text-eve-dim">{item.quantity.toLocaleString()} units</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setTransitDraftItems((prev) => prev.filter((entry) => entry.type_id !== item.type_id))}
                                className="text-[11px] uppercase tracking-[0.12em] text-eve-error hover:text-eve-error/80"
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleCreateTransitEntry()}
                        disabled={savingTransit}
                        className="px-3 py-1.5 rounded-sm bg-eve-accent/15 text-eve-accent text-xs uppercase tracking-[0.12em] disabled:opacity-40"
                      >
                        Create Delivery Contract
                      </button>
                    </div>

                    <div className="space-y-2">
                      {transitEntries.length === 0 && (
                        <div className="text-sm text-eve-dim border border-dashed border-eve-border rounded-sm p-3">
                          No delivery contracts recorded yet.
                        </div>
                      )}
                      {(restockingOverview?.transit ?? transitEntries).map((entry) => (
                        <div key={entry.id} className="border border-eve-border rounded-sm px-3 py-2 bg-eve-panel/40">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] text-eve-dim">
                                {entry.from_system_name} / {entry.from_location_name}
                              </div>
                              <div className="text-[11px] text-eve-dim">
                                {entry.to_system_name} / {entry.to_location_name}
                              </div>
                              <div className="mt-2 space-y-1">
                                {(entry.items ?? []).map((item) => (
                                  <div key={`${entry.id}-${item.type_id}`} className="text-sm text-eve-text">
                                    {item.type_name} <span className="text-eve-dim">x {item.quantity.toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => void handleDeleteTransitEntry(entry.id)}
                                className="text-[11px] uppercase tracking-[0.12em] text-eve-error hover:text-eve-error/80"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabSettingsPanel>

                <TabSettingsPanel
                  title="Orders"
                  hint="Tracked goods across characters"
                  icon=""
                  defaultExpanded
                  persistKey="import-export-restocking-orders"
                >
                  <div className="space-y-2 max-h-80 overflow-auto pr-1">
                    {restockingStale && !restockingOverview && (
                      <div className="text-sm text-eve-warning border border-dashed border-eve-warning/40 rounded-sm p-3">
                        Order aggregation is stale. Click Refresh to rebuild the restocking view.
                      </div>
                    )}
                    {(restockingOverview?.orders ?? []).length === 0 && (
                      <div className="text-sm text-eve-dim border border-dashed border-eve-border rounded-sm p-3">
                        No tracked-item orders found.
                      </div>
                    )}
                    {(restockingOverview?.orders ?? []).map((order) => (
                      <div key={`${order.character_id}-${order.order_id}`} className="border border-eve-border rounded-sm px-3 py-2 bg-eve-panel/40">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm text-eve-text">{order.type_name}</div>
                            <div className="text-[11px] text-eve-dim">
                              {order.is_buy_order ? "Buy" : "Sell"} · {order.volume_remain.toLocaleString()} / {order.volume_total.toLocaleString()} @ {order.price.toLocaleString()}
                            </div>
                            <div className="text-[11px] text-eve-dim">
                              {order.character_name} · {order.location_name || `#${order.location_id}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabSettingsPanel>

                <TabSettingsPanel
                  title="Restock Table"
                  hint="Aggregated stock posture"
                  icon=""
                  defaultExpanded
                  persistKey="import-export-restocking-table"
                >
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-[0.12em] text-eve-dim border-b border-eve-border/60">
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Target</th>
                          <th className="px-3 py-2 text-right">Warehouse</th>
                          <th className="px-3 py-2 text-right">Transit</th>
                          <th className="px-3 py-2 text-right">Buy</th>
                          <th className="px-3 py-2 text-right">Sell</th>
                          <th className="px-3 py-2 text-right">Net</th>
                          <th className="px-3 py-2 text-right">Move</th>
                          <th className="px-3 py-2 text-right">Buy</th>
                          <th className="px-3 py-2 text-right">Restock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {restockingStale && !restockingOverview && (
                          <tr>
                            <td colSpan={10} className="px-3 py-4 text-sm text-eve-warning">
                              Restocking data is stale. Click Refresh to rebuild warehouse, order, transit, and target stock totals.
                            </td>
                          </tr>
                        )}
                        {(restockingOverview?.items ?? []).map((item) => (
                          <Fragment key={item.type_id}>
                            <tr key={item.type_id} className="border-b border-eve-border/40">
                              <td className="px-3 py-2">
                                <div className="text-eve-text">{item.type_name}</div>
                                <div className="text-[11px] text-eve-dim">
                                  {item.route_refs} routes · {item.aggregated_demand_per_day.toFixed(1)} demand/day · {item.effective_demand_days_average.toFixed(2)} DoD
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">{item.target_stock.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{item.warehouse_stock.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{item.transit_stock.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{item.buy_order_qty.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{item.sell_order_qty.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{item.net_available.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-eve-accent">{item.suggested_move_qty.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-eve-accent">{item.suggested_buy_qty.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-eve-accent">{item.restock_needed.toLocaleString()}</td>
                            </tr>
                            {item.route_breakdowns.length > 0 && (
                              <tr className="border-b border-eve-border/40 bg-eve-panel/30">
                                <td colSpan={10} className="px-3 py-3">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-eve-dim mb-2">Route Allocation</div>
                                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                    {item.route_breakdowns.map((route) => (
                                      <div key={`${item.type_id}-${route.route_id}`} className="rounded-sm border border-eve-border px-2 py-2">
                                        <div className="text-sm text-eve-text">
                                          {route.route_name}
                                          {route.target_location_name ? ` / ${route.target_location_name}` : ` / ${route.target_system_name}`}
                                        </div>
                                        <div className="text-[11px] text-eve-dim">
                                          Target {route.target_stock.toLocaleString()} · Demand {route.demand_per_day.toFixed(1)}/day · {route.effective_demand_days.toFixed(2)} DoD
                                        </div>
                                        <div className="text-[11px] text-eve-dim">
                                          Destination stock {route.destination_stock.toLocaleString()} · Sell orders {route.destination_sell_qty.toLocaleString()}
                                        </div>
                                        <div className="text-[11px] text-eve-accent">
                                          Route deficit {route.route_deficit.toLocaleString()} · Move {route.suggested_haul_qty.toLocaleString()} · Buy {route.suggested_buy_qty.toLocaleString()}
                                        </div>
                                        {route.transfer_suggestions.length > 0 && (
                                          <div className="mt-1 text-[11px] text-eve-dim">
                                            {route.transfer_suggestions.map((suggestion) => (
                                              <div key={`${route.route_id}-${suggestion.warehouse_id}`}>
                                                Pull {suggestion.quantity.toLocaleString()} from {suggestion.warehouse_name} ({suggestion.location_name})
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                        {(restockingOverview?.items ?? []).length === 0 && (
                          <tr>
                            <td colSpan={10} className="px-3 py-4 text-sm text-eve-dim">
                              No aggregated restocking rows yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabSettingsPanel>
              </div>
            )}
          </>
        )}
      </section>

      </div>

      <Modal
        open={createModalOpen}
        onClose={closeCreateModal}
        title={routeModalMode === "edit" ? "Edit Import / Export Route" : "Create Import / Export Route"}
        width="max-w-lg"
      >
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
              onClick={handleSubmitRoute}
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
              {routeModalMode === "edit" ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
