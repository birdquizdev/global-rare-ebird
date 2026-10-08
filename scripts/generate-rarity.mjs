import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { fetchText, parseTaxonomyCsv, TAXONOMY_URL } from "./taxonomy-helpers.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Maps scientific names (species and subspecies groups) to eBird species codes.
export function buildCodeLookup(taxonomyCsv) {
  const { rows, get } = parseTaxonomyCsv(taxonomyCsv);
  const lookup = new Map();

  for (const row of rows) {
    const category = String(get(row, "CATEGORY")).trim();
    const code = String(get(row, "SPECIES_CODE")).trim();
    const name = String(get(row, "SCIENTIFIC_NAME")).trim().toLowerCase();
    if (code && name && (category === "species" || category === "issf")) {
      lookup.set(name, code);
    }
  }

  return lookup;
}

// Streams EBD lines (header first) and counts records per species code for one region.
export async function countSpeciesRecords(lines, { regionCode, codeLookup }) {
  const counts = {};
  const unmatched = new Map();
  let header;
  let rows = 0;

  for await (const line of lines) {
    if (!header) {
      header = new Map(line.split("\t").map((name, index) => [name.trim(), index]));
      for (const name of ["CATEGORY", "SCIENTIFIC NAME", "COUNTRY CODE", "STATE CODE"]) {
        if (!header.has(name)) throw new Error(`EBD header is missing the ${name} column`);
      }
      continue;
    }

    const cols = line.split("\t");
    const state = cols[header.get("STATE CODE")];
    const country = cols[header.get("COUNTRY CODE")];
    if (state !== regionCode && country !== regionCode) continue;

    const category = cols[header.get("CATEGORY")];
    if (category !== "species" && category !== "issf") continue;

    rows += 1;
    const names = [cols[header.get("SCIENTIFIC NAME")], cols[header.get("SUBSPECIES SCIENTIFIC NAME")]];
    for (const name of names) {
      if (!name) continue;
      const code = codeLookup.get(name.toLowerCase());
      if (code) counts[code] = (counts[code] || 0) + 1;
      else if (name === names[0]) unmatched.set(name, (unmatched.get(name) || 0) + 1);
    }
  }

  if (!header) throw new Error("EBD input was empty");
  return { counts, rows, unmatched };
}

function readLines(path) {
  const source = path === "-" ? process.stdin : createReadStream(path);
  const input = path.endsWith(".gz") ? source.pipe(createGunzip()) : source;
  return createInterface({ input, crlfDelay: Infinity });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) args[argv[index].replace(/^--/, "")] = argv[index + 1];
  return args;
}

async function main() {
  const { region = "US-CA", ebd, taxonomy, out } = parseArgs(process.argv.slice(2));
  if (!ebd) {
    throw new Error("Usage: node scripts/generate-rarity.mjs --ebd <ebd.txt | ebd.txt.gz | -> [--region US-CA] [--taxonomy ebird-taxonomy.csv] [--out data/rarity-us-ca.json]");
  }

  const taxonomyCsv = taxonomy ? await readFile(taxonomy, "utf8") : fetchText(TAXONOMY_URL);
  const codeLookup = buildCodeLookup(taxonomyCsv);
  const { counts, rows, unmatched } = await countSpeciesRecords(readLines(ebd), { regionCode: region, codeLookup });
  if (!rows) throw new Error(`No species records found for ${region}. Check --region against the STATE CODE column.`);

  const sortedCounts = Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
  const outputPath = resolve(rootDir, out || `data/rarity-${region.toLowerCase()}.json`);
  const table = {
    region,
    source: ebd === "-" ? "eBird Basic Dataset" : basename(ebd),
    generated: new Date().toISOString().slice(0, 10),
    records: rows,
    counts: sortedCounts,
  };
  await writeFile(outputPath, `${JSON.stringify(table)}\n`);

  const topUnmatched = [...unmatched].sort((left, right) => right[1] - left[1]).slice(0, 10);
  console.log(`Wrote ${Object.keys(sortedCounts).length} species from ${rows.toLocaleString()} ${region} records to ${outputPath}.`);
  if (topUnmatched.length) {
    console.log(`${unmatched.size} scientific names did not match the eBird taxonomy (most frequent: ${topUnmatched.map(([name, count]) => `${name} ${count}`).join(", ")}). Use a taxonomy version close to the EBD release.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
