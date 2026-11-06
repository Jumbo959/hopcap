import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quote, type Mode, type Tap, type Tariff } from "./charge.js";

const tariff: Tariff = {
  currency: "RUB",
  fares: { bus: 65, tram: 65, metro: 75, rail: 80 },
  zoneStep: 30,
  transferWindowMin: 90,
  transferFlat: 0,
  dailyCap: 300,
  weeklyCap: 1600,
};

function tap(id: string, at: string, mode: Mode, zones = 1): Tap {
  return { id, at, mode, zones };
}

function money(id: string, at: string, mode: Mode, zones = 1) {
  const line = quote(tariff, [tap(id, at, mode, zones)]).lines[0];
  return line;
}

describe("quote", () => {
  it("charges a plain ride", () => {
    const line = money("a", "2026-03-03T08:06:00+03:00", "bus");
    assert.equal(line.charged, 65);
    assert.deepEqual(line.tags, ["bus"]);
    assert.equal(line.day, "2026-03-03");
  });

  it("keeps the zone step on a transfer and chains from the last tap", () => {
    const statement = quote(tariff, [
      tap("a", "2026-03-03T08:00:00+03:00", "bus"),
      tap("b", "2026-03-03T08:20:00+03:00", "metro", 2),
      tap("c", "2026-03-03T08:50:00+03:00", "tram"),
    ]);
    assert.deepEqual(
      statement.lines.map((line) => [line.id, line.charged, line.tags]),
      [
        ["a", 65, ["bus"]],
        ["b", 30, ["metro", "transfer", "zones+1"]],
        ["c", 0, ["tram", "transfer"]],
      ],
    );
  });

  it("does not treat the same mode as a transfer, even inside the window", () => {
    const statement = quote(tariff, [
      tap("a", "2026-03-03T08:00:00+03:00", "bus"),
      tap("b", "2026-03-03T08:10:00+03:00", "bus"),
    ]);
    assert.equal(statement.total, 130);
    assert.equal(statement.lines[1].tags.includes("transfer"), false);
  });

  it("charges full fare one minute outside the window", () => {
    const statement = quote(tariff, [
      tap("a", "2026-03-03T08:00:00+03:00", "bus"),
      tap("b", "2026-03-03T09:31:00+03:00", "metro"),
    ]);
    assert.equal(statement.lines[1].charged, 75);
  });

  it("clips one ride by the day and then by the week", () => {
    const tight: Tariff = { ...tariff, dailyCap: 30, weeklyCap: 10 };
    const line = quote(tight, [tap("a", "2026-03-03T08:00:00Z", "rail")]).lines[0];
    assert.equal(line.gross, 80);
    assert.equal(line.charged, 10);
    assert.deepEqual(line.tags, ["rail", "daily-cap", "weekly-cap"]);
  });

  it("clips the day before the week, then lets the next local day start over", () => {
    const tight: Tariff = { ...tariff, dailyCap: 100, weeklyCap: 150 };
    const statement = quote(tight, [
      tap("a", "2026-03-03T23:40:00+03:00", "rail"),
      tap("b", "2026-03-03T23:50:00+03:00", "rail"),
      tap("c", "2026-03-04T00:10:00+03:00", "rail"),
    ]);
    assert.deepEqual(
      statement.lines.map((line) => [line.day, line.charged, line.tags.slice(-1)[0]]),
      [
        ["2026-03-03", 80, "rail"],
        ["2026-03-03", 20, "daily-cap"],
        ["2026-03-04", 50, "weekly-cap"],
      ],
    );
    assert.equal(statement.total, 150);
    assert.equal(statement.days[0].key, "2026-03-03");
    assert.equal(statement.days[1].charged, 50);
  });

  it("puts 30 December 2019 into the first ISO week of 2020", () => {
    const statement = quote(tariff, [
      tap("sun", "2019-12-29T12:00:00Z", "bus"),
      tap("mon", "2019-12-30T12:00:00Z", "bus"),
    ]);
    assert.deepEqual(
      statement.lines.map((line) => line.week),
      ["2019-W52", "2020-W01"],
    );
  });

  it("sorts taps and does not care about input order", () => {
    const late = tap("late", "2026-03-03T12:00:00+03:00", "metro");
    const early = tap("early", "2026-03-03T08:00:00+03:00", "bus");
    const forward = quote(tariff, [early, late]);
    const backward = quote(tariff, [late, early]);
    assert.deepEqual(
      forward.lines.map((line) => line.id),
      ["early", "late"],
    );
    assert.deepEqual(forward, backward);
  });

  it("rejects a duplicate, a naked timestamp, and a zero zone", () => {
    const ok = tap("a", "2026-03-03T08:00:00+03:00", "bus");
    assert.throws(() => quote(tariff, [ok, { ...ok }]), /duplicate tap a/);
    assert.throws(() => quote(tariff, [tap("b", "2026-03-03T08:00:00", "bus")]), /bad timestamp b/);
    assert.throws(() => quote(tariff, [tap("c", "2026-03-03T08:00:00Z", "bus", 0)]), /zones/);
  });
});
