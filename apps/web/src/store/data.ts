import {
  fetchLbmaSince,
  GoldTable,
  lbmaToDaily,
  type MonthlyEntry,
  parseMonthlyCsv,
} from "@goldvalue/core";
import { signal } from "@preact/signals";
import { createStore, del, get, set, type UseStore } from "idb-keyval";
import { attemptAllowed, isDailyStale, REFRESH_INTERVAL_MS } from "../lib/clock";
import { readFlag, readNumber, writeFlag, writeNumber } from "./storage";

const ATTEMPT_KEY = "goldvalue:v1:lbma-attempt";
const FAILED_KEY = "goldvalue:v1:lbma-attempt-failed";
const IDB_KEY = "lbma-daily";
const FETCH_TIMEOUT_MS = 90_000;

export type MonthlyStatus =
  | { state: "loading" }
  | { state: "ready"; lastMonth: string | null }
  | { state: "unavailable"; error: string };

export interface DailyStatus {
  phase: "idle" | "loading" | "ready" | "failed";
  /** Latest fix date in the table in use, or null when no daily data is loaded. */
  lastFix: string | null;
  /** Epoch ms of the last completed download, or null. */
  fetchedAt: number | null;
  error: string | null;
  /** False when the browser refused to store the table (it lasts for this visit only). */
  saved: boolean;
}

/** Epoch ms of the last download attempt (successful or not), kept in localStorage. */
export const lastAttempt = signal<number | null>(readNumber(ATTEMPT_KEY));
/** True after a failed attempt; a manual refresh may then retry inside the 12 h window. */
export const lastAttemptFailed = signal<boolean>(readFlag(FAILED_KEY));

/** Whether "Refresh" is allowed at `now` (spec 6.3.2 limit, but failures may be retried). */
export function manualRefreshAllowed(now: number): boolean {
  return attemptAllowed(lastAttempt.value, now) || lastAttemptFailed.value;
}

/** Earliest time the next non-retry refresh is allowed, or null when allowed now. */
export function nextRefreshAt(): number | null {
  const last = lastAttempt.value;
  return last === null ? null : last + REFRESH_INTERVAL_MS;
}

export const monthlyStatus = signal<MonthlyStatus>({ state: "loading" });
export const dailyStatus = signal<DailyStatus>({
  phase: "idle",
  lastFix: null,
  fetchedAt: null,
  error: null,
  saved: true,
});
/** The price tables the sheet computes from; null until the monthly series has loaded. */
export const table = signal<GoldTable | null>(null);

let monthly: MonthlyEntry[] = [];
let store: UseStore | undefined;
const idb = () => {
  store ??= createStore("goldvalue", "kv");
  return store;
};

interface StoredDaily {
  v: 1;
  daily: [string, number][];
  fetchedAt: number;
}

function isStoredDaily(value: unknown): value is StoredDaily {
  if (typeof value !== "object" || value === null) return false;
  const { v, daily, fetchedAt } = value as Partial<StoredDaily>;
  return (
    v === 1 &&
    typeof fetchedAt === "number" &&
    Array.isArray(daily) &&
    daily.every((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number")
  );
}

function useDaily(daily: [string, number][], fetchedAt: number, saved: boolean): void {
  const next = new GoldTable(daily, monthly);
  table.value = next;
  dailyStatus.value = {
    phase: "ready",
    lastFix: next.lastDaily,
    fetchedAt,
    error: null,
    saved,
  };
}

/**
 * Only the Lighthouse CI build sets VITE_LBMA_BASE, pointing at the synthetic fixture
 * served next to the app so the run never touches the real LBMA feed. Production
 * builds leave it unset and use the LBMA URLs from core unchanged.
 */
const LBMA_BASE = import.meta.env.VITE_LBMA_BASE as string | undefined;

function lbmaUrl(url: string): string {
  if (!LBMA_BASE) return url;
  return new URL(url.slice(url.lastIndexOf("/") + 1), new URL(LBMA_BASE, location.href)).href;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function readCached(): Promise<StoredDaily | null> {
  try {
    const value = await get(IDB_KEY, idb());
    return isStoredDaily(value) ? value : null;
  } catch {
    return null;
  }
}

const PERSIST_KEY = "goldvalue:v1:persist-requested";

/** Ask once for durable storage so the browser keeps the LBMA table (spec 6.3.3). */
async function requestPersistence(): Promise<void> {
  try {
    if (!navigator.storage?.persist || localStorage.getItem(PERSIST_KEY)) return;
    localStorage.setItem(PERSIST_KEY, "1");
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Persistence is best effort.
  }
}

let inflight: Promise<"refreshed" | "skipped" | "failed"> | null = null;

/**
 * Download the LBMA history in the visitor's browser (spec 6.3.2) and keep it in
 * IndexedDB. Never called with `ignoreRateLimit` except for the first-ever download.
 */
export function refreshDaily(options: { ignoreRateLimit?: boolean; manual?: boolean } = {}) {
  if (inflight) return inflight;
  const allowed = options.manual
    ? manualRefreshAllowed(Date.now())
    : attemptAllowed(readNumber(ATTEMPT_KEY), Date.now());
  if (!options.ignoreRateLimit && !allowed) {
    return Promise.resolve("skipped" as const);
  }
  inflight = (async () => {
    const startedAt = Date.now();
    writeNumber(ATTEMPT_KEY, startedAt);
    lastAttempt.value = startedAt;
    dailyStatus.value = { ...dailyStatus.value, phase: "loading", error: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const rows = await fetchLbmaSince(
        (url) => fetch(lbmaUrl(url), { cache: "no-store", signal: controller.signal }),
        null,
      );
      const daily = lbmaToDaily(rows);
      if (daily.length === 0) throw new Error("LBMA returned no prices");
      const fetchedAt = Date.now();
      let saved = true;
      try {
        await set(IDB_KEY, { v: 1, daily, fetchedAt } satisfies StoredDaily, idb());
      } catch {
        saved = false;
      }
      writeFlag(FAILED_KEY, false);
      lastAttemptFailed.value = false;
      useDaily(daily, fetchedAt, saved);
      if (saved) void requestPersistence();
      return "refreshed" as const;
    } catch (error) {
      writeFlag(FAILED_KEY, true);
      lastAttemptFailed.value = true;
      dailyStatus.value = {
        ...dailyStatus.value,
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      return "failed" as const;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget the stored LBMA table (used when the stored copy is unusable). */
export async function clearDailyCache(): Promise<void> {
  try {
    await del(IDB_KEY, idb());
  } catch {
    // Nothing to clear.
  }
}

function afterInteractive(task: () => void): void {
  const run = () => setTimeout(task, 0);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 300);
}

/**
 * Spec 6.3.2 boot: manifest and monthly series -> stored LBMA table -> immediate
 * download when there is none, otherwise a rate-limited top-up after the sheet is
 * interactive. Rows compute from the monthly series until daily data exists.
 */
export async function boot(): Promise<void> {
  monthlyStatus.value = { state: "loading" };
  const base = import.meta.env.BASE_URL;
  let lastMonth: string | null = null;
  try {
    const [manifestText, monthlyText] = await Promise.all([
      fetchText(`${base}data/manifest.json`).catch(() => null),
      fetchText(`${base}data/monthly.csv`),
    ]);
    monthly = parseMonthlyCsv(monthlyText);
    if (manifestText !== null) {
      try {
        const manifest = JSON.parse(manifestText) as {
          files?: Record<string, { last_date?: string }>;
        };
        lastMonth = manifest.files?.["monthly.csv"]?.last_date ?? null;
      } catch {
        lastMonth = null;
      }
    }
    lastMonth ??= (monthly.at(-1)?.[0] as string | undefined) ?? null;
  } catch (error) {
    monthlyStatus.value = {
      state: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
    return;
  }

  const cached = await readCached();
  if (cached) useDaily(cached.daily, cached.fetchedAt, true);
  else table.value = new GoldTable([], monthly);
  monthlyStatus.value = { state: "ready", lastMonth };

  if (!cached) {
    void refreshDaily({ ignoreRateLimit: true });
  } else if (isDailyStale(table.value?.lastDaily ?? null)) {
    afterInteractive(() => void refreshDaily());
  }
}
