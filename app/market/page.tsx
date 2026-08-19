import type { Metadata } from "next";

import { STAT_SEASON } from "@/lib/board";
import { fetchMarket, fetchViewer } from "@/lib/queries";
import { AppBar, PageHead } from "../chrome";
import { NotOnList } from "../not-on-list";
import { Chart } from "./chart";

export const metadata: Metadata = { title: "Market" };

/**
 * `/market` — who is priced below what he returns.
 *
 * The question the board can only imply. It has the same two halves as
 * `/player/[id]`'s Cost and Rank columns, turned into a coordinate: cost on the
 * horizontal, and on the vertical not what a player produced but what he
 * produced **above or below what his price usually buys**. Zero is the market's
 * own expectation, so a bargain is at the top of the chart rather than being a
 * diagonal a reader has to eyeball.
 *
 * **This is the first screen in the app that draws a verdict**, and that is a
 * rule change rather than an oversight. Every other screen refuses one: no colour
 * on the cost/rank pair, no winner on the IQR row, no crown on the delta. That
 * refusal is right for a table cell reporting one fact and wrong for an
 * instrument whose whole job is to rank value. The career table one route away
 * goes on refusing to say the same thing, and that inconsistency is accepted
 * rather than overlooked.
 *
 * This file authenticates and fetches and does nothing else; everything visual
 * is in `chart.tsx` over plain data, which is what lets a probe render it with
 * real rows and no session. `fetchViewer()` revalidates against the auth
 * server, so this component cannot be rendered by one.
 */
export default async function MarketPage() {
  const [viewer, { players, freshness, isMember }] = await Promise.all([fetchViewer(), fetchMarket()]);

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={viewer.email} />
      </main>
    );
  }

  return (
    <main className="shell">
      <AppBar current="market" viewer={viewer} />
      <PageHead
        title="Market"
        context={`${STAT_SEASON} regular season · full PPR · height is what a price usually buys, so zero is the market's own expectation`}
        freshness={freshness}
      />
      <Chart players={players} statSeason={STAT_SEASON} />
    </main>
  );
}
