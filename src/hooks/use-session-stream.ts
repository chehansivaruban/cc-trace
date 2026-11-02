"use client";

import { useEffect, useState } from "react";
import { isDroppedFile } from "@/lib/paths";
import type { AgentLog, AgentMeta, LogRecord } from "@/lib/session";

export type SessionLogs = { main: LogRecord[]; agents: Record<string, AgentLog> };

const EMPTY: SessionLogs = { main: [], agents: {} };

/** Tails one session log and its sub-agent logs over SSE. */
export function useSessionStream(file: string | null) {
  const [logs, setLogs] = useState<SessionLogs>(EMPTY);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setLogs(EMPTY);
    setConnected(false);
    // A dropped file is read in the browser; the server only streams logs in the Claude folder.
    if (!file || isDroppedFile(file)) return;

    // The initial replay can be hundreds of events; apply them once per frame, not one render each.
    let queued: ((l: SessionLogs) => SessionLogs)[] = [];
    let frame = 0;
    const update = (fn: (l: SessionLogs) => SessionLogs) => {
      queued.push(fn);
      frame ||= requestAnimationFrame(() => {
        const fns = queued;
        queued = [];
        frame = 0;
        setLogs((l) => fns.reduce((acc, f) => f(acc), l));
      });
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
    // Every (re)connect replays everything, so start from empty each time.
    const reset = () => {
      queued = [];
      setLogs(EMPTY);
    };
    es.addEventListener("reset", reset);
    es.onopen = () => {
      reset();
      setConnected(true);
    };
    es.onerror = () => setConnected(false); // EventSource retries on its own
    return () => {
      cancelAnimationFrame(frame);
      es.close();
    };
  }, [file]);

  return { logs, connected };
}
