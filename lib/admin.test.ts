import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ago,
  day,
  device,
  duration,
  formatBytes,
  formatCount,
  splitMembers,
  stamp,
  type MemberActivity,
} from "./admin.ts";

/**
 * The admin screen's wording, under test.
 *
 * All of it is formatting, and formatting is where a screen about "how long
 * ago" and "how close to the ceiling" quietly lies — a rounding that turns
 * 59 minutes into "0 h ago", or a size in one base labelled with the other.
 * The clock is an input everywhere so these can say exactly what they test.
 */

const NOW = Date.parse("2026-08-18T12:00:00Z");
const before = (ms: number) => new Date(NOW - ms).toISOString();

describe("ago", () => {
  it("says never for a member who has not come, not a dash", () => {
    assert.equal(ago(null, NOW), "never");
    assert.equal(ago(undefined, NOW), "never");
  });

  it("uses the coarsest honest unit", () => {
    assert.equal(ago(before(10_000), NOW), "just now");
    assert.equal(ago(before(59 * 60_000), NOW), "59 min ago");
    assert.equal(ago(before(60 * 60_000), NOW), "1 h ago");
    assert.equal(ago(before(23.9 * 3_600_000), NOW), "23 h ago");
    assert.equal(ago(before(24 * 3_600_000), NOW), "yesterday");
    assert.equal(ago(before(40 * 86_400_000), NOW), "40 d ago");
  });

  it("does not go negative when the clocks disagree", () => {
    // Two Supabase clocks a second apart is a real thing (see fetch-retry.ts).
    assert.equal(ago(new Date(NOW + 5_000).toISOString(), NOW), "just now");
  });
});

describe("day", () => {
  it("is a short date, with the year only when it is not this one", () => {
    assert.equal(day("2026-08-16T22:10:00Z", NOW), "Aug 16");
    assert.equal(day("2025-12-31T23:59:00Z", NOW), "Dec 31, 2025");
    assert.equal(day(null, NOW), "—");
  });
});

describe("stamp", () => {
  it("is the dateline's shape, to the minute, in UTC", () => {
    assert.equal(stamp("2026-08-18T09:07:33.123Z"), "2026-08-18 09:07Z");
    assert.equal(stamp(null), undefined);
  });
});

describe("duration", () => {
  it("reads seconds under two minutes and minutes after", () => {
    assert.equal(duration("2026-08-18T11:00:00Z", "2026-08-18T11:01:35Z"), "95 s");
    assert.equal(duration("2026-08-18T11:00:00Z", "2026-08-18T11:03:12Z"), "3 min 12 s");
  });

  it("calls an unfinished run running", () => {
    assert.equal(duration("2026-08-18T11:00:00Z", null), "running");
  });
});

describe("formatBytes", () => {
  it("matches pg_size_pretty's units, one decimal below ten", () => {
    assert.equal(formatBytes(512), "512 bytes");
    assert.equal(formatBytes(412 * 1024), "412 kB");
    assert.equal(formatBytes(78 * 1024 * 1024), "78 MB");
    assert.equal(formatBytes(1.25 * 1024 ** 3), "1.3 GB");
    assert.equal(formatBytes(2 * 1024 ** 3), "2 GB");
  });
});

describe("formatCount", () => {
  it("separates thousands and dashes a null", () => {
    assert.equal(formatCount(174_213), "174,213");
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(null), "—");
  });
});

describe("device", () => {
  const cases: Array<[string, string]> = [
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      "iPhone",
    ],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15", "iPad"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36", "Android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126", "Windows"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36", "Chromebook"],
    ["Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/128.0", "Linux"],
    ["curl/8.6.0", "other"],
  ];

  for (const [ua, expected] of cases) {
    it(`reads ${expected} off its own agent string`, () => {
      assert.equal(device(ua), expected);
    });
  }

  it("dashes a row that recorded no agent", () => {
    assert.equal(device(null), "—");
  });
});

describe("splitMembers", () => {
  const row = (email: string, added_at: string | null): MemberActivity => ({
    email,
    note: null,
    role: added_at ? "member" : null,
    added_at,
    first_seen: null,
    last_seen: null,
    sign_ins: 0,
    last_sign_in: null,
    last_user_agent: null,
  });

  it("tells the list from the strangers by added_at, not by whether they came", () => {
    const { members, strangers } = splitMembers([
      row("kev@example.com", "2026-08-01T00:00:00Z"),
      row("someone@example.com", null),
    ]);
    assert.deepEqual(
      members.map((m) => m.email),
      ["kev@example.com"],
    );
    assert.deepEqual(
      strangers.map((m) => m.email),
      ["someone@example.com"],
    );
  });
});
