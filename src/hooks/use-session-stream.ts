"use client";

import { useEffect, useState } from "react";
import { isDroppedFile } from "@/lib/paths";
import { pushAll } from "@/lib/num";
import type { AgentLog, AgentMeta, LogRecord } from "@/lib/session";

export type SessionLogs = { main: LogRecord[]; agents: Record<string, AgentLog> };

const EMPTY: SessionLogs = { main: [], agents: {} };

/** Records read so far, main and helpers, for the loading note. */
const countRecords = (l: SessionLogs) => Object.values(l.agents).reduce((n, a) => n + a.records.length, l.main.length);

/**
 * Tails one session log and its sub-agent logs over SSE. While the server replays the logs, records are
 * only collected (nothing is rebuilt per frame) and `progress` counts them for a "still reading" note; at the
 * server's "ready" event they're handed over at once and `ready` turns true. After that, live appends are
 * applied once per frame. `ready` goes back to false on a new file and on every reconnect (which replays
 * everything again).
 */
export function useSessionStream(file: string | null) {
  const [logs, setLogs] = useState<SessionLogs>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setLogs(EMPTY);
    setConnected(false);
    setReady(false);
    setProgress(0);
    // A dropped file is read in the browser; the server only streams logs in the Claude folder.
    if (!file || isDroppedFile(file)) return;

    // Before "ready": the replay, collected here in place (no renders, no copies).
    let replay: SessionLogs | null = { main: [], agents: {} };
    let tick: ReturnType<typeof setTimeout> | undefined;
    const showProgress = () => {
      tick ??= setTimeout(() => {
        tick = undefined;
        if (replay) setProgress(countRecords(replay));
      }, 250);
    };

    // After "ready": live appends, applied once per frame rather than one render each.
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
      if (replay) {
        const target = source === null ? replay.main : (replay.agents[source] ??= { records: [] }).records;
        pushAll(target, records);
        showProgress();
        return;
      }
      update((l) => {
        if (source === null) return { ...l, main: l.main.concat(records) };
        const a = l.agents[source] ?? { records: [] };
        return { ...l, agents: { ...l.agents, [source]: { ...a, records: a.records.concat(records) } } };
      });
    });
    es.addEventListener("agent", (e) => {
      const { id, meta } = JSON.parse((e as MessageEvent).data) as { id: string; meta: AgentMeta };
      if (replay) {
        replay.agents[id] = { records: replay.agents[id]?.records ?? [], meta };
        return;
      }
      update((l) => ({ ...l, agents: { ...l.agents, [id]: { records: l.agents[id]?.records ?? [], meta } } }));
    });
    // Everything is read: hand it over in one go (set straight away, not on the next frame, so a background
    // tab doesn't hold it back), and the page builds the model once.
    es.addEventListener("ready", () => {
      if (!replay) return;
      const done = replay;
      replay = null;
      clearTimeout(tick);
      tick = undefined;
      setLogs(done);
      setProgress(countRecords(done));
      setReady(true);
    });
    // The main log was rewritten shorter (/clear): the server starts that log over and keeps tailing the
    // helpers' logs where they were, so only the main records go, in order with the records around it.
    es.addEventListener("reset", () => {
      if (replay) replay.main = [];
      else update((l) => ({ ...l, main: [] }));
    });
    // Every (re)connect replays everything, so start from empty each time.
    es.onopen = () => {
      queued = [];
      cancelAnimationFrame(frame);
      frame = 0;
      replay = { main: [], agents: {} };
      setLogs(EMPTY);
      setReady(false);
      setProgress(0);
      setConnected(true);
    };
    es.onerror = () => setConnected(false); // EventSource retries on its own
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(tick);
      es.close();
    };
  }, [file]);

  return { logs, connected, ready, progress };
}
