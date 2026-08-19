import { useEffect, useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Refuel = {
  id: number;
  station: string;
  fuel_name: string;
  refuel_date: string;
  mileage_km: string | number | null;
  volume_l: string;
  price_per_l: string;
  discounted_price_per_l: string | null;
  total_price: string;
  discounted_total_price: string | null;
  savings: string | null;
  full_fill: boolean;
  receipt_original_name: string | null;
  receipt_size: number | null;
  vehicle_id: number | null;
};

type Price = {
  id: number;
  station: "ORLEN" | "MOL" | string;
  fuel_name: string;
  price: string;
  price_date: string;
};

type Fuel = {
  id: number;
  station: "ORLEN" | "MOL" | string;
  fuel_name: string;
  fuel_type: string;
};

type Vehicle = {
  id: number;
  name: string;
  car_type: string;
  fuel_type: string;
  tank_capacity_l: number | null;
  current_fuel_l: number | null;
  avg_consumption_l100: number | null;
  initial_mileage_km: number | null;
  note: string;
};

type AuthUser = {
  id: number;
  email: string;
  name: string;
  hasPassword?: boolean;
};

type AuthConfig = {
  googleEnabled: boolean;
  registrationAllowed: boolean;
};

const FUEL_TYPE_OPTIONS = ["", "Benzín", "Diesel"] as const;

// Each fuel gets a pair [pump color, discount color]
const CHART_COLOR_PAIRS: [string, string][] = [
  ["#0f766e", "#5eead4"], // teal
  ["#2563eb", "#93c5fd"], // blue
  ["#ea580c", "#fdba74"], // orange
  ["#7c3aed", "#c4b5fd"], // violet
  ["#dc2626", "#fca5a5"], // red
  ["#16a34a", "#86efac"], // green
];
const CHART_COLORS = CHART_COLOR_PAIRS.map(([pump]) => pump);

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = hue / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hPrime >= 0 && hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  const toHex = (channel: number) => Math.round((channel + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

/** Assigns a distinct color pair based on fuel name, with a deterministic fallback for similar fuels. */
function getFuelColorPair(fuelName: string, fallbackIndex: number): [string, string] {
  const lower = fuelName.toLowerCase();
  const compact = lower.replace(/\s+/g, "");

  if (lower.includes("lpg") || lower.includes("cng") || lower.includes("plyn") || lower.includes("gas")) {
    return ["#0f766e", "#5eead4"];
  }

  if (compact.includes("evodieselplus") || compact.includes("evodieselplu") || compact.includes("evodiesel+")) {
    return ["#2563eb", "#93c5fd"];
  }

  if (compact.includes("evodiesel")) {
    return ["#0891b2", "#67e8f9"];
  }

  if (compact.includes("efektadiesel")) {
    return ["#ea580c", "#fdba74"];
  }

  if (compact.includes("vervadiesel")) {
    return ["#c026d3", "#f0abfc"];
  }

  if (lower.includes("diesel") || lower.includes("nafta")) {
    if (lower.includes("premium") || lower.includes("excellium") || lower.includes("ultimate") || lower.includes("v-power")) {
      return ["#5b21b6", "#c4b5fd"];
    }
    return ["#9a3412", "#fed7aa"];
  }

  if (lower.includes("98") || lower.includes("premium") || lower.includes("excellium") || lower.includes("v-power") || lower.includes("ultimate")) {
    return ["#dc2626", "#fca5a5"];
  }

  if (lower.includes("natural") || lower.includes("benzin") || lower.includes("95") || compact === "sp" || compact.startsWith("sp")) {
    return ["#16a34a", "#86efac"];
  }

  if (lower.includes("e5") || lower.includes("e10")) {
    return ["#2563eb", "#93c5fd"];
  }

  const hash = hashString(compact || lower) + fallbackIndex * 97;
  const hue = hash % 360;
  const pumpColor = hslToHex(hue, 78, 42);
  const discountColor = hslToHex(hue, 92, 74);
  return [pumpColor, discountColor];
}

function getStationColor(station: string, fallbackIndex: number): string {
  const normalized = station.trim().toUpperCase();
  if (normalized === "MOL") return "#1c8e56";
  if (normalized === "ORLEN") return "#cc223a";
  return CHART_COLORS[fallbackIndex % CHART_COLORS.length];
}


async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Požadavek selhal: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) {
      return data.error;
    }
  } catch {
    // Ignore non-JSON error bodies and fall back to the provided message.
  }

  return `${fallback} (${response.status})`;
}

function formatDateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function formatDisplayDate(value: string | null | undefined): string {
  const dateOnly = formatDateOnly(value);
  if (!dateOnly) {
    return "";
  }

  const [year, month, day] = dateOnly.split("-");
  if (!year || !month || !day) {
    return dateOnly;
  }

  return `${day}.${month}.${year}`;
}

function getAppliedDiscountedPricePerL(item: Refuel): number | null {
  const discountedTotal = item.discounted_total_price == null ? null : Number(item.discounted_total_price);
  const volume = Number(item.volume_l);

  if (discountedTotal == null || !Number.isFinite(discountedTotal) || !Number.isFinite(volume) || volume <= 0) {
    return null;
  }

  return Number((discountedTotal / volume).toFixed(2));
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { dataKey: string; name: string; value: unknown; color: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(e => e.value != null);
  if (!items.length) return null;
  return (
    <div style={{ background: "var(--card-solid, #fff)", border: "1px solid var(--line, #d2dbe8)", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(30,52,85,0.10)" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text, #1a2636)" }}>{label}</p>
      {items.map(entry => (
        <p key={entry.dataKey} style={{ margin: "3px 0", color: entry.color, display: "flex", gap: 8, justifyContent: "space-between" }}>
          <span>{entry.name}</span>
          <strong>{typeof entry.value === "number" ? entry.value.toFixed(2) : String(entry.value)} {unit}</strong>
        </p>
      ))}
    </div>
  );
}

type AuthMode = "login" | "register" | "forgot" | "reset";
type SettingsPage = "account" | "vehicles" | "stations" | "prices";

const settingsPageBySectionId: Record<string, SettingsPage> = {
  "nastaveni-ucet": "account",
  "nastaveni-vozidla": "vehicles",
  "nastaveni-stanice": "stations",
  "nastaveni-ceny": "prices",
};

function AuthScreen({ config, error, resetToken, onPasswordAuth, onForgotPassword, onResetPassword }: { config: AuthConfig | null; error: string | null; resetToken: string | null; onPasswordAuth: (mode: "login" | "register", form: { email: string; password: string; name: string }) => Promise<void>; onForgotPassword: (email: string) => Promise<{ ok: boolean; resetUrl?: string }>; onResetPassword: (form: { token: string; password: string }) => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>(resetToken ? "reset" : "login");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const canRegister = config?.registrationAllowed ?? false;

  const authForm = useForm({
    defaultValues: {
      email: "",
      password: "",
      name: "",
      resetPassword: "",
      resetConfirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      setMessage(null);
      if (mode === "forgot") {
        const result = await onForgotPassword(value.email);
        if (result.ok) {
          setMessage({ kind: "success", text: result.resetUrl ? `Odkaz pro obnovu hesla: ${result.resetUrl}` : "Pokud e-mail existuje, odkaz pro obnovu hesla je připravený." });
        }
      } else if (mode === "reset") {
        if (value.resetPassword !== value.resetConfirmPassword) {
          setMessage({ kind: "error", text: "Hesla se neshodují." });
          return;
        }
        await onResetPassword({ token: resetToken ?? "", password: value.resetPassword });
      } else {
        await onPasswordAuth(mode, { email: value.email, password: value.password, name: value.name });
      }
    },
  });

  useEffect(() => {
    if (resetToken) setMode("reset");
  }, [resetToken]);

  const title = mode === "register" ? "Nový účet" : mode === "forgot" ? "Obnova hesla" : mode === "reset" ? "Nové heslo" : "Přihlášení";
  const submitting = authForm.state.isSubmitting;

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <p className="kicker">Tankování</p>
            <h1>{title}</h1>
            <p className="subtitle">Přihlaste se ke svým záznamům nebo vytvořte nový účet.</p>
          </div>
        {canRegister ? (
          <div className="auth-switch" role="tablist" aria-label="Režim přihlášení">
            <button
              type="button"
              className={mode === "login" ? "tab-active" : "ghost"}
              onClick={() => setMode("login")}
              disabled={submitting}
            >
              Přihlášení
            </button>
            <button
              type="button"
              className={mode === "register" ? "tab-active" : "ghost"}
              onClick={() => setMode("register")}
              disabled={submitting}
            >
              Registrace
            </button>
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className={message.kind === "success" ? "success-message" : "error"}>{message.text}</p> : null}
        {mode !== "forgot" && mode !== "reset" ? (
          <>
            <div className="auth-oauth">
              {config?.googleEnabled ? (
                <a className="google-login" href="/api/auth/google">Pokračovat přes Google</a>
              ) : (
                <button className="google-login google-login-disabled" type="button" disabled>
                  Google přihlášení není nakonfigurované
                </button>
              )}
            </div>
            <div className="auth-divider"><span>nebo</span></div>
          </>
        ) : null}
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void authForm.handleSubmit(); }}>
          {mode === "register" ? (
            <authForm.Field name="name">
              {(field) => (
                <label className="auth-field">
                  <span>Jméno</span>
                  <input
                    type="text"
                    placeholder="Jméno"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete="name"
                  />
                </label>
              )}
            </authForm.Field>
          ) : null}
          {mode !== "reset" ? (
            <authForm.Field name="email">
              {(field) => (
                <label className="auth-field">
                  <span>E-mail</span>
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>
              )}
            </authForm.Field>
          ) : null}
          {mode === "forgot" ? null : mode === "reset" ? (
            <>
              <authForm.Field name="resetPassword">
                {(field) => (
                  <label className="auth-field">
                    <span>Nové heslo</span>
                    <input
                      type="password"
                      placeholder="Alespoň 8 znaků"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </label>
                )}
              </authForm.Field>
              <authForm.Field name="resetConfirmPassword">
                {(field) => (
                  <label className="auth-field">
                    <span>Potvrzení hesla</span>
                    <input
                      type="password"
                      placeholder="Znovu nové heslo"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </label>
                )}
              </authForm.Field>
            </>
          ) : (
            <authForm.Field name="password">
              {(field) => (
                <label className="auth-field">
                  <span>Heslo</span>
                  <input
                    type="password"
                    placeholder={mode === "login" ? "Heslo" : "Alespoň 8 znaků"}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={mode === "register" ? 8 : undefined}
                    required
                  />
                </label>
              )}
            </authForm.Field>
          )}
          <button type="submit" disabled={submitting}>{mode === "forgot" ? "Připravit obnovu hesla" : mode === "reset" ? "Nastavit nové heslo" : mode === "login" ? "Přihlásit" : "Vytvořit účet"}</button>
          {mode === "login" ? (
            <button type="button" className="auth-text-button" onClick={() => { setMode("forgot"); setMessage(null); }} disabled={submitting}>Zapomenuté heslo</button>
          ) : mode === "forgot" ? (
            <button type="button" className="auth-text-button" onClick={() => { setMode("login"); setMessage(null); }} disabled={submitting}>Zpět na přihlášení</button>
          ) : mode === "reset" ? (
            <button type="button" className="auth-text-button" onClick={() => { setMode("login"); setMessage(null); }} disabled={submitting}>Zpět na přihlášení</button>
          ) : null}
        </form>
        {mode === "login" && canRegister ? (
          <p className="auth-register-cta">
            Nemáte účet?
            <button type="button" className="auth-text-button" onClick={() => { setMode("register"); setMessage(null); }} disabled={submitting}>Vytvořit účet</button>
          </p>
        ) : null}
      </section>
      </div>
    </main>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [refuels, setRefuels] = useState<Refuel[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [fuels, setFuels] = useState<Fuel[]>([]);
  const [view, setView] = useState<"refuel" | "settings" | "stats">("refuel");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("prices");
  const [newPrice, setNewPrice] = useState({
    station: "ORLEN",
    fuel_name: "",
    price_date: new Date().toISOString().slice(0, 10),
    price: "",
  });
  const [newFuel, setNewFuel] = useState({
    station: "ORLEN",
    fuel_name: "",
    fuel_type: "",
  });
  const [newRefuel, setNewRefuel] = useState({
    station: "ORLEN",
    fuel_name: "",
    refuel_date: new Date().toISOString().slice(0, 10),
    mileage_km: "",
    volume_l: "",
    price_per_l: "",
    full_fill: false,
    receipt: null as File | null,
  });
  const [newStation, setNewStation] = useState("");
  const [stationNames, setStationNames] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<{ id: number; name: string; car_type: string; fuel_type: string; tank_capacity_l: string; current_fuel_l: string; avg_consumption_l100: string; initial_mileage_km: string; note: string } | null>(null);
  const [newVehicle, setNewVehicle] = useState({ name: "", car_type: "", fuel_type: "", tank_capacity_l: "", current_fuel_l: "", avg_consumption_l100: "", initial_mileage_km: "", note: "" });
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [editingFuel, setEditingFuel] = useState<{ id: number; station: string; fuel_name: string; fuel_type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRefuels, setSelectedRefuels] = useState<Set<number>>(new Set());
  const [receiptUploadingId, setReceiptUploadingId] = useState<number | null>(null);
  const [selectedPrices, setSelectedPrices] = useState<Set<number>>(new Set());
  const [refuelPage, setRefuelPage] = useState(0);
  const [priceFilterStation, setPriceFilterStation] = useState("");
  const [priceFilterFuelName, setPriceFilterFuelName] = useState("");
  const [priceFilterDateFrom, setPriceFilterDateFrom] = useState("");
  const [priceFilterDateTo, setPriceFilterDateTo] = useState("");
  const [pricePagesByStation, setPricePagesByStation] = useState<Record<string, number>>({});

  const loadAuth = async () => {
    setAuthLoading(true);
    try {
      const [configData, meData] = await Promise.all([
        getJson<AuthConfig>("/api/auth/config"),
        getJson<{ user: AuthUser | null }>("/api/auth/me"),
      ]);
      setAuthConfig(configData);
      setAuthUser(meData.user);
      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get("authError");
      const token = params.get("resetToken");
      if (oauthError) setAuthError(oauthError);
      if (token) setResetToken(token);
      if (params.has("auth") || oauthError || token) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Přihlášení se nepodařilo načíst.");
    } finally {
      setAuthLoading(false);
    }
  };

  const passwordAuth = async (mode: "login" | "register", form: { email: string; password: string; name: string }) => {
    setAuthError(null);
    let response: Response;
    try {
      response = await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } catch {
      setAuthError("Server přihlášení není dostupný.");
      return;
    }

    if (!response.ok) {
      setAuthError(await getApiErrorMessage(response, mode === "login" ? "Přihlášení selhalo" : "Registrace selhala"));
      return;
    }

    const data = (await response.json()) as { user: AuthUser };
    setAuthUser(data.user);
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    let response: Response;
    try {
      response = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      setAuthError("Server přihlášení není dostupný.");
      return { ok: false };
    }

    if (!response.ok) {
      setAuthError(await getApiErrorMessage(response, "Obnova hesla selhala"));
      return { ok: false };
    }

    const data = (await response.json()) as { resetUrl?: string };
    return { ok: true, resetUrl: data.resetUrl };
  };

  const resetPassword = async (form: { token: string; password: string }) => {
    setAuthError(null);
    let response: Response;
    try {
      response = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } catch {
      setAuthError("Server přihlášení není dostupný.");
      return;
    }

    if (!response.ok) {
      setAuthError(await getApiErrorMessage(response, "Nastavení hesla selhalo"));
      return;
    }

    const data = (await response.json()) as { user: AuthUser };
    setResetToken(null);
    setAuthUser(data.user);
  };

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setRefuels([]);
    setPrices([]);
    setFuels([]);
    setVehicles([]);
  };

  const passwordForm = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value, formApi }) => {
      setPasswordMessage(null);

      if (value.newPassword !== value.confirmPassword) {
        setPasswordMessage("Nová hesla se neshodují.");
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: value.currentPassword, newPassword: value.newPassword }),
        });

        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, "Změna hesla selhala"));
        }

        formApi.reset();
        setPasswordMessage("Heslo bylo změněno.");
        setAuthUser((prev) => prev ? { ...prev, hasPassword: true } : prev);
      } catch (err) {
        setPasswordMessage(err instanceof Error ? err.message : "Změna hesla selhala");
      } finally {
        setLoading(false);
      }
    },
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [refuelsData, pricesData, fuelsData, vehiclesData, stationsData] = await Promise.all([
        getJson<Refuel[]>("/api/refuels"),
        getJson<Price[]>("/api/prices"),
        getJson<Fuel[]>('/api/fuels'),
        getJson<Vehicle[]>("/api/vehicles"),
        getJson<string[]>("/api/stations"),
      ]);
      setRefuels(refuelsData);
      setRefuelPage(0);
      setPrices(pricesData);
      setPricePagesByStation({});
      setFuels(fuelsData);
      setVehicles(vehiclesData);
      setStationNames(stationsData);
      setSelectedVehicleId((prev) => {
        if (prev != null && vehiclesData.some(v => v.id === prev)) return prev;
        return vehiclesData[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    if (authUser) loadData();
  }, [authUser]);

  const totalSavings = useMemo(() => {
    return refuels.reduce((sum, item) => sum + Number(item.savings ?? 0), 0);
  }, [refuels]);

  const stats = useMemo(() => {
    const totalVolume = refuels.reduce((sum, item) => sum + Number(item.volume_l), 0);
    const totalSpent = refuels.reduce((sum, item) => sum + Number(item.total_price), 0);
    const totalPaidWithDiscount = refuels.reduce((sum, item) => sum + Number(item.discounted_total_price ?? item.total_price), 0);
    const avgPricePerLiter = totalVolume > 0 ? totalSpent / totalVolume : 0;
    const uniqueStations = new Set(refuels.map((r) => r.fuel_name)).size;
    
    return {
      totalVolume: totalVolume.toFixed(2),
      totalSpent: totalSpent.toFixed(2),
      totalPaidWithDiscount: totalPaidWithDiscount.toFixed(2),
      avgPricePerLiter: avgPricePerLiter.toFixed(2),
      uniqueStations,
    };
  }, [refuels]);

  const rangeStats = useMemo(() => {
    const v = vehicles.find(x => x.id === selectedVehicleId) ?? null;
    const tankCapacity = v?.tank_capacity_l != null ? Number(v.tank_capacity_l) : null;
    const currentFuel = v?.current_fuel_l != null ? Number(v.current_fuel_l) : null;
    const avgConsumption = v?.avg_consumption_l100 != null ? Number(v.avg_consumption_l100) : null;

    const canCompute = avgConsumption != null && Number.isFinite(avgConsumption) && avgConsumption > 0;
    const currentRangeKm = canCompute && currentFuel != null
      ? (currentFuel / avgConsumption) * 100
      : null;
    const fullRangeKm = canCompute && tankCapacity != null
      ? (tankCapacity / avgConsumption) * 100
      : null;

    const fuelLevelPct = tankCapacity != null && tankCapacity > 0 && currentFuel != null
      ? Math.max(0, Math.min(100, (currentFuel / tankCapacity) * 100))
      : null;

    let fuelLevelClass = "unknown";
    let fuelLevelLabel = "Neznámý";

    if (fuelLevelPct != null) {
      if (fuelLevelPct < 20) {
        fuelLevelClass = "low";
        fuelLevelLabel = "Nízká";
      } else if (fuelLevelPct < 50) {
        fuelLevelClass = "medium";
        fuelLevelLabel = "Střední";
      } else {
        fuelLevelClass = "good";
        fuelLevelLabel = "Dobrá";
      }
    }

    return {
      currentRangeKm,
      fullRangeKm,
      fuelLevelPct,
      fuelLevelClass,
      fuelLevelLabel,
      currentFuel,
      tankCapacity,
    };
  }, [vehicles, selectedVehicleId]);

  const filteredPrices = useMemo(() => {
    return prices.filter((p) => {
      if (priceFilterStation && p.station !== priceFilterStation) return false;
      if (priceFilterFuelName && p.fuel_name !== priceFilterFuelName) return false;
      const dateOnly = formatDateOnly(p.price_date);
      if (priceFilterDateFrom && dateOnly < priceFilterDateFrom) return false;
      if (priceFilterDateTo && dateOnly > priceFilterDateTo) return false;
      return true;
    });
  }, [prices, priceFilterStation, priceFilterFuelName, priceFilterDateFrom, priceFilterDateTo]);

  const sortedFilteredPrices = useMemo(() => {
    return [...filteredPrices].sort((a, b) => {
      const dateCmp = formatDateOnly(b.price_date).localeCompare(formatDateOnly(a.price_date));
      if (dateCmp !== 0) return dateCmp;
      return b.id - a.id;
    });
  }, [filteredPrices]);

  const groupedPricesByStation = useMemo(() => {
    const grouped = new Map<string, Price[]>();
    for (const price of sortedFilteredPrices) {
      const stationKey = price.station || "(neznámá)";
      const rows = grouped.get(stationKey) ?? [];
      rows.push(price);
      grouped.set(stationKey, rows);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([station, rows]) => ({ station, rows }));
  }, [sortedFilteredPrices]);

  const latestPriceDateByStation = useMemo(() => {
    const latest = new Map<string, { date: string; id: number }>();

    for (const price of prices) {
      const stationKey = price.station || "(neznámá)";
      const dateOnly = formatDateOnly(price.price_date);
      const current = latest.get(stationKey);

      if (!current || dateOnly > current.date || (dateOnly === current.date && price.id > current.id)) {
        latest.set(stationKey, { date: dateOnly, id: price.id });
      }
    }

    return latest;
  }, [prices]);

  const pricePageSize = 5;

  useEffect(() => {
    setPricePagesByStation((prev) => {
      const next: Record<string, number> = {};

      for (const group of groupedPricesByStation) {
        const maxPage = Math.max(0, Math.ceil(group.rows.length / pricePageSize) - 1);
        next[group.station] = Math.min(prev[group.station] ?? 0, maxPage);
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const sameLength = prevKeys.length === nextKeys.length;
      const sameValues = sameLength && nextKeys.every((key) => prev[key] === next[key]);

      return sameValues ? prev : next;
    });
  }, [groupedPricesByStation]);

  const priceFilterFuelOptions = useMemo(() => {
    const names = new Set<string>();
    for (const p of prices) {
      if (!priceFilterStation || p.station === priceFilterStation) {
        names.add(p.fuel_name);
      }
    }
    return Array.from(names).sort();
  }, [prices, priceFilterStation]);

  const discountChartConfig = useMemo(() => {
    const stations = Array.from(new Set(prices.map(p => p.station))).sort();
    return stations.map(station => {
      const sp = prices.filter(p => p.station === station);
      const fuelKeys = Array.from(new Set(sp.map(p => p.fuel_name))).sort();
      const dateMap = new Map<string, Record<string, number | null>>();
      for (const p of [...sp].sort((a, b) => a.id - b.id)) {
        const dk = formatDateOnly(p.price_date);
        if (!dateMap.has(dk)) {
          const e: Record<string, number | null> = {};
          for (const k of fuelKeys) e[k] = null;
          dateMap.set(dk, e);
        }
        dateMap.get(dk)![p.fuel_name] = Number(p.price);
      }
      const data = Array.from(dateMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ date: formatDisplayDate(k), ...v }));
      return { station, data, keys: fuelKeys };
    });
  }, [prices]);

  const pumpChartConfig = useMemo(() => {
    const stations = Array.from(new Set(refuels.map(r => r.station || "(neznámá)"))).sort();
    return stations.map(station => {
      const sr = refuels.filter(r => (r.station || "(neznámá)") === station);
      const fuelKeys = Array.from(new Set(sr.map(r => r.fuel_name))).sort();
      const dateMap = new Map<string, Record<string, number | null>>();
      for (const r of sr) {
        if (!dateMap.has(r.refuel_date)) {
          const e: Record<string, number | null> = {};
          for (const k of fuelKeys) e[k] = null;
          dateMap.set(r.refuel_date, e);
        }
        dateMap.get(r.refuel_date)![r.fuel_name] = Number(r.price_per_l);
      }
      const data = Array.from(dateMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ date: formatDisplayDate(k), ...v }));
      return { station, data, keys: fuelKeys };
    });
  }, [refuels]);

  const stationChartConfig = useMemo(() => {
    const stationMap = new Map<string, number>();
    for (const r of refuels) {
      const st = r.station || "(neznámá)";
      stationMap.set(st, (stationMap.get(st) ?? 0) + Number(r.total_price));
    }

    const data = Array.from(stationMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([station, total], i) => ({
        station,
        value: Number(total.toFixed(2)),
        fill: getStationColor(station, i),
      }));

    const total = data.reduce((sum, row) => sum + row.value, 0);
    return { data, total };
  }, [refuels]);

  const sortedRefuels = useMemo(() => {
    return [...refuels].sort((a, b) => {
      const aKm = a.mileage_km != null ? Number(a.mileage_km) : -Infinity;
      const bKm = b.mileage_km != null ? Number(b.mileage_km) : -Infinity;
      if (aKm !== bKm) return bKm - aKm; // descending by mileage
      return b.refuel_date.localeCompare(a.refuel_date); // descending by date as fallback
    });
  }, [refuels]);

  const refuelPageSize = 5;
  const refuelPageCount = Math.ceil(sortedRefuels.length / refuelPageSize);
  const paginatedRefuels = sortedRefuels.slice(refuelPage * refuelPageSize, (refuelPage + 1) * refuelPageSize);

  const fuelOptionsByStation = useMemo(() => {
    const byStation = new Map<string, string[]>();
    for (const fuel of fuels) {
      const stationFuels = byStation.get(fuel.station) ?? [];
      if (!stationFuels.includes(fuel.fuel_name)) {
        stationFuels.push(fuel.fuel_name);
        stationFuels.sort((a, b) => a.localeCompare(b));
        byStation.set(fuel.station, stationFuels);
      }
    }
    return byStation;
  }, [fuels]);

  const allStations = useMemo(() => {
    const fromFuels = Array.from(fuelOptionsByStation.keys());
    const merged = Array.from(new Set([...stationNames, ...fromFuels])).sort();
    return merged.length > 0 ? merged : ["ORLEN", "MOL"];
  }, [fuelOptionsByStation, stationNames]);

  const refuelFuelOptions = useMemo(() => {
    const stationFuels = fuels.filter(f => f.station === newRefuel.station);
    const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
    const vehicleFuelType = selectedVehicle?.fuel_type ?? '';
    let eligible = stationFuels;
    if (vehicleFuelType) {
      const matching = stationFuels.filter(f => f.fuel_type === vehicleFuelType || f.fuel_type === '');
      if (matching.length > 0) eligible = matching;
    }
    return Array.from(new Set(eligible.map(f => f.fuel_name))).sort((a, b) => a.localeCompare(b));
  }, [fuels, newRefuel.station, vehicles, selectedVehicleId]);

  const configuredDiscountedPrice = useMemo(() => {
    if (!newRefuel.fuel_name || !newRefuel.refuel_date) {
      return null;
    }

    const applicable = prices
      .filter((item) => item.station === newRefuel.station)
      .filter((item) => item.fuel_name === newRefuel.fuel_name)
      .filter((item) => formatDateOnly(item.price_date) <= newRefuel.refuel_date)
      .sort((a, b) => {
        if (formatDateOnly(a.price_date) === formatDateOnly(b.price_date)) {
          return b.id - a.id;
        }
        return formatDateOnly(b.price_date).localeCompare(formatDateOnly(a.price_date));
      })[0];

    if (!applicable) {
      return null;
    }

    return Number(applicable.price);
  }, [newRefuel.fuel_name, newRefuel.refuel_date, newRefuel.station, prices]);

  useEffect(() => {
    if (!refuelFuelOptions.length) {
      if (newRefuel.fuel_name) {
        setNewRefuel((prev) => ({ ...prev, fuel_name: "" }));
      }
      return;
    }

    if (!newRefuel.fuel_name || !refuelFuelOptions.includes(newRefuel.fuel_name)) {
      setNewRefuel((prev) => ({ ...prev, fuel_name: refuelFuelOptions[0] }));
    }
  }, [newRefuel.fuel_name, refuelFuelOptions]);

  useEffect(() => {
    const options = fuelOptionsByStation.get(newPrice.station) ?? [];
    if (!options.length) {
      return;
    }
    if (!newPrice.fuel_name || !options.includes(newPrice.fuel_name)) {
      setNewPrice((prev) => ({ ...prev, fuel_name: options[0] }));
    }
  }, [fuelOptionsByStation, newPrice.fuel_name, newPrice.station]);

  useEffect(() => {
    if (!allStations.includes(newRefuel.station)) {
      setNewRefuel((prev) => ({ ...prev, station: allStations[0] ?? "ORLEN" }));
    }
    if (!allStations.includes(newFuel.station)) {
      setNewFuel((prev) => ({ ...prev, station: allStations[0] ?? "ORLEN" }));
    }
    if (!allStations.includes(newPrice.station)) {
      setNewPrice((prev) => ({ ...prev, station: allStations[0] ?? "ORLEN" }));
    }
  }, [allStations]);

  const createPrice = async () => {
    const parsed = Number(newPrice.price);

    if (!newPrice.fuel_name.trim()) {
      setError("Zadej název paliva.");
      return;
    }

    if (!newPrice.price_date) {
      setError("Zadej datum platnosti.");
      return;
    }

    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Cena musí být kladné číslo.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          station: newPrice.station,
          fuel_name: newPrice.fuel_name.trim(),
          price_date: newPrice.price_date,
          price: parsed,
        }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Vytvoření ceny selhalo"));
      }

      setNewPrice((prev) => ({
        ...prev,
        fuel_name: "",
        price: "",
      }));

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vytvoření ceny selhalo");
      setLoading(false);
    }
  };

  const createStation = async () => {
    const stationName = newStation.trim().toUpperCase();

    if (!stationName) {
      setError("Zadej název nové stanice.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch('/api/stations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: stationName,
        }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Vytvoření stanice selhalo'));
      }

      setNewStation('');
      setNewFuel((prev) => ({ ...prev, station: stationName }));
      setNewPrice((prev) => ({ ...prev, station: stationName }));
      setNewRefuel((prev) => ({ ...prev, station: stationName }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vytvoření stanice selhalo');
      setLoading(false);
    }
  };

  const createFuel = async () => {
    const fuelName = newFuel.fuel_name.trim();

    if (!fuelName) {
      setError("Zadej název nového paliva.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch('/api/fuels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          station: newFuel.station,
          fuel_name: fuelName,
          fuel_type: newFuel.fuel_type,
        }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Vytvoření paliva selhalo'));
      }

      setNewFuel((prev) => ({ ...prev, fuel_name: '', fuel_type: '' }));
      setNewPrice((prev) => ({ ...prev, station: newFuel.station, fuel_name: fuelName }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vytvoření paliva selhalo');
      setLoading(false);
    }
  };

  const createRefuel = async () => {
    const mileageKm = newRefuel.mileage_km.trim() === "" ? null : Number(newRefuel.mileage_km);
    const volumeL = Number(newRefuel.volume_l);
    const pricePerL = Number(newRefuel.price_per_l);

    if (!newRefuel.fuel_name.trim()) {
      setError('Vyber palivo.');
      return;
    }

    if (!newRefuel.refuel_date) {
      setError('Zadej datum tankování.');
      return;
    }

    if (!Number.isFinite(volumeL) || volumeL <= 0) {
      setError('Množství musí být kladné číslo.');
      return;
    }

    if (!Number.isFinite(pricePerL) || pricePerL <= 0) {
      setError('Cena za litr musí být kladné číslo.');
      return;
    }

    if (mileageKm != null && (!Number.isFinite(mileageKm) || mileageKm < 0)) {
      setError('Stav kilometrů musí být kladné číslo.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('station', newRefuel.station);
      formData.append('fuel_name', newRefuel.fuel_name.trim());
      formData.append('refuel_date', newRefuel.refuel_date);
      if (mileageKm != null) formData.append('mileage_km', String(mileageKm));
      formData.append('volume_l', String(volumeL));
      formData.append('price_per_l', String(pricePerL));
      formData.append('full_fill', String(newRefuel.full_fill));
      if (selectedVehicleId != null) formData.append('vehicle_id', String(selectedVehicleId));
      if (newRefuel.receipt) formData.append('receipt', newRefuel.receipt);

      const response = await apiFetch('/api/refuels', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Přidání tankování selhalo'));
      }

      setNewRefuel((prev) => ({
        ...prev,
        mileage_km: '',
        volume_l: '',
        price_per_l: '',
        full_fill: false,
        receipt: null,
      }));

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Přidání tankování selhalo');
      setLoading(false);
    }
  };

  const deleteRefuel = async (id: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch(`/api/refuels/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Smazání tankování selhalo'));
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání tankování selhalo');
      setLoading(false);
    }
  };

  const uploadReceipt = async (id: number, file: File) => {
    setReceiptUploadingId(id);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      const response = await apiFetch(`/api/refuels/${id}/receipt`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Nahrání účtenky selhalo'));
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nahrání účtenky selhalo');
    } finally {
      setReceiptUploadingId(null);
    }
  };

  const deletePrice = async (id: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch(`/api/prices/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Smazání ceny selhalo'));
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání ceny selhalo');
      setLoading(false);
    }
  };

  const deleteMultipleRefuels = async (ids: number[]) => {
    if (ids.length === 0) return;
    
    setLoading(true);
    setError(null);

    try {
      for (const id of ids) {
        const response = await apiFetch(`/api/refuels/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Smazání tankování selhalo'));
        }
      }

      setSelectedRefuels(new Set());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání tankování selhalo');
      setLoading(false);
    }
  };

  const deleteMultiplePrices = async (ids: number[]) => {
    if (ids.length === 0) return;
    
    setLoading(true);
    setError(null);

    try {
      for (const id of ids) {
        const response = await apiFetch(`/api/prices/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Smazání ceny selhalo'));
        }
      }

      setSelectedPrices(new Set());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání ceny selhalo');
      setLoading(false);
    }
  };

  const updateFuel = async () => {
    if (!editingFuel) return;
    const fuelName = editingFuel.fuel_name.trim();
    if (!fuelName) { setError("Zadej název paliva."); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/fuels/${editingFuel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fuel_name: fuelName, fuel_type: editingFuel.fuel_type }),
      });
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Úprava paliva selhala'));
      setEditingFuel(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Úprava paliva selhala');
      setLoading(false);
    }
  };

  const deleteFuel = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/fuels/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Smazání paliva selhalo'));
      if (editingFuel?.id === id) setEditingFuel(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání paliva selhalo');
      setLoading(false);
    }
  };

  const createVehicle = async () => {
    const form = newVehicle;
    const tankCapacity = form.tank_capacity_l === "" ? null : Number(form.tank_capacity_l);
    const currentFuel = form.current_fuel_l === "" ? null : Number(form.current_fuel_l);
    const avgConsumption = form.avg_consumption_l100 === "" ? null : Number(form.avg_consumption_l100);
    const initialMileage = form.initial_mileage_km === "" ? null : Number(form.initial_mileage_km);

    if (tankCapacity != null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0)) { setError("Obsah nádrže musí být kladné číslo."); return; }
    if (avgConsumption != null && (!Number.isFinite(avgConsumption) || avgConsumption <= 0)) { setError("Průměrná spotřeba musí být kladné číslo."); return; }
    if (currentFuel != null && (!Number.isFinite(currentFuel) || currentFuel < 0)) { setError("Aktuální stav nádrže musí být nezáporné číslo."); return; }
    if (tankCapacity != null && currentFuel != null && currentFuel > tankCapacity) { setError("Aktuální stav nádrže nesmí být vyšší než obsah nádrže."); return; }
    if (initialMileage != null && (!Number.isFinite(initialMileage) || initialMileage < 0)) { setError("Počáteční stav km musí být nezáporné číslo."); return; }

    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim() || 'Moje auto', car_type: form.car_type.trim(), fuel_type: form.fuel_type, tank_capacity_l: tankCapacity, current_fuel_l: currentFuel, avg_consumption_l100: avgConsumption, initial_mileage_km: initialMileage, note: form.note.trim() }),
      });
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Vytvoření vozidla selhalo'));
      const data = await response.json() as { vehicle: Vehicle };
      setNewVehicle({ name: '', car_type: '', fuel_type: '', tank_capacity_l: '', current_fuel_l: '', avg_consumption_l100: '', initial_mileage_km: '', note: '' });
      await loadData();
      setSelectedVehicleId(data.vehicle.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vytvoření vozidla selhalo');
      setLoading(false);
    }
  };

  const updateVehicle = async () => {
    if (!editingVehicle) return;
    const form = editingVehicle;
    const tankCapacity = form.tank_capacity_l === "" ? null : Number(form.tank_capacity_l);
    const currentFuel = form.current_fuel_l === "" ? null : Number(form.current_fuel_l);
    const avgConsumption = form.avg_consumption_l100 === "" ? null : Number(form.avg_consumption_l100);
    const initialMileage = form.initial_mileage_km === "" ? null : Number(form.initial_mileage_km);

    if (tankCapacity != null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0)) { setError("Obsah nádrže musí být kladné číslo."); return; }
    if (avgConsumption != null && (!Number.isFinite(avgConsumption) || avgConsumption <= 0)) { setError("Průměrná spotřeba musí být kladné číslo."); return; }
    if (currentFuel != null && (!Number.isFinite(currentFuel) || currentFuel < 0)) { setError("Aktuální stav nádrže musí být nezáporné číslo."); return; }
    if (tankCapacity != null && currentFuel != null && currentFuel > tankCapacity) { setError("Aktuální stav nádrže nesmí být vyšší než obsah nádrže."); return; }
    if (initialMileage != null && (!Number.isFinite(initialMileage) || initialMileage < 0)) { setError("Počáteční stav km musí být nezáporné číslo."); return; }

    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/vehicles/${form.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim() || 'Moje auto', car_type: form.car_type.trim(), fuel_type: form.fuel_type, tank_capacity_l: tankCapacity, current_fuel_l: currentFuel, avg_consumption_l100: avgConsumption, initial_mileage_km: initialMileage, note: form.note.trim() }),
      });
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Úprava vozidla selhala'));
      setEditingVehicle(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Úprava vozidla selhala');
      setLoading(false);
    }
  };

  const deleteVehicle = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/vehicles/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Smazání vozidla selhalo'));
      if (selectedVehicleId === id) setSelectedVehicleId(null);
      if (editingVehicle?.id === id) setEditingVehicle(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání vozidla selhalo');
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="kicker">Tankování</p>
          <h1>Načítám přihlášení</h1>
        </section>
      </main>
    );
  }

  if (!authUser) {
    return <AuthScreen config={authConfig} error={authError} resetToken={resetToken} onPasswordAuth={passwordAuth} onForgotPassword={requestPasswordReset} onResetPassword={resetPassword} />;
  }

  const openSettings = (sectionId?: string) => {
    setView("settings");
    setSettingsPage(sectionId ? settingsPageBySectionId[sectionId] ?? "prices" : "prices");
  };

  return (
    <main className="page app-shell">
      <header className="hero app-topbar">
        <div>
          <p className="kicker">Tankování</p>
          <h1>Přehled tankování</h1>
          <p className="subtitle">
            Sledování tankování a cen paliva na stanicích ORLEN a MOL.
          </p>
        </div>
        <div className="header-user-menu">
          <span className="user-chip">{authUser.name || authUser.email}</span>
          <div className="header-user-actions">
            <button type="button" onClick={() => openSettings("nastaveni-ucet")} disabled={loading} className="account-link">
              Účet
            </button>
            <button onClick={logout} disabled={loading} className="logout-link">
              Odhlásit
            </button>
          </div>
        </div>
      </header>

      <div className="app-layout">
        <aside className="app-sidebar" aria-label="Navigace aplikace">
          <nav className="menu-tabs" aria-label="Hlavní nabídka">
            <button
              onClick={() => setView("refuel")}
              disabled={loading}
              className={view === "refuel" ? "menu-link menu-link-active" : "menu-link"}
            >
              Přidání tankování
            </button>
            <button
              onClick={() => setView("stats")}
              disabled={loading}
              className={view === "stats" ? "menu-link menu-link-active" : "menu-link"}
            >
              Statistika
            </button>
            <button
              onClick={() => openSettings()}
              disabled={loading}
              className={view === "settings" ? "menu-link menu-link-active" : "menu-link"}
            >
              Nastavení
            </button>
          </nav>
          {error ? <p className="error">{error}</p> : null}
        </aside>

        <section className="app-content">

      {view === "refuel" ? (
        <>
          <section className="stats">
            <article>
              <span>Celkem tankování</span>
              <strong>{refuels.length}</strong>
            </article>
            <article>
              <span>Celková úspora</span>
              <strong>{totalSavings.toFixed(2)} CZK</strong>
            </article>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Přidání tankování</h2>
              <span className="hint">Uloží nový záznam do historie tankování.</span>
            </div>
            <div className="settings-form">
              {(() => {
                const sv = vehicles.find(v => v.id === selectedVehicleId);
                return sv?.fuel_type ? (
                  <div className="derived-value">
                    <span>Typ paliva vozidla</span>
                    <strong>{sv.fuel_type}</strong>
                  </div>
                ) : null;
              })()}
              <select
                value={newRefuel.station}
                onChange={(event) =>
                  setNewRefuel((prev) => ({
                    ...prev,
                    station: event.target.value,
                  }))
                }
              >
                {allStations.map((station) => (
                  <option key={station} value={station}>
                    {station}
                  </option>
                ))}
              </select>
              <select
                value={newRefuel.fuel_name}
                onChange={(event) =>
                  setNewRefuel((prev) => ({
                    ...prev,
                    fuel_name: event.target.value,
                  }))
                }
              >
                {refuelFuelOptions.length === 0 ? <option value="">Žádná paliva pro stanici</option> : null}
                {refuelFuelOptions.map((fuelName) => (
                  <option key={fuelName} value={fuelName}>
                    {fuelName}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newRefuel.refuel_date}
                onChange={(event) =>
                  setNewRefuel((prev) => ({
                    ...prev,
                    refuel_date: event.target.value,
                  }))
                }
              />
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="Stav km"
                value={newRefuel.mileage_km}
                onChange={(event) =>
                  setNewRefuel((prev) => ({
                    ...prev,
                    mileage_km: event.target.value,
                  }))
                }
              />
              <input
                type="number"
                step="0.001"
                min="0"
                placeholder="Množství (l)"
                value={newRefuel.volume_l}
                onChange={(event) =>
                  setNewRefuel((prev) => ({
                    ...prev,
                    volume_l: event.target.value,
                  }))
                }
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Cena / l"
                value={newRefuel.price_per_l}
                onChange={(event) =>
                  setNewRefuel((prev) => ({
                    ...prev,
                    price_per_l: event.target.value,
                  }))
                }
              />
              <div className="derived-value">
                <span>Zvýhodněná cena / l</span>
                <strong>
                  {configuredDiscountedPrice == null
                    ? 'není v nastavení'
                    : `${configuredDiscountedPrice.toFixed(2)} CZK`}
                </strong>
              </div>
              <div className="refuel-form-footer">
                <div className="refuel-options">
                  <label className="full-fill-toggle">
                    <input
                      type="checkbox"
                      checked={newRefuel.full_fill}
                      onChange={e => setNewRefuel(prev => ({ ...prev, full_fill: e.target.checked }))}
                    />
                    <span>Plné tankování (do plna)</span>
                  </label>
                  <label className="receipt-picker">
                    <span className="receipt-picker-label">Účtenka</span>
                    <span className="receipt-picker-hint">PDF, PNG, JPG nebo WebP, max. 10 MB</span>
                    <input
                      key={newRefuel.receipt ? newRefuel.receipt.name : "empty-receipt"}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      onChange={(event) => setNewRefuel((prev) => ({ ...prev, receipt: event.target.files?.[0] ?? null }))}
                    />
                  </label>
                </div>
                <button className="refuel-submit" onClick={createRefuel} disabled={loading || refuelFuelOptions.length === 0}>
                  Uložit tankování
                </button>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Historie tankování</h2>
            </div>
            {selectedRefuels.size > 0 && (
              <div className="settings-form bulk-actions">
                <span className="hint">Vybráno: {selectedRefuels.size} tankování</span>
                <button 
                  onClick={() => deleteMultipleRefuels(Array.from(selectedRefuels))} 
                  disabled={loading}
                  className="danger-button"
                >
                  Smazat vybrané
                </button>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selectedRefuels.size > 0 && selectedRefuels.size === refuels.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRefuels(new Set(refuels.map((r) => r.id)));
                        } else {
                          setSelectedRefuels(new Set());
                        }
                      }}
                    />
                  </th>
                  <th>Datum</th>
                  <th>Palivo</th>
                  <th style={{ textAlign: "right" }}>Stav km</th>
                  <th style={{ textAlign: "right" }}>Množství</th>
                  <th style={{ textAlign: "right" }}>Cena / L</th>
                  <th style={{ textAlign: "right" }}>Zvýh. cena / L</th>
                  <th style={{ textAlign: "right" }}>Zaplaceno</th>
                  <th style={{ textAlign: "right" }}>Úspora</th>
                  <th>Účtenka</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedRefuels.map((item) => {
                  const appliedDiscount = getAppliedDiscountedPricePerL(item);
                  const paid = item.discounted_total_price != null
                    ? Number(item.discounted_total_price)
                    : Number(item.total_price);
                  const savings = item.savings == null ? null : Number(item.savings);
                  return (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedRefuels.has(item.id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedRefuels);
                            if (e.target.checked) {
                              newSet.add(item.id);
                            } else {
                              newSet.delete(item.id);
                            }
                            setSelectedRefuels(newSet);
                          }}
                        />
                      </td>
                      <td>{formatDisplayDate(item.refuel_date)}</td>
                      <td>{item.fuel_name}</td>
                      <td style={{ textAlign: "right" }}>{item.mileage_km == null ? "–" : `${Number(item.mileage_km).toFixed(0)} km`}</td>
                      <td style={{ textAlign: "right" }}>{Number(item.volume_l).toFixed(2)} L</td>
                      <td style={{ textAlign: "right" }}>{Number(item.price_per_l).toFixed(2)} Kč</td>
                      <td style={{ textAlign: "right" }}>
                        {appliedDiscount == null ? "–" : `${appliedDiscount.toFixed(2)} Kč`}
                      </td>
                      <td style={{ textAlign: "right" }}>{paid.toFixed(2)} Kč</td>
                      <td style={{ textAlign: "right" }}>
                        {savings == null || savings === 0 ? "–" : (
                          <span style={{ color: "var(--color-success, #16a34a)", fontWeight: 500 }}>
                            {savings.toFixed(2)} Kč
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="receipt-actions">
                          {item.receipt_original_name ? (
                            <a
                              className="receipt-action"
                              href={`/api/refuels/${item.id}/receipt`}
                              target="_blank"
                              rel="noreferrer"
                              title={`Otevřít účtenku ${item.receipt_original_name}`}
                              aria-label={`Otevřít účtenku ${item.receipt_original_name}`}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                            </a>
                          ) : null}
                          <label
                            className={`receipt-action${receiptUploadingId === item.id ? " is-uploading" : ""}`}
                            title={receiptUploadingId === item.id ? "Nahrávání účtenky" : item.receipt_original_name ? "Nahradit účtenku" : "Nahrát účtenku"}
                          >
                            <span className="sr-only">{receiptUploadingId === item.id ? "Nahrávání účtenky" : item.receipt_original_name ? "Nahradit účtenku" : "Nahrát účtenku"}</span>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3M7 8l5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>
                            <input
                              type="file"
                              accept="application/pdf,image/png,image/jpeg,image/webp"
                              disabled={receiptUploadingId !== null}
                              style={{ display: "none" }}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) uploadReceipt(item.id, file);
                              }}
                            />
                          </label>
                          {item.receipt_original_name ? (
                            <span className="receipt-action receipt-action-static" title={item.receipt_original_name} aria-label={item.receipt_original_name}>
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ textAlign: "center", fontSize: 13 }} title={item.full_fill ? "Plné tankování" : "Dí lčí tankování"}>
                        {item.full_fill ? "🟢" : "▽"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {refuelPageCount > 1 && (
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", padding: "1rem 0", alignItems: "center" }}>
                <button
                  onClick={() => setRefuelPage(Math.max(0, refuelPage - 1))}
                  disabled={refuelPage === 0}
                  className="ghost"
                  style={{ padding: "0.5rem 1rem" }}
                >
                  ← Předchozí
                </button>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>
                  Strana {refuelPage + 1} z {refuelPageCount}
                </span>
                <button
                  onClick={() => setRefuelPage(Math.min(refuelPageCount - 1, refuelPage + 1))}
                  disabled={refuelPage === refuelPageCount - 1}
                  className="ghost"
                  style={{ padding: "0.5rem 1rem" }}
                >
                  Další →
                </button>
              </div>
            )}
          </section>
        </>
      ) : view === "stats" ? (
        <>
          <section className="card">
            <div className="card-header">
              <h2>Statistika</h2>
              {vehicles.find(v => v.id === selectedVehicleId) && (
                <span className="hint">Vozidlo: {vehicles.find(v => v.id === selectedVehicleId)?.name}</span>
              )}
            </div>
            <div className="stats-grid">
              <div className="stat-tile">
                <div className="stat-label">Celkový objem</div>
                <div className="stat-value">{stats.totalVolume} L</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Ø cena / L</div>
                <div className="stat-value">{stats.avgPricePerLiter} CZK</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Vyplaceno bez slev</div>
                <div className="stat-value">{stats.totalSpent} CZK</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Zaplaceno se slevou</div>
                <div className="stat-value success">{stats.totalPaidWithDiscount} CZK</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Počet paliv</div>
                <div className="stat-value">{stats.uniqueStations}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Odhad dojezdu (aktuální nádrž)</div>
                <div className="stat-value">
                  {rangeStats.currentRangeKm == null ? "-" : `${rangeStats.currentRangeKm.toFixed(0)} km`}
                </div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Dojezd při plné nádrži</div>
                <div className="stat-value">
                  {rangeStats.fullRangeKm == null ? "-" : `${rangeStats.fullRangeKm.toFixed(0)} km`}
                </div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Stav nádrže</div>
                <div className="stat-value">
                  {rangeStats.fuelLevelPct == null
                    ? "-"
                    : `${rangeStats.currentFuel?.toFixed(1)} / ${rangeStats.tankCapacity?.toFixed(1)} L`}
                </div>
                <div className={`fuel-status ${rangeStats.fuelLevelClass}`}>
                  {rangeStats.fuelLevelPct == null
                    ? "Zadej obsah a aktuální stav nádrže"
                    : `${rangeStats.fuelLevelLabel} (${rangeStats.fuelLevelPct.toFixed(0)} %)`}
                </div>
                <div className="fuel-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rangeStats.fuelLevelPct ?? 0}>
                  <div
                    className={`fuel-progress-fill ${rangeStats.fuelLevelClass}`}
                    style={{ width: `${rangeStats.fuelLevelPct ?? 0}%` }}
                  />
                </div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Celková úspora</div>
                <div className="stat-value info">{totalSavings.toFixed(2)} CZK</div>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <h2>Zvýhodněná cena paliva</h2>
              <span className="hint">Nakonfigurované slevy na stanicích · Kč / L</span>
            </div>
            <p className="hint" style={{ padding: "0.5rem 1.25rem 1.25rem" }}>Tento graf je nově dostupný v sekci Ceny paliv vedle formuláře pro přidání nové ceny.</p>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Cena na stojanu</h2>
              <span className="hint">Cena zaplacená při tankování · Kč / L</span>
            </div>
            {pumpChartConfig.every(s => s.data.length === 0) ? (
              <p className="hint" style={{ padding: "0.5rem 1.25rem 1.25rem" }}>Žádné záznamy tankování.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem", padding: "0 1.25rem 1.25rem" }}>
                {pumpChartConfig.filter(s => s.data.length > 0).map(({ station, data, keys }) => (
                  <div key={station}>
                    <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: "var(--brand)" }}>{station}</p>
                    <div style={{ height: 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 36 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #d2dbe8)" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={{ stroke: "var(--line)" }} tickLine={false} angle={-35} textAnchor="end" interval={Math.max(0, Math.floor(data.length / 5) - 1)} />
                          <YAxis unit=" Kč" width={68} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(2)} domain={[(min: number) => Math.floor((min - 0.5) * 2) / 2, (max: number) => Math.ceil((max + 0.5) * 2) / 2]} />
                          <Tooltip content={<ChartTooltip unit="Kč/L" />} />
                          <Legend verticalAlign="top" align="left" wrapperStyle={{ fontSize: 11, paddingBottom: 2, paddingLeft: 68 }} />
                          {keys.map((fn, i) => {
                            const [pumpColor] = getFuelColorPair(fn, i);
                            return <Line key={fn} dataKey={fn} name={fn} stroke={pumpColor} strokeWidth={2.5} dot={{ r: 3, fill: pumpColor, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} connectNulls={false} type="monotone" isAnimationActive={false} />;
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Útrata podle stanice</h2>
              <span className="hint">Podíl celkové utracené částky podle čerpací stanice</span>
            </div>
            {stationChartConfig.data.length === 0 ? (
              <p className="hint" style={{ padding: "0.5rem 1.25rem 1.25rem" }}>Žádné záznamy tankování.</p>
            ) : (
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart
                    data={stationChartConfig.data}
                    margin={{ top: 8, right: 16, left: 16, bottom: 8 }}
                  >
                    <Pie
                      data={stationChartConfig.data}
                      dataKey="value"
                      nameKey="station"
                      cx="50%"
                      cy="50%"
                      outerRadius="78%"
                      isAnimationActive={false}
                      label={({ percent }) => `${((percent ?? 0) * 100).toFixed(1)} %`}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const value = Number(payload[0]?.value) || 0;
                        const pct = stationChartConfig.total > 0 ? (value / stationChartConfig.total) * 100 : 0;
                        return (
                          <div style={{ background: "var(--card-solid, #fff)", border: "1px solid var(--line, #d2dbe8)", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(30,52,85,0.10)", minWidth: 160 }}>
                            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{String(label || payload[0]?.name || "Stanice")}</p>
                            <p style={{ margin: "2px 0", display: "flex", gap: 8, justifyContent: "space-between" }}>
                              <span>Útrata</span>
                              <strong>{value.toFixed(0)} Kč</strong>
                            </p>
                            <p style={{ margin: "2px 0", display: "flex", gap: 8, justifyContent: "space-between" }}>
                              <span>Podíl</span>
                              <strong>{pct.toFixed(1)} %</strong>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
        <div className="settings-page">
          <nav className="settings-toolbar" aria-label="Nastavení">
            <button type="button" onClick={() => openSettings("nastaveni-vozidla")} disabled={loading} className={settingsPage === "vehicles" ? "tab-active" : undefined}>
              Vozidla
            </button>
            <button type="button" onClick={() => openSettings("nastaveni-stanice")} disabled={loading} className={settingsPage === "stations" ? "tab-active" : undefined}>
              Stanice &amp; Paliva
            </button>
            <button type="button" onClick={() => openSettings("nastaveni-ceny")} disabled={loading} className={settingsPage === "prices" ? "tab-active" : undefined}>
              Ceny paliv
            </button>
          </nav>

        {settingsPage === "account" ? (
        <section className="card" id="nastaveni-ucet">
          <div className="card-header">
            <h2>Účet</h2>
            <span className="hint">{authUser.email}</span>
          </div>
          <form className="settings-blocks" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void passwordForm.handleSubmit(); }}>
            <section>
              <h3>Změna hesla</h3>
              <div className="settings-form password-settings-form">
                {authUser.hasPassword ? (
                  <passwordForm.Field name="currentPassword">
                    {(field) => (
                      <input
                        type="password"
                        placeholder="Aktuální heslo"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        autoComplete="current-password"
                        required
                      />
                    )}
                  </passwordForm.Field>
                ) : null}
                <passwordForm.Field name="newPassword">
                  {(field) => (
                    <input
                      type="password"
                      placeholder="Nové heslo"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  )}
                </passwordForm.Field>
                <passwordForm.Field name="confirmPassword">
                  {(field) => (
                    <input
                      type="password"
                      placeholder="Potvrzení nového hesla"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  )}
                </passwordForm.Field>
                <button type="submit" disabled={loading}>Změnit heslo</button>
              </div>
              {passwordMessage ? <p className={passwordMessage.includes("změněno") ? "success-message" : "error"}>{passwordMessage}</p> : null}
            </section>
          </form>
        </section>
        ) : null}

        {settingsPage === "vehicles" ? (
        <section className="card" id="nastaveni-vozidla">
          <div className="card-header">
            <h2>Vozidla</h2>
            <span className="hint">{vehicles.length} vozidel</span>
          </div>
          <div className="settings-blocks">
            <section>
              <h3>Přidat vozidlo</h3>
              <div className="settings-form">
                <input type="text" placeholder="Název" value={newVehicle.name} onChange={e => setNewVehicle(p => ({...p, name: e.target.value}))} />
                <input type="text" placeholder="Typ auta" value={newVehicle.car_type} onChange={e => setNewVehicle(p => ({...p, car_type: e.target.value}))} />
                <select value={newVehicle.fuel_type} onChange={e => setNewVehicle(p => ({...p, fuel_type: e.target.value}))}>
                  {FUEL_TYPE_OPTIONS.map(ft => (
                    <option key={ft} value={ft}>{ft === '' ? 'Typ paliva (nevybráno)' : ft}</option>
                  ))}
                </select>
                <input type="number" step="0.1" min="0" placeholder="Obsah nádrže (L)" value={newVehicle.tank_capacity_l} onChange={e => setNewVehicle(p => ({...p, tank_capacity_l: e.target.value}))} />
                <input type="number" step="0.1" min="0" placeholder="Aktuální palivo (L)" value={newVehicle.current_fuel_l} onChange={e => setNewVehicle(p => ({...p, current_fuel_l: e.target.value}))} />
                <input type="number" step="0.1" min="0" placeholder="Spotřeba (L/100 km)" value={newVehicle.avg_consumption_l100} onChange={e => setNewVehicle(p => ({...p, avg_consumption_l100: e.target.value}))} />
                <input type="number" step="1" min="0" placeholder="Počáteční stav km (od kdy počítat)" value={newVehicle.initial_mileage_km} onChange={e => setNewVehicle(p => ({...p, initial_mileage_km: e.target.value}))} />
                <input type="text" placeholder="Poznámka" value={newVehicle.note} onChange={e => setNewVehicle(p => ({...p, note: e.target.value}))} />
                <button onClick={createVehicle} disabled={loading}>Přidat vozidlo</button>
              </div>
            </section>
            {editingVehicle && (
              <section>
                <h3>Upravit vozidlo</h3>
                <div className="settings-form">
                  <input type="text" placeholder="Název" value={editingVehicle.name} onChange={e => setEditingVehicle(p => p && ({...p, name: e.target.value}))} />
                  <input type="text" placeholder="Typ auta" value={editingVehicle.car_type} onChange={e => setEditingVehicle(p => p && ({...p, car_type: e.target.value}))} />
                  <select value={editingVehicle.fuel_type} onChange={e => setEditingVehicle(p => p && ({...p, fuel_type: e.target.value}))}>
                    {FUEL_TYPE_OPTIONS.map(ft => (
                      <option key={ft} value={ft}>{ft === '' ? 'Typ paliva (nevybráno)' : ft}</option>
                    ))}
                  </select>
                  <input type="number" step="0.1" min="0" placeholder="Obsah nádrže (L)" value={editingVehicle.tank_capacity_l} onChange={e => setEditingVehicle(p => p && ({...p, tank_capacity_l: e.target.value}))} />
                  <input type="number" step="0.1" min="0" placeholder="Aktuální palivo (L)" value={editingVehicle.current_fuel_l} onChange={e => setEditingVehicle(p => p && ({...p, current_fuel_l: e.target.value}))} />
                  <input type="number" step="0.1" min="0" placeholder="Spotřeba (L/100 km)" value={editingVehicle.avg_consumption_l100} onChange={e => setEditingVehicle(p => p && ({...p, avg_consumption_l100: e.target.value}))} />
                  <input type="number" step="1" min="0" placeholder="Počáteční stav km (od kdy počítat)" value={editingVehicle.initial_mileage_km} onChange={e => setEditingVehicle(p => p && ({...p, initial_mileage_km: e.target.value}))} />
                  <input type="text" placeholder="Poznámka" value={editingVehicle.note} onChange={e => setEditingVehicle(p => p && ({...p, note: e.target.value}))} />
                  <button onClick={updateVehicle} disabled={loading}>Uložit změny</button>
                  <button className="ghost" onClick={() => setEditingVehicle(null)} disabled={loading}>Zrušit</button>
                </div>
              </section>
            )}
          </div>
          {vehicles.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Název</th>
                  <th>Typ</th>
                  <th>Palivo</th>
                  <th>Nádrž</th>
                  <th>Palivo</th>
                  <th>Spotřeba</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id}>
                    <td>{v.name || '–'}</td>
                    <td>{v.car_type || '–'}</td>
                    <td>{v.fuel_type || '–'}</td>
                    <td>{v.tank_capacity_l != null ? `${Number(v.tank_capacity_l).toFixed(1)} L` : '–'}</td>
                    <td>{v.current_fuel_l != null ? `${Number(v.current_fuel_l).toFixed(1)} L` : '–'}</td>
                    <td>{v.avg_consumption_l100 != null ? `${Number(v.avg_consumption_l100).toFixed(1)} L/100` : '–'}</td>
                    <td>
                      <div className="cell-actions">
                        <button
                          className={v.id === selectedVehicleId ? 'tab-active' : 'ghost'}
                          onClick={() => setSelectedVehicleId(v.id)}
                          disabled={loading}
                        >
                          {v.id === selectedVehicleId ? 'Aktivní' : 'Vybrat'}
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setEditingVehicle({ id: v.id, name: v.name, car_type: v.car_type, fuel_type: v.fuel_type, tank_capacity_l: v.tank_capacity_l != null ? String(v.tank_capacity_l) : '', current_fuel_l: v.current_fuel_l != null ? String(v.current_fuel_l) : '', avg_consumption_l100: v.avg_consumption_l100 != null ? String(v.avg_consumption_l100) : '', initial_mileage_km: v.initial_mileage_km != null ? String(v.initial_mileage_km) : '', note: v.note })}
                          disabled={loading}
                        >
                          Upravit
                        </button>
                        <button className="danger-button" onClick={() => deleteVehicle(v.id)} disabled={loading}>Smazat</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        ) : null}

        {settingsPage === "stations" ? (
        <section className="card" id="nastaveni-stanice">
          <div className="card-header">
            <h2>Stanice &amp; Paliva</h2>
            <span className="hint">Správa čerpacích stanic a druhů paliv.</span>
          </div>
          <div className="settings-blocks">
            <section>
              <h3>Nová stanice</h3>
              <div className="settings-form">
                <input
                  type="text"
                  placeholder="Název stanice (např. SHELL, BP)"
                  value={newStation}
                  onChange={(event) =>
                    setNewStation((prev) => event.target.value)
                  }
                />
                <button onClick={createStation} disabled={loading}>
                  Přidat stanici
                </button>
              </div>
            </section>
            
            <section>
              <h3>Nové palivo</h3>
              <div className="settings-form">
                <select
                  value={newFuel.station}
                  onChange={(event) =>
                    setNewFuel((prev) => ({
                      ...prev,
                      station: event.target.value,
                    }))
                  }
                >
                  {allStations.map((station) => (
                    <option key={station} value={station}>
                      {station}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Název nového paliva"
                  value={newFuel.fuel_name}
                  onChange={(event) =>
                    setNewFuel((prev) => ({
                      ...prev,
                      fuel_name: event.target.value,
                    }))
                  }
                />
                <select
                  value={newFuel.fuel_type}
                  onChange={(event) =>
                    setNewFuel((prev) => ({
                      ...prev,
                      fuel_type: event.target.value,
                    }))
                  }
                >
                  {FUEL_TYPE_OPTIONS.map(ft => (
                    <option key={ft} value={ft}>{ft === '' ? 'Typ paliva (nevybráno)' : ft}</option>
                  ))}
                </select>
                <button onClick={createFuel} disabled={loading}>
                  Přidat palivo
                </button>
              </div>
            </section>
            {editingFuel && (
              <section>
                <h3>Upravit palivo</h3>
                <div className="settings-form">
                  <input
                    type="text"
                    placeholder="Stanice"
                    value={editingFuel.station}
                    disabled
                  />
                  <input
                    type="text"
                    placeholder="Název paliva"
                    value={editingFuel.fuel_name}
                    onChange={e => setEditingFuel(p => p && ({ ...p, fuel_name: e.target.value }))}
                  />
                  <select
                    value={editingFuel.fuel_type}
                    onChange={e => setEditingFuel(p => p && ({ ...p, fuel_type: e.target.value }))}
                  >
                    {FUEL_TYPE_OPTIONS.map(ft => (
                      <option key={ft} value={ft}>{ft === '' ? 'Typ paliva (nevybráno)' : ft}</option>
                    ))}
                  </select>
                  <button onClick={updateFuel} disabled={loading}>Uložit změny</button>
                  <button className="ghost" onClick={() => setEditingFuel(null)} disabled={loading}>Zrušit</button>
                </div>
              </section>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Stanice</th>
                <th>Název paliva</th>
                <th>Typ paliva</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {fuels.map((fuel) => (
                <tr key={fuel.id}>
                  <td>{fuel.station}</td>
                  <td>{fuel.fuel_name}</td>
                  <td>{fuel.fuel_type || '–'}</td>
                  <td>
                    <div className="cell-actions">
                      <button
                        className="ghost"
                        onClick={() => setEditingFuel({ id: fuel.id, station: fuel.station, fuel_name: fuel.fuel_name, fuel_type: fuel.fuel_type })}
                        disabled={loading}
                      >
                        Upravit
                      </button>
                      <button className="danger-button" onClick={() => deleteFuel(fuel.id)} disabled={loading}>Smazat</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        ) : null}

        {settingsPage === "prices" ? (
        <section className="card" id="nastaveni-ceny">
          <div className="card-header">
            <h2>Ceny paliv</h2>
            <span className="hint">Správa zvýhodněných cen paliv podle stanice.</span>
          </div>
          <div className="price-editor-layout">
            <section className="price-editor-panel">
              <h3>Nová cena</h3>
              <div className="settings-form">
                <select
                  value={newPrice.station}
                  onChange={(event) =>
                    setNewPrice((prev) => ({
                      ...prev,
                      station: event.target.value,
                      fuel_name: '',
                    }))
                  }
                >
                  {allStations.map((station) => (
                    <option key={station} value={station}>
                      {station}
                    </option>
                  ))}
                </select>
                <select
                  value={newPrice.fuel_name}
                  onChange={(event) =>
                    setNewPrice((prev) => ({
                      ...prev,
                      fuel_name: event.target.value,
                    }))
                  }
                >
                  <option value="">Vyber palivo</option>
                  {(fuelOptionsByStation.get(newPrice.station) ?? []).map((fuelName) => (
                    <option key={fuelName} value={fuelName}>
                      {fuelName}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newPrice.price_date}
                  onChange={(event) =>
                    setNewPrice((prev) => ({
                      ...prev,
                      price_date: event.target.value,
                    }))
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Cena"
                  value={newPrice.price}
                  onChange={(event) =>
                    setNewPrice((prev) => ({
                      ...prev,
                      price: event.target.value,
                    }))
                  }
                />
                <button onClick={createPrice} disabled={loading}>
                  Přidat cenu
                </button>
              </div>
            </section>
            <section className="price-editor-panel">
              <h3>Zvýhodněná cena paliva</h3>
              <div className="price-chart-body">
                {discountChartConfig.every(s => s.data.length === 0) ? (
                  <p className="hint" style={{ margin: 0 }}>Žádné záznamy zvýhodněných cen.</p>
                ) : (
                  <div className="price-chart-grid">
                    {discountChartConfig.filter(s => s.data.length > 0).map(({ station, data, keys }) => (
                      <div key={station}>
                        <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: "var(--brand)" }}>{station}</p>
                        <div style={{ height: 220 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 36 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #d2dbe8)" vertical={false} />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={{ stroke: "var(--line)" }} tickLine={false} angle={-35} textAnchor="end" interval={Math.max(0, Math.floor(data.length / 5) - 1)} />
                              <YAxis unit=" Kč" width={68} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(2)} domain={[(min: number) => Math.floor((min - 0.5) * 2) / 2, (max: number) => Math.ceil((max + 0.5) * 2) / 2]} />
                              <Tooltip content={<ChartTooltip unit="Kč/L" />} />
                              <Legend verticalAlign="top" align="left" wrapperStyle={{ fontSize: 11, paddingBottom: 2, paddingLeft: 68 }} />
                              {keys.map((fn, i) => {
                                const [, discColor] = getFuelColorPair(fn, i);
                                return <Line key={fn} dataKey={fn} name={fn} stroke={discColor} strokeWidth={2.5} dot={{ r: 3, fill: discColor, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} connectNulls={false} type="monotone" isAnimationActive={false} />;
                              })}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
          <div className="settings-form">
            <span className="hint">Uložené cenové záznamy jsou pouze ke čtení. Pro novou cenu přidej nový záznam, starý lze jen smazat.</span>
          </div>
          <div className="settings-form">
            <select
              value={priceFilterStation}
              onChange={(e) => {
                setPriceFilterStation(e.target.value);
                setPriceFilterFuelName("");
              }}
            >
              <option value="">Všechny stanice</option>
              {allStations.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={priceFilterFuelName}
              onChange={(e) => setPriceFilterFuelName(e.target.value)}
            >
              <option value="">Všechna paliva</option>
              {priceFilterFuelOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <input
              type="date"
              value={priceFilterDateFrom}
              onChange={(e) => setPriceFilterDateFrom(e.target.value)}
              title="Datum od"
              placeholder="Datum od"
            />
            <input
              type="date"
              value={priceFilterDateTo}
              onChange={(e) => setPriceFilterDateTo(e.target.value)}
              title="Datum do"
              placeholder="Datum do"
            />
            {(priceFilterStation || priceFilterFuelName || priceFilterDateFrom || priceFilterDateTo) && (
              <button className="ghost" onClick={() => { setPriceFilterStation(""); setPriceFilterFuelName(""); setPriceFilterDateFrom(""); setPriceFilterDateTo(""); }}>
                Zrušit filtr
              </button>
            )}
            <span className="hint">{filteredPrices.length} / {prices.length} záznamů</span>
          </div>
          {selectedPrices.size > 0 && (
            <div className="settings-form bulk-actions">
              <span className="hint">Vybráno: {selectedPrices.size} cen</span>
              <button 
                onClick={() => deleteMultiplePrices(Array.from(selectedPrices))} 
                disabled={loading}
                className="danger-button"
              >
                Smazat vybrané
              </button>
            </div>
          )}
          {groupedPricesByStation.length === 0 ? (
            <p className="hint" style={{ padding: "0.5rem 1.25rem 1.25rem" }}>Žádné cenové záznamy pro zadaný filtr.</p>
          ) : (
            <div className="price-history-grid">
            {groupedPricesByStation.map((group) => {
              const page = pricePagesByStation[group.station] ?? 0;
              const pageCount = Math.ceil(group.rows.length / pricePageSize);
              const pageRows = group.rows.slice(page * pricePageSize, (page + 1) * pricePageSize);
              const allRowsOnPageSelected = pageRows.length > 0 && pageRows.every((row) => selectedPrices.has(row.id));
              const latestStationPrice = latestPriceDateByStation.get(group.station);

              return (
                <div key={group.station} className="price-history-group">
                  <div className="card-header" style={{ padding: "0 1.25rem", marginTop: "0.75rem" }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{group.station}</h3>
                      <span className="hint">
                        Poslední vložená zvýhodněná cena: {latestStationPrice ? formatDisplayDate(latestStationPrice.date) : "–"}
                      </span>
                    </div>
                    <span className="hint">{group.rows.length} záznamů</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            checked={allRowsOnPageSelected}
                            onChange={(e) => {
                              const newSet = new Set(selectedPrices);
                              if (e.target.checked) {
                                for (const row of pageRows) {
                                  newSet.add(row.id);
                                }
                              } else {
                                for (const row of pageRows) {
                                  newSet.delete(row.id);
                                }
                              }
                              setSelectedPrices(newSet);
                            }}
                          />
                        </th>
                        <th>Palivo</th>
                        <th>Platnost</th>
                        <th>Cena / L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPrices.has(row.id)}
                              onChange={(e) => {
                                const newSet = new Set(selectedPrices);
                                if (e.target.checked) {
                                  newSet.add(row.id);
                                } else {
                                  newSet.delete(row.id);
                                }
                                setSelectedPrices(newSet);
                              }}
                            />
                          </td>
                          <td>{row.fuel_name}</td>
                          <td>{formatDisplayDate(row.price_date)}</td>
                          <td>{Number(row.price).toFixed(2)} CZK</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pageCount > 1 && (
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", padding: "1rem 0", alignItems: "center" }}>
                      <button
                        onClick={() => setPricePagesByStation((prev) => ({ ...prev, [group.station]: Math.max(0, page - 1) }))}
                        disabled={page === 0}
                        className="ghost"
                        style={{ padding: "0.5rem 1rem" }}
                      >
                        ← Předchozí
                      </button>
                      <span style={{ fontSize: 14, color: "var(--muted)" }}>
                        Strana {page + 1} z {pageCount}
                      </span>
                      <button
                        onClick={() => setPricePagesByStation((prev) => ({ ...prev, [group.station]: Math.min(pageCount - 1, page + 1) }))}
                        disabled={page >= pageCount - 1}
                        className="ghost"
                        style={{ padding: "0.5rem 1rem" }}
                      >
                        Další →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </section>
        ) : null}
        </div>
        </>
      )}
        </section>
      </div>
    </main>
  );
}
