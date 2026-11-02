// The Map ("Request N, step by step") as a registry view.
import { StoryMap } from "@/components/story-map";
import type { SessionViewProps } from "./registry";

export function MapView({ model, turn, file, selected, onSelect, onShowRequests, filter }: SessionViewProps) {
  const index = model.turns.indexOf(turn);
  return (
    <StoryMap
      key={`${file}:${index}`}
      turn={turn}
      actors={model.actors}
      isLatest={index === model.turns.length - 1}
      live={model.live}
      stale={model.stale}
      selected={selected}
      onSelect={onSelect}
      onShowRequests={onShowRequests ?? (() => {})}
      filter={filter}
    />
  );
}
