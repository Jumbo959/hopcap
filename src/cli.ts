import { readFileSync } from "node:fs";
import { quote, type Tap, type Tariff } from "./charge.js";

const tariffFile = process.argv[2];
const tapsFile = process.argv[3];
if (!tariffFile || !tapsFile) {
  process.stderr.write("usage: node dist/cli.js <tariff.json> <taps.json>\n");
  process.exit(1);
}

const tariff = JSON.parse(readFileSync(tariffFile, "utf8")) as Tariff;
const taps = JSON.parse(readFileSync(tapsFile, "utf8")) as Tap[];
const statement = quote(tariff, taps);

for (const line of statement.lines) {
  const clock = line.at.slice(11, 16);
  const notes = line.tags.filter((tag) => tag !== line.mode).join(" ");
  process.stdout.write(`${line.day} ${clock}  ${line.mode.padEnd(5)}  ${String(line.charged).padStart(4)}  ${notes}\n`);
}
process.stdout.write(`total ${statement.total} ${statement.currency}\n`);
