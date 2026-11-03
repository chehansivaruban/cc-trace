"use client";

import { useEffect, useState } from "react";
import { isDroppedFile } from "@/lib/paths";
import type { AgentLog, AgentMeta, LogRecord } from "@/lib/session";

export type SessionLogs = { main: LogRecord[]; agents: Record<string, AgentLog> };

const EMPTY: SessionLogs = { main: [], agents: {} };

/**
 * Tails one session log and its sub-agent logs over SSE. `ready` turns true once the server has replayed
 * everything (its "ready" event) and those records are applied, so numbers shown before it are partial; it
 * goes back to false on a new file and on every reconnect (which replays everything again).
 */
export function useSessionStream(file: string | null) {
  const [logs, setLogs] = useState<SessionLogs>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLogs(EMPTY);
    setConnected(false);
    setReady(false);
    // A dropped file is read in the browser; the server only streams logs in the Claude folder.
    if (!file || isDroppedFile(file)) return;

    // The initial replay can be hundreds of events; apply them once per frame, not one render each.
    let queued: ((l: SessionLogs) => SessionLogs)[] = [];
    let readyQueued = false;
    let frame = 0;
    const flush = () => {
      frame ||= requestAnimationFrame(() => {
        const fns = queued;
        const nowReady = readyQueued;
        queued = [];
        readyQueued = false;
        frame = 0;
        if (fns.length) setLogs((l) => fns.reduce((acc, f) => f(acc), l));
        if (nowReady) setReady(true); // in the same render as the last replayed records
      });
    };
    const update = (fn: (l: SessionLogs) => SessionLogs) => {
      queued.push(fn);
      flush();
    };

    const es = new EventSource(`/api/stream?file=${encodeURIComponent(file)}`);
    es.addEventListener("records", (e) => {
      const { source, records } = JSON.parse((e as MessageEvent).data) as { source: string | null; records: LogRecord[] };
      update((l) => {
        if (source === null) return { ...l, main: l.main.concat(records) };
        const a = l.agents[source] ?? { records: [] };
        return { ...l, agents: { ...l.agents, [source]: { ...a, records: a.records.concat(records) } } };
      });
    });
    es.addEventListener("agent", (e) => {
      const { id, meta } = JSON.parse((e as MessageEvent).data) as { id: string; meta: AgentMeta };
      update((l) => ({ ...l, agents: { ...l.agents, [id]: { records: l.agents[id]?.records ?? [], meta } } }));
    });
    es.addEventListener("ready", () => {
      readyQueued = true;
      flush();
    });
    // The main log was rewritten shorter (/clear): the server starts that log over and keeps tailing the
    // helpers' logs where they were, so only the main records go. Queued like the records, so it lands in order.
    es.addEventListener("reset", () => update((l) => ({ ...l, main: [] })));
    // Every (re)connect replays everything, so start from empty each time.
    es.onopen = () => {
      queued = [];
      readyQueued = false;
      setLogs(EMPTY);
      setReady(false);
      setConnected(true);
    };
    es.onerror = () => setConnected(false); // EventSource retries on its own
    return () => {
      cancelAnimationFrame(frame);
      es.close();
    };
  }, [file]);

  return { logs, connected, ready };
}
