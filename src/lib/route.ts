// URL state: which page, session, request, view and step is open, kept in `location.hash` so links can be
// shared, bookmarked and reopened, and back/forward work. Pure parse/format functions (checked by
// scripts/route.check.mts) plus the `useRoute` hook.
//
// Hash forms (every value is encodeURIComponent-ed, so file paths may hold spaces, #, %, \ and :):
//   ""                                  default: newest session, Map view
//   #/s/<file>/<turn>/<view>?step=<id>  a session; <turn> (0-based request index) is optional and
//                                       absent means "follow the newest request"; ?step is optional
//   #/s?project=<dir>&view=<view>       a project with no session picked yet
//   #/dashboard  #/live  #/bookmarks
//   #/search?q=<text>
//   #/compare?a=<file>&b=<file>         a -> route.file, b -> route.other
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type SessionView = "map" | "conversation" | "stats" | "health" | "files" | "agents" | "flow";
export type AppPage = "session" | "dashboard" | "live" | "search" | "compare" | "bookmarks";

export type Route = {
  page: AppPage;
  project?: string;
  file?: string;
  turn?: number;
  view: SessionView;
  step?: string;
  q?: string;
  other?: string;
};

export type Navigate = (patch: Partial<Route>, replace?: boolean) => void;

/** Props every app page (dashboard, live, search, compare, bookmarks) receives from page.tsx. */
export type AppPageProps = {
  route: Route;
  /** Merges `patch` into the current route. `navigate({ page: "session" })` returns to the last open session. */
  navigate: Navigate;
};

export const SESSION_VIEW_IDS: SessionView[] = ["map", "conversation", "agents", "stats", "health", "files", "flow"];
const PAGES: AppPage[] = ["session", "dashboard", "live", "search", "compare", "bookmarks"];

const defaultRoute = (): Route => ({ page: "session", view: "map" });
const isView = (v: string | undefined): v is SessionView => !!v && (SESSION_VIEW_IDS as string[]).includes(v);

const enc = encodeURIComponent;

function query(pairs: [string, string | undefined][]) {
  const s = pairs.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${enc(v!)}`);
  return s.length ? `?${s.join("&")}` : "";
}

/** Reads a hash (with or without the leading "#"). Anything malformed gives the default route. */
export function parseRoute(hash: string): Route {
  try {
    const raw = hash.replace(/^#/, "");
    if (!raw.startsWith("/")) return defaultRoute();
    const qAt = raw.indexOf("?");
    const segs = (qAt < 0 ? raw : raw.slice(0, qAt)).split("/").slice(1).map(decodeURIComponent);
    const params: Record<string, string> = {};
    if (qAt >= 0) {
      for (const part of raw.slice(qAt + 1).split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const k = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
        params[k] = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
      }
    }
    const [head, ...rest] = segs;
    if (!head && rest.length === 0) return defaultRoute();
    if (head !== "s" && (head === "session" || !(PAGES as string[]).includes(head))) return defaultRoute();

    if (head === "s") {
      const r: Route = { page: "session", view: "map" };
      if (params.project !== undefined) r.project = params.project;
      const [file, ...tail] = rest;
      if (file) {
        r.file = file;
        if (tail[0] !== undefined && /^\d+$/.test(tail[0])) r.turn = Number(tail.shift());
        if (isView(tail[0])) r.view = tail[0];
      } else if (isView(params.view)) {
        r.view = params.view;
      }
      if (params.step !== undefined) r.step = params.step;
      return order(r);
    }
    const r: Route = { page: head as AppPage, view: "map" };
    if (head === "search" && params.q !== undefined) r.q = params.q;
    if (head === "compare") {
      if (params.a !== undefined) r.file = params.a;
      if (params.b !== undefined) r.other = params.b;
    }
    return r;
  } catch {
    return defaultRoute(); // malformed %-escape
  }
}

// Stable key order keeps deep-equal comparisons (and logs) predictable.
function order(r: Route): Route {
  const out: Route = { page: r.page } as Route;
  if (r.project !== undefined) out.project = r.project;
  if (r.file !== undefined) out.file = r.file;
  if (r.turn !== undefined) out.turn = r.turn;
  out.view = r.view;
  if (r.step !== undefined) out.step = r.step;
  return out;
}

/** The canonical hash for a route ("" for the default route). Fields a page doesn't use are dropped. */
export function formatRoute(r: Route): string {
  switch (r.page) {
    case "dashboard":
    case "live":
    case "bookmarks":
      return `#/${r.page}`;
    case "search":
      return `#/search${query([["q", r.q]])}`;
    case "compare":
      return `#/compare${query([["a", r.file], ["b", r.other]])}`;
  }
  const view = isView(r.view) ? r.view : "map";
  if (r.file) {
    const turn = r.turn !== undefined && Number.isInteger(r.turn) && r.turn >= 0 ? `/${r.turn}` : "";
    return `#/s/${enc(r.file)}${turn}/${view}${query([["step", r.step], ["project", r.project]])}`;
  }
  const q = query([["project", r.project], ["view", view === "map" ? undefined : view], ["step", r.step]]);
  return q ? `#/s${q}` : "";
}

// --- React hook ------------------------------------------------------------------------------------

const ROUTE_EVENT = "cc-trace:route"; // pushState/replaceState don't fire hashchange

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  window.addEventListener(ROUTE_EVENT, cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
    window.removeEventListener(ROUTE_EVENT, cb);
  };
}
const getHash = () => window.location.hash;
const getServerHash = () => "";

/**
 * The current route and a function that changes it. `navigate(patch)` merges `patch` into the current
 * route (pass `undefined` to clear a field) and adds a history entry; `replace` rewrites the current one.
 */
export function useRoute(): [Route, Navigate] {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const navigate = useCallback<Navigate>((patch, replace = false) => {
    const next = formatRoute({ ...parseRoute(window.location.hash), ...patch });
    if (next === formatRoute(parseRoute(window.location.hash))) return;
    const url = window.location.pathname + window.location.search + next;
    try {
      if (replace) window.history.replaceState(window.history.state, "", url);
      else window.history.pushState(window.history.state, "", url);
    } catch {
      window.location.hash = next; // history API blocked: plain hash change still works
      return;
    }
    window.dispatchEvent(new Event(ROUTE_EVENT));
  }, []);
  return [route, navigate];
}
