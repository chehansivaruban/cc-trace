// The session views, in tab order. Each Phase 1 task replaces its own stub component; page.tsx renders
// the tab bar and the active view from this list.
import type { ComponentType } from "react";
import type { Selection } from "@/components/story-map";
import type { SessionView } from "@/lib/route";
import type { SessionModel, Turn } from "@/lib/session";
import { AgentsView } from "./agents-view";
import { ConversationView } from "./conversation-view";
import { FilesView } from "./files-view";
import { FlowView } from "./flow-view";
import { HealthView } from "./health-view";
import { MapView } from "./map-view";
import { StatsView } from "./stats-view";

export type { Selection };

export type SessionViewProps = {
  model: SessionModel;
  turn: Turn; // the request being looked at
  file: string; // the session log, relative to the projects folder
  selected: Selection;
  onSelect: (s: Selection) => void;
  onPickTurn: (i: number) => void; // open request i (0-based)
  onShowSession: () => void; // switch to the "Whole session" view
  /** Small screens: open the request list drawer. Optional; only the Map uses it today. */
  onShowRequests?: () => void;
};

export const SESSION_VIEWS: { id: SessionView; label: string; component: ComponentType<SessionViewProps> }[] = [
  { id: "map", label: "Map", component: MapView },
  { id: "conversation", label: "Conversation", component: ConversationView },
  { id: "agents", label: "Agents", component: AgentsView },
  { id: "stats", label: "Stats", component: StatsView },
  { id: "health", label: "Health", component: HealthView },
  { id: "files", label: "Files", component: FilesView },
  { id: "flow", label: "Whole session", component: FlowView },
];
