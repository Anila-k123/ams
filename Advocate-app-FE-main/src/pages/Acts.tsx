import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import useDebouncedValue from "../hooks/useDebouncedValue";
import usePagination from "../hooks/usePagination";
import { PageHead, Chip, EmptyState, Skel, Icon } from "../ui/kit";
import { SearchInput, Segmented } from "../ui/forms";
import "../ui/pages/research.css";

// Only what's actually been imported so far (Central + Tamil Nadu).
const JURISDICTIONS = [
  { value: "", label: "All" },
  { value: "CENTRAL", label: "Central" },
  { value: "Tamil Nadu", label: "Tamil Nadu" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
  { value: "sections", label: "Most sections" },
];

// Filters live in the page address, so reload, Back and a shared link keep them.
const FILTER_KEYS = ["q", "jurisdiction", "year_from", "year_to", "department", "ministry", "sort"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;
const fourDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

function formatDate(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Keep the card compact by cutting the abstract to one short line at a word boundary.
function shortDescription(text: string, max = 140) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

const isCentral = (j: string) => String(j || "").toUpperCase() === "CENTRAL";

export default function Acts() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const f: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ""])) as Filters;
  const sort = f.sort || "newest";
  const [query, setQuery] = useState(f.q);
  const debouncedQuery = (useDebouncedValue(query, 300) as string).trim();
  const [acts, setActs] = useState<any[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [facets, setFacets] = useState<{ departments: { name: string; count: number }[]; ministries: { name: string; count: number }[] }>({ departments: [], ministries: [] });

  // One place that changes the URL; the list and the drop-downs follow it.
  const setFilter = useCallback((patch: Partial<Filters>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    }, { replace: true });
  }, [setParams]);

  // The search box writes to the URL once typing pauses.
  useEffect(() => { if (debouncedQuery !== f.q) setFilter({ q: debouncedQuery }); }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps -- only on a new search

  const filterKey = FILTER_KEYS.map((k) => f[k]).join("|");
  const { page, setPage, size, setSize } = usePagination({ defaultSize: 20, resetOn: [filterKey] }) as any;

  const apiParams = useCallback(() => {
    const out: Record<string, string> = {};
    FILTER_KEYS.forEach((k) => { if (f[k]) out[k] = f[k]; });
    return out;
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- filterKey stands for f

  const fetchActs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/acts", { params: { ...apiParams(), sort, page, size } });
      setActs(res.data.content || []);
      setTotalElements(res.data.totalElements || 0);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Failed to load acts."));
    } finally {
      setLoading(false);
    }
  }, [apiParams, sort, page, size]);

  useEffect(() => { fetchActs(); }, [fetchActs]);

  // Department and ministry choices, counted within the other filters.
  useEffect(() => {
    api.get("/api/acts/facets", { params: apiParams() })
      .then((r) => setFacets({ departments: r.data.departments || [], ministries: r.data.ministries || [] }))
      .catch(() => {});
  }, [apiParams]);

  const active = [
    f.q && { key: "q", label: `“${f.q}”` },
    f.jurisdiction && { key: "jurisdiction", label: JURISDICTIONS.find((j) => j.value === f.jurisdiction)?.label || f.jurisdiction },
    (f.year_from || f.year_to) && { key: "year", label: f.year_from && f.year_to ? `${f.year_from}–${f.year_to}` : f.year_from ? `From ${f.year_from}` : `Up to ${f.year_to}` },
    f.department && { key: "department", label: f.department },
    f.ministry && { key: "ministry", label: f.ministry },
  ].filter(Boolean) as { key: string; label: string }[];
  const clear = (key: string) => {
    if (key === "q") setQuery("");
    setFilter(key === "year" ? { year_from: "", year_to: "" } : { [key]: "" } as Partial<Filters>);
  };
  const clearAll = () => { setQuery(""); setFilter({ q: "", jurisdiction: "", year_from: "", year_to: "", department: "", ministry: "" }); };

  const pages = Math.max(1, Math.ceil(totalElements / size));

  return (
    <div>
      <PageHead title="Bare Acts" sub="Central and Tamil Nadu bare acts with sections, act papers and the cases you have linked to them." />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} style={{ width: "min(460px, 100%)" }}
          placeholder="Search act name, number or section text"
          aria-label="Search acts" />
        <Segmented label="Jurisdiction" value={f.jurisdiction} onChange={(v) => setFilter({ jurisdiction: v, department: "", ministry: "" })} options={JURISDICTIONS} />
      </div>

      <div className="rs-filters" role="group" aria-label="Filters">
        <label className="rs-filter">
          <span className="label">Year from</span>
          <input className="input" inputMode="numeric" placeholder="e.g. 1950" value={f.year_from} maxLength={4}
            onChange={(e) => setFilter({ year_from: fourDigits(e.target.value) })} />
        </label>
        <label className="rs-filter">
          <span className="label">to</span>
          <input className="input" inputMode="numeric" placeholder="e.g. 2025" value={f.year_to} maxLength={4}
            onChange={(e) => setFilter({ year_to: fourDigits(e.target.value) })} />
        </label>
        <label className="rs-filter rs-filter-wide">
          <span className="label">Department</span>
          <select className="input" value={f.department} onChange={(e) => setFilter({ department: e.target.value })}>
            <option value="">Any department</option>
            {f.department && !facets.departments.some((d) => d.name === f.department) && <option value={f.department}>{f.department}</option>}
            {facets.departments.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.count})</option>)}
          </select>
        </label>
        <label className="rs-filter rs-filter-wide">
          <span className="label">Ministry</span>
          <select className="input" value={f.ministry} onChange={(e) => setFilter({ ministry: e.target.value })}>
            <option value="">Any ministry</option>
            {f.ministry && !facets.ministries.some((d) => d.name === f.ministry) && <option value={f.ministry}>{f.ministry}</option>}
            {facets.ministries.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.count})</option>)}
          </select>
        </label>
        <label className="rs-filter">
          <span className="label">Sort</span>
          <select className="input" value={sort} onChange={(e) => setFilter({ sort: e.target.value === "newest" ? "" : e.target.value })}>
            {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div className="row wrap" style={{ gap: 8, margin: "4px 0 12px", minHeight: 28 }}>
        <span className="small muted">{loading ? "Searching…" : `${totalElements.toLocaleString("en-IN")} ${totalElements === 1 ? "act" : "acts"}`}</span>
        {active.map((a) => (
          <span key={a.key} className="tag">{a.label}
            <button type="button" onClick={() => clear(a.key)} aria-label={`Remove filter ${a.label}`}><Icon name="x" size="sm" /></button>
          </span>
        ))}
        {active.length > 1 && <button type="button" className="link small" style={{ border: 0, background: "none", padding: 0 }} onClick={clearAll}>Clear all</button>}
      </div>

      {error && <div className="callout bad" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>{error}</div></div>}


      <div className="stack">
        {loading ? (
          [1, 2, 3, 4, 5].map((i) => <div key={i} className="panel"><div className="panel-body stack"><Skel h={12} w="30%" /><Skel h={18} w="70%" /><Skel h={12} /></div></div>)
        ) : acts.length === 0 ? (
          <div className="panel">
            {active.length ? (
              <EmptyState icon="book" title="No acts match these filters"
                text="Try a wider year range, another department or ministry, or remove a filter."
                action={<button type="button" className="btn sm" onClick={clearAll}>Clear all filters</button>} />
            ) : (
              <EmptyState icon="book" title="No acts found" />
            )}
          </div>
        ) : (
          acts.map((act) => (
            <button key={act.id} type="button" className="panel rs-card" onClick={() => navigate(`/dashboard/acts/${act.id}`)}>
              <div className="panel-body" style={{ padding: "16px 20px" }}>
                <div className="row wrap" style={{ gap: 10, marginBottom: 6 }}>
                  <Chip tone={isCentral(act.jurisdiction) ? "info" : "tape"}>{isCentral(act.jurisdiction) ? "Central" : act.jurisdiction}</Chip>
                  <span className="mono faint small">Act {act.actNumber} of {act.actYear}</span>
                </div>
                <h3>{act.title}</h3>
                {act.description && <p className="muted small" style={{ marginTop: 4 }}>{shortDescription(act.description)}</p>}
                <div className="faint xs" style={{ marginTop: 8 }}>
                  {[act.ministry, act.department && act.department !== act.ministry ? act.department : null,
                    act.enactmentDate ? `Enacted ${formatDate(act.enactmentDate)}` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {totalElements > 0 && (
        <div className="rs-pager">
          <span>{page * size + 1}–{Math.min(totalElements, page * size + size)} of {totalElements.toLocaleString("en-IN")}</span>
          <div className="row" style={{ gap: 8 }}>
            <label className="row small" style={{ gap: 6 }}>Per page
              <select className="input" style={{ width: "auto" }} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="pager" role="navigation" aria-label="Pages">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
              <button type="button" aria-current="true">{page + 1} / {pages}</button>
              <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
