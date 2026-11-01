// "Whole session": every request and how memory carries between them, as a registry view.
import { SessionFlow } from "@/components/session-flow";
import type { SessionViewProps } from "./registry";

export function FlowView({ model, turn, file, onSelect, onPickTurn }: SessionViewProps) {
  const last = model.turns.length - 1;
  return (
    <SessionFlow
      key={file}
      turns={model.turns}
      actors={model.actors}
      current={model.turns.indexOf(turn)}
      liveIndex={model.live.active ? last : undefined}
      onOpen={onPickTurn}
      onOpenActor={(i, id) => {
        onPickTurn(i);
        onSelect({ type: "actor", id });
      }}
    />
  );
}
