"use client";

import { useState, type PointerEvent } from "react";

import { pct } from "@/lib/board";

/**
 * Reading a week off the distribution, without having to hit it.
 *
 * A dot is 5px across — 7px for a ceiling week — and it carried the score in a
 * `title`, which put two problems on the one thing the plot is for. The target
 * was smaller than the pointer's own jitter, so a reader could be over a
 * season and still be over nothing; and the browser's own tooltip delay is
 * about a second and cannot be shortened, so even a hit felt like a miss.
 *
 * So the hit area is the whole track and the nearest dot wins. That inverts the
 * failure: there is no position inside a season's plot that reads as empty, and
 * with dots that overlap — two weeks four pixels apart is ordinary — "nearest"
 * is a better answer than "whichever happens to be on top", which is what a
 * per-dot target gives you.
 *
 * A ring marks which dot is being read, because a tooltip that names a week
 * without pointing at one asks the reader to trust it. That is the confirmation
 * the old `title` never gave.
 *
 * `"use client"` lives here rather than in `app/plot.tsx`, which deliberately
 * has none: the plot renders inside the board's client tree *and* inside the
 * server-rendered compare page, and it can only keep doing both if the state
 * is in a child. Props are plain number arrays, so they serialise across the
 * boundary unchanged.
 */
export function PlotHover({
  points,
  weeks,
}: {
  points: number[];
  weeks?: number[] | null;
}) {
  const [near, setNear] = useState<number | null>(null);

  if (points.length === 0) return null;

  function pick(event: PointerEvent<HTMLSpanElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;

    // Compare in axis units rather than pixels: the plot is a `1fr` column, so
    // its width differs between the board, a career and a comparison, and the
    // dots are placed by percentage in all three.
    const x = ((event.clientX - box.left) / box.width) * 100;

    let best = 0;
    let gap = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.abs(pct(points[index]!) - x);
      if (distance < gap) {
        gap = distance;
        best = index;
      }
    }

    // Bail out when the answer has not changed. A pointermove fires ~100 times
    // a second and React skips the render when the state is identical, so a
    // sweep across one row costs a handful of updates rather than hundreds.
    setNear((previous) => (previous === best ? previous : best));
  }

  const value = near == null ? null : points[near]!;
  const week = near == null ? null : weeks?.[near];

  return (
    <span
      className="hit"
      onPointerMove={pick}
      onPointerLeave={() => setNear(null)}
      // The layer is a reading aid over a control — on the board and the career
      // table the whole row is a button — so it is invisible to assistive
      // technology, which reaches the same numbers through the game log.
      aria-hidden="true"
    >
      {value != null ? (
        <>
          <span className="ping" style={{ left: `${pct(value)}%` }} />
          <span className="dotbox" style={{ left: `${pct(value)}%` }}>
            {week != null ? `wk ${week} · ` : ""}
            {value.toFixed(1)}
          </span>
        </>
      ) : null}
    </span>
  );
}
