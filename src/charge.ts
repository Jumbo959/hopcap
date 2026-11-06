export type Mode = "bus" | "tram" | "metro" | "rail";

export type Tap = {
  id: string;
  at: string;
  mode: Mode;
  zones: number;
};

export type Tariff = {
  currency: string;
  fares: Record<Mode, number>;
  zoneStep: number;
  transferWindowMin: number;
  transferFlat: number;
  dailyCap: number;
  weeklyCap: number;
};

export type Line = {
  id: string;
  at: string;
  day: string;
  week: string;
  mode: Mode;
  gross: number;
  charged: number;
  tags: string[];
};

export type Bucket = { key: string; charged: number; cap: number };

export type Statement = {
  currency: string;
  total: number;
  lines: Line[];
  days: Bucket[];
  weeks: Bucket[];
};

const MODES: Mode[] = ["bus", "tram", "metro", "rail"];
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;

function bad(msg: string): never {
  throw new Error(msg);
}

function needMoney(n: number, label: string) {
  if (!Number.isInteger(n) || n < 0) bad(`${label} must be a non-negative integer`);
}

function isoWeek(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const start = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - start.getTime()) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function quote(tariff: Tariff, taps: Tap[]): Statement {
  if (typeof tariff.currency !== "string" || tariff.currency.trim() === "") bad("currency is empty");
  if (!tariff.fares) bad("fares are missing");
  for (const mode of MODES) needMoney(tariff.fares[mode], `fare ${mode}`);
  needMoney(tariff.zoneStep, "zone step");
  needMoney(tariff.transferWindowMin, "transfer window");
  needMoney(tariff.transferFlat, "transfer flat");
  needMoney(tariff.dailyCap, "daily cap");
  needMoney(tariff.weeklyCap, "weekly cap");

  const seen = new Set<string>();
  const parsed = taps.map((tap) => {
    if (typeof tap.id !== "string" || tap.id.trim() === "") bad("tap id is empty");
    if (seen.has(tap.id)) bad(`duplicate tap ${tap.id}`);
    seen.add(tap.id);
    const match = STAMP.exec(tap.at);
    if (!match) bad(`bad timestamp ${tap.id}`);
    if (!(MODES as string[]).includes(tap.mode)) bad(`unknown mode ${tap.id}`);
    if (!Number.isInteger(tap.zones) || tap.zones < 1) bad(`zones must be an integer >= 1 (${tap.id})`);
    const ms = Date.parse(tap.at);
    if (Number.isNaN(ms)) bad(`bad timestamp ${tap.id}`);
    return {
      tap,
      day: `${match[1]}-${match[2]}-${match[3]}`,
      week: isoWeek(Number(match[1]), Number(match[2]), Number(match[3])),
      ms,
    };
  });

  parsed.sort((a, b) => a.ms - b.ms || (a.tap.id < b.tap.id ? -1 : a.tap.id > b.tap.id ? 1 : 0));

  const daySpent = new Map<string, number>();
  const weekSpent = new Map<string, number>();
  const lines: Line[] = [];
  let prev: { ms: number; mode: Mode } | null = null;
  const windowMs = tariff.transferWindowMin * 60_000;

  for (const row of parsed) {
    const extra = row.tap.zones - 1;
    const tags: string[] = [row.tap.mode];
    const linked = prev !== null && row.ms >= prev.ms && row.ms - prev.ms <= windowMs && prev.mode !== row.tap.mode;
    const gross = (linked ? tariff.transferFlat : tariff.fares[row.tap.mode]) + extra * tariff.zoneStep;
    if (linked) tags.push("transfer");
    if (extra > 0) tags.push(`zones+${extra}`);

    let charged = gross;
    const dayRoom = tariff.dailyCap - (daySpent.get(row.day) ?? 0);
    if (charged > dayRoom) {
      charged = Math.max(0, dayRoom);
      tags.push("daily-cap");
    }
    const weekRoom = tariff.weeklyCap - (weekSpent.get(row.week) ?? 0);
    if (charged > weekRoom) {
      charged = Math.max(0, weekRoom);
      tags.push("weekly-cap");
    }

    daySpent.set(row.day, (daySpent.get(row.day) ?? 0) + charged);
    weekSpent.set(row.week, (weekSpent.get(row.week) ?? 0) + charged);
    prev = { ms: row.ms, mode: row.tap.mode };
    lines.push({
      id: row.tap.id,
      at: row.tap.at,
      day: row.day,
      week: row.week,
      mode: row.tap.mode,
      gross,
      charged,
      tags,
    });
  }

  const days = [...daySpent.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, charged]) => ({ key, charged, cap: tariff.dailyCap }));
  const weeks = [...weekSpent.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, charged]) => ({ key, charged, cap: tariff.weeklyCap }));
  const total = lines.reduce((sum, line) => sum + line.charged, 0);

  return { currency: tariff.currency, total, lines, days, weeks };
}
