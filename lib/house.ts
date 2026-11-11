import type { Area } from "./types";

export const MAP = [
  "#################",
  "#bbbbb#ttt#kkkkk#",
  "#bbbbb#ttt#kkkkk#",
  "#bbbbb#ttt#kkkkk#",
  "###b####t####k###",
  "#lllllllllllllll#",
  "#lllllllllllllll#",
  "#lllllllllllllll#",
  "#llllllllllleeee#",
  "#llllllllllleeee#",
  "#############d###",
];
export const W = 17;
export const H = 11;
const ROOM: Record<string, Area> = { b: "bedroom", t: "bathroom", k: "kitchen", l: "living", e: "entry", d: "entry" };
export const AREA_NAME: Record<Area, string> = {
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  kitchen: "Kitchen",
  living: "Living room",
  entry: "Entry",
  house: "House",
};
export const cellArea = (x: number, y: number): Area | null => ROOM[(MAP[y] || "")[x]] ?? null;

export type DevId =
  | "bed" | "pills" | "toilet" | "kettle" | "rice" | "stove" | "fridge"
  | "sofa" | "tv" | "ac" | "table" | "keys" | "door";

export interface DevDef {
  name: string;
  icon: string;
  cells: [number, number][];
  spot: [number, number];
  /** hardware that produces this device's signal — shown in the UI for honesty */
  hw?: string;
}

export const DEV: Record<DevId, DevDef> = {
  bed: { name: "Bed", icon: "🛏️", cells: [[1, 1], [2, 1], [1, 2], [2, 2]], spot: [3, 2], hw: "mattress pressure pad" },
  pills: { name: "Pill box", icon: "💊", cells: [[3, 1]], spot: [4, 1], hw: "load cell under pill box" },
  toilet: { name: "Toilet", icon: "🚽", cells: [[8, 1]], spot: [8, 2], hw: "acoustic flush sensor" },
  kettle: { name: "Hot-water pot", icon: "🫖", cells: [[11, 1]], spot: [11, 2], hw: "smart plug + scale base" },
  rice: { name: "Rice cooker", icon: "🍚", cells: [[12, 1]], spot: [12, 2], hw: "circuit power meter" },
  stove: { name: "Gas stove", icon: "🔥", cells: [[13, 1]], spot: [13, 2], hw: "heat sensor above stove" },
  fridge: { name: "Fridge", icon: "🧊", cells: [[15, 1]], spot: [15, 2], hw: "door contact + power meter" },
  sofa: { name: "Sofa", icon: "🛋️", cells: [[3, 6], [3, 7], [3, 8]], spot: [4, 7] },
  tv: { name: "TV", icon: "📺", cells: [[1, 6], [1, 7], [1, 8]], spot: [4, 7], hw: "circuit power meter" },
  ac: { name: "Air con", icon: "❄️", cells: [[6, 4]], spot: [6, 5], hw: "circuit power meter" },
  table: { name: "Dining table", icon: "🍽️", cells: [[9, 6], [10, 6]], spot: [9, 7] },
  keys: { name: "Key hook", icon: "🔑", cells: [[15, 8]], spot: [14, 8], hw: "load cell on hook" },
  door: { name: "Front door", icon: "🚪", cells: [[13, 10]], spot: [13, 9], hw: "door contact" },
};
export const DECOR: [number, number][] = [[14, 1], [7, 1]];

const blocked = new Set<number>();
Object.values(DEV).forEach((d) => d.cells.forEach(([x, y]) => blocked.add(y * W + x)));
DECOR.forEach(([x, y]) => blocked.add(y * W + x));

export const walkable = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < W && y < H && MAP[y][x] !== "d" && !!cellArea(x, y) && !blocked.has(y * W + x);

export function findPath(from: [number, number], to: [number, number]): [number, number][] | null {
  const key = (x: number, y: number) => y * W + x;
  const prev = new Map<number, [number, number] | null>([[key(from[0], from[1]), null]]);
  const q: [number, number][] = [from];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (!prev.has(k) && walkable(nx, ny)) {
        prev.set(k, [x, y]);
        q.push([nx, ny]);
      }
    }
  }
  if (!prev.has(key(to[0], to[1]))) return null;
  const out: [number, number][] = [];
  let c: [number, number] | null | undefined = to;
  while (c && !(c[0] === from[0] && c[1] === from[1])) {
    out.unshift(c);
    c = prev.get(key(c[0], c[1]));
  }
  return out;
}
