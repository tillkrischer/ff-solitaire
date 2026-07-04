import type { DropLocation, Rect, SourceLocation } from "./types.ts";

export function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function sourceKey(source: SourceLocation): string {
  return `${source.type}:${source.index}`;
}

export function dropKey(drop: DropLocation): string {
  return `${drop.type}:${drop.index}`;
}

export function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function centerDistanceSquared(a: Rect, b: Rect): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return (ax - bx) ** 2 + (ay - by) ** 2;
}
