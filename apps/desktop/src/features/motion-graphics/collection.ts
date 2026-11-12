import type { MotionGraphic } from "./model";

/** Builds the ordered rendering view without changing the two persisted source collections. */
export function mergeMotionLayers(
  textLayers: MotionGraphic[],
  captions: MotionGraphic[],
  order: string[],
): MotionGraphic[] {
  const byId = new Map([...textLayers, ...captions].map(item => [item.id, item]));
  const ordered = order.map(id => byId.get(id)).filter((item): item is MotionGraphic => !!item);
  const known = new Set(ordered.map(item => item.id));
  return [...ordered, ...textLayers, ...captions].filter((item, index, all) =>
    !known.has(item.id) && all.findIndex(candidate => candidate.id === item.id) === index
  );
}

/** Separates the rendering view back into its independently persisted collections. */
export function splitMotionLayers(items: MotionGraphic[]): {
  textLayers: MotionGraphic[];
  captions: MotionGraphic[];
} {
  return {
    textLayers: items.filter(item => !item.isCaption),
    captions: items.filter(item => !!item.isCaption),
  };
}
