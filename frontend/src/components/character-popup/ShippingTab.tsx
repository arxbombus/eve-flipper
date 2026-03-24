import { useEffect, useMemo, useState } from "react";
import { createPortfolioShippingRule, deletePortfolioShippingRule, getPortfolioShippingRules, getStations, getStructures, updatePortfolioShippingRule } from "../../lib/api";
import { type TranslationKey } from "../../lib/i18n";
import type { PortfolioShippingRule, StationInfo } from "../../lib/types";
import { SystemAutocomplete } from "../SystemAutocomplete";

interface ShippingTabProps {
  isLoggedIn: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

interface RuleFormState {
  system_name: string;
  system_id: number;
  location_id: number;
  location_name: string;
  cost_per_m3: number;
}

const EMPTY_FORM: RuleFormState = {
  system_name: "",
  system_id: 0,
  location_id: 0,
  location_name: "",
  cost_per_m3: 0,
};

export function ShippingTab({ isLoggedIn, t }: ShippingTabProps) {
  const [rules, setRules] = useState<PortfolioShippingRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [stations, setStations] = useState<StationInfo[]>([]);
  const [structures, setStructures] = useState<StationInfo[]>([]);
  const [includeStructures, setIncludeStructures] = useState(false);
  const [regionId, setRegionId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [structuresLoading, setStructuresLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getPortfolioShippingRules()
      .then((data) => {
        setRules(data);
        if (data.length > 0) {
          setSelectedRuleId((prev) => prev ?? data[0].id);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );

  useEffect(() => {
    if (!selectedRule) return;
    setForm({
      system_name: selectedRule.system_name,
      system_id: selectedRule.system_id,
      location_id: selectedRule.location_id,
      location_name: selectedRule.location_name,
      cost_per_m3: selectedRule.cost_per_m3,
    });
    setIncludeStructures(Boolean(selectedRule.location_id >= 10_000_000_000));
  }, [selectedRule]);

  useEffect(() => {
    const systemName = form.system_name.trim();
    if (!systemName) {
      setStations([]);
      setStructures([]);
      setRegionId(0);
      return;
    }
    let cancelled = false;
    setStationsLoading(true);
    getStations(systemName)
      .then((resp) => {
        if (cancelled) return;
        setStations(resp.stations ?? []);
        setRegionId(resp.region_id ?? 0);
        if (resp.system_id > 0 && (form.system_id === 0 || form.system_name !== systemName)) {
          setForm((prev) => ({
            ...prev,
            system_name: systemName,
            system_id: resp.system_id,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setStations([]);
        if (!cancelled) setStructures([]);
        if (!cancelled) setRegionId(0);
      })
      .finally(() => {
        if (!cancelled) setStationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.system_name]);

  useEffect(() => {
    if (!includeStructures || !isLoggedIn || form.system_id <= 0 || regionId <= 0) {
      setStructures([]);
      setStructuresLoading(false);
      return;
    }
    let cancelled = false;
    setStructuresLoading(true);
    getStructures(form.system_id, regionId)
      .then((resp) => {
        if (cancelled) return;
        setStructures(resp ?? []);
      })
      .catch(() => {
        if (!cancelled) setStructures([]);
      })
      .finally(() => {
        if (!cancelled) setStructuresLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.system_id, includeStructures, isLoggedIn, regionId]);

  const locationOptions = useMemo(
    () => (includeStructures && isLoggedIn ? [...stations, ...structures] : stations),
    [includeStructures, isLoggedIn, stations, structures],
  );

  const resetToNew = () => {
    setSelectedRuleId(null);
    setError(null);
    setForm(EMPTY_FORM);
    setStations([]);
    setStructures([]);
    setIncludeStructures(false);
    setRegionId(0);
  };

  const handleSave = async () => {
    if (form.system_id <= 0 || form.location_id <= 0) {
      setError(t("charShippingSelectLocation"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        system_id: form.system_id,
        system_name: form.system_name.trim(),
        location_id: form.location_id,
        location_name: form.location_name.trim(),
        cost_per_m3: Math.max(0, form.cost_per_m3 || 0),
      };
      let saved: PortfolioShippingRule;
      if (selectedRuleId != null) {
        saved = await updatePortfolioShippingRule(selectedRuleId, payload);
        setRules((prev) => prev.map((rule) => (rule.id === saved.id ? saved : rule)));
      } else {
        saved = await createPortfolioShippingRule(payload);
        setRules((prev) => [saved, ...prev]);
        setSelectedRuleId(saved.id);
      }
    } catch (e: any) {
      setError(e?.message || t("charShippingSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (selectedRuleId == null) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePortfolioShippingRule(selectedRuleId);
      setRules((prev) => {
        const next = prev.filter((rule) => rule.id !== selectedRuleId);
        if (next.length > 0) {
          setSelectedRuleId(next[0].id);
        } else {
          resetToNew();
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message || t("charShippingDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="rounded-sm border border-eve-border bg-eve-panel/70">
        <div className="flex items-center justify-between border-b border-eve-border px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-eve-dim">
            {t("charShippingRules")} ({rules.length})
          </div>
          <button
            type="button"
            onClick={resetToNew}
            className="rounded-sm border border-eve-border bg-eve-dark/80 px-2 py-1 text-[10px] text-eve-dim transition-colors hover:border-eve-accent/50 hover:text-eve-accent"
          >
            {t("charShippingNewRule")}
          </button>
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {loading ? (
            <div className="px-3 py-4 text-xs text-eve-dim">{t("loading")}...</div>
          ) : rules.length === 0 ? (
            <div className="px-3 py-4 text-xs text-eve-dim">{t("charShippingNoRules")}</div>
          ) : (
            rules.map((rule) => {
              const active = rule.id === selectedRuleId;
              return (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => setSelectedRuleId(rule.id)}
                  className={`flex w-full flex-col gap-1 border-b border-eve-border/40 px-3 py-3 text-left transition-colors ${
                    active
                      ? "bg-eve-accent/10 text-eve-text"
                      : "bg-transparent text-eve-dim hover:bg-eve-panel/70 hover:text-eve-text"
                  }`}
                >
                  <span className="truncate text-xs font-medium">{rule.location_name}</span>
                  <span className="truncate text-[10px] uppercase tracking-wider text-eve-dim">{rule.system_name}</span>
                  <span className="text-[11px] text-eve-accent">
                    {rule.cost_per_m3.toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK/m3
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-sm border border-eve-border bg-eve-panel/70 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-eve-dim">{t("charShippingEditor")}</div>
            <div className="mt-1 text-[11px] text-eve-dim">{t("charShippingHint")}</div>
          </div>
          <div className="flex gap-2">
            {selectedRuleId != null && (
              <button
                type="button"
                onClick={() => { void handleDelete(); }}
                disabled={deleting || saving}
                className="rounded-sm border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] text-red-300 transition-colors hover:border-red-400 hover:text-red-200 disabled:opacity-50"
              >
                {deleting ? `${t("loading")}...` : t("charShippingDeleteRule")}
              </button>
            )}
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saving}
              className="rounded-sm border border-eve-accent/50 bg-eve-accent/15 px-2.5 py-1 text-[10px] text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-accent/20 disabled:opacity-50"
            >
              {saving ? `${t("loading")}...` : selectedRuleId != null ? t("charShippingUpdateRule") : t("charShippingCreateRule")}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-eve-dim">{t("charShippingSystem")}</span>
            <SystemAutocomplete
              value={form.system_name}
              onChange={(value) => {
                setForm((prev) => ({
                  ...prev,
                  system_name: value,
                  system_id: 0,
                  location_id: 0,
                  location_name: "",
                }));
                setRegionId(0);
                setStructures([]);
              }}
              showLocationButton={false}
              isLoggedIn={isLoggedIn}
              includeStructures={includeStructures}
              onIncludeStructuresChange={(value) => {
                setIncludeStructures(value);
                setForm((prev) => ({
                  ...prev,
                  location_id: 0,
                  location_name: "",
                }));
              }}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-eve-dim">{t("charShippingStation")}</span>
              <select
              value={String(form.location_id || 0)}
              onChange={(e) => {
                const nextID = Number(e.target.value);
                const selectedStation = locationOptions.find((station) => station.id === nextID);
                setForm((prev) => ({
                  ...prev,
                  system_id: selectedStation?.system_id ?? prev.system_id,
                  location_id: selectedStation?.id ?? 0,
                  location_name: selectedStation?.name ?? "",
                }));
              }}
              className="w-full rounded-sm border border-eve-border bg-eve-input px-3 py-2 text-sm text-eve-text focus:border-eve-accent focus:outline-none focus:ring-1 focus:ring-eve-accent/30"
            >
              <option value="0">
                    {stationsLoading || structuresLoading ? t("loading") : t("charShippingSelectStation")}
                  </option>
              {locationOptions.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-eve-dim">{t("charShippingCostPerM3")}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.cost_per_m3}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value);
                setForm((prev) => ({ ...prev, cost_per_m3: Number.isFinite(next) ? next : 0 }));
              }}
              className="w-full rounded-sm border border-eve-border bg-eve-input px-3 py-2 text-sm text-eve-text focus:border-eve-accent focus:outline-none focus:ring-1 focus:ring-eve-accent/30"
            />
          </label>

          <div className="rounded-sm border border-eve-border/60 bg-eve-dark/30 px-3 py-2 text-[11px] text-eve-dim">
            {t("charShippingPreview")}
            {form.location_name
              ? ` ${form.location_name} -> ${form.cost_per_m3.toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK/m3`
              : ""}
          </div>

          {error && (
            <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
