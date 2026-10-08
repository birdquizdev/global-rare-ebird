import { describe, expect, it } from "vitest";
import { buildCodeLookup, countSpeciesRecords } from "../scripts/generate-rarity.mjs";
import { filterObservations, groupObservations, normalizeObservationRows } from "../src/utils/observations.js";
import { applyRarityToObservations, loadRarityLookups } from "../src/utils/rarity.js";

const rows = [
  { speciesCode: "redcro", comName: "Red Crossbill", locId: "L1", subId: "S1", obsId: "O1", obsDt: "2026-10-07 09:00", lat: 37, lng: -122, subnational1Code: "US-CA" },
  { speciesCode: "sbfly", comName: "Sulphur-bellied Flycatcher", locId: "L2", subId: "S2", obsId: "O2", obsDt: "2026-10-06 09:00", lat: 36, lng: -121, subnational1Code: "US-CA" },
  { speciesCode: "newbird", comName: "New Bird", locId: "L3", subId: "S3", obsId: "O3", obsDt: "2026-10-05 09:00", lat: 35, lng: -120, subnational1Code: "US-CA" },
  { speciesCode: "oregon", comName: "Oregon Bird", locId: "L4", subId: "S4", obsId: "O4", obsDt: "2026-10-07 09:00", lat: 45, lng: -122, subnational1Code: "US-OR" },
];
const filters = {
  isMylocation: false, backSelected: 5, distSelected: 50, statusLimit: 1, statusSystemId: null, abaLimit: 0,
  mapSelected: false, mediaSelected: false, hotspotSelected: false,
  filterSearch: "", filterSearchOptionsSelected: [], sortKey: "rarity",
};

function normalized() {
  const observations = normalizeObservationRows(rows, {
    regionCode: "US-CA", taxonomyLookup: {}, referenceDate: new Date("2026-10-08T12:00:00"),
  });
  return applyRarityToObservations(observations, { "US-CA": { redcro: 30000, sbfly: 350 } });
}

describe("rarity sorting", () => {
  it("ranks the fewest records first, treats species missing from the table as rarest, and puts states without a table last", () => {
    const observations = normalized();
    expect(observations.map((obs) => obs.rarityCount)).toEqual([30000, 350, 0, null]);
    expect(filterObservations(observations, filters).map((obs) => obs.speciesCode)).toEqual(["newbird", "sbfly", "redcro", "oregon"]);
    expect(groupObservations(observations, "rarity").species.map((species) => species.speciesCode)).toEqual(["newbird", "sbfly", "redcro", "oregon"]);
  });

  it("uses the lowest count when a species is reported from more than one state", () => {
    const observations = normalized();
    observations[3].speciesCode = "redcro";
    observations[3].rarityCount = 12;
    expect(groupObservations(observations, "rarity").species.find((species) => species.speciesCode === "redcro").rarityCount).toBe(12);
  });

  it("falls back to the region code when eBird omits the state code", () => {
    const [obs] = normalizeObservationRows([{ ...rows[0], subnational1Code: undefined }], { regionCode: "US-CA-037", taxonomyLookup: {} });
    expect(obs.subnational1Code).toBe("US-CA");
  });

  it("reports no rarity data until a table has counts", async () => {
    expect(await loadRarityLookups(normalized())).toEqual({});
  });
});

describe("rarity table generation", () => {
  const taxonomy = [
    "TAXON_ORDER,CATEGORY,SPECIES_CODE,PRIMARY_COM_NAME,SCIENTIFIC_NAME",
    "1,species,sbfly,Sulphur-bellied Flycatcher,Myiodynastes luteiventris",
    "2,species,redcro,Red Crossbill,Loxia curvirostra",
    "3,issf,redcro2,Red Crossbill (Ponderosa Pine),Loxia curvirostra benti",
    "4,slash,y00001,Slash,Loxia sp.",
  ].join("\n");
  const header = ["CATEGORY", "SCIENTIFIC NAME", "SUBSPECIES SCIENTIFIC NAME", "COUNTRY CODE", "STATE CODE"].join("\t");
  const line = (...cols) => cols.join("\t");

  it("counts species and subspecies-group records for the requested state only", async () => {
    const lines = [
      header,
      line("species", "Myiodynastes luteiventris", "", "US", "US-CA"),
      line("species", "Loxia curvirostra", "", "US", "US-CA"),
      line("issf", "Loxia curvirostra", "Loxia curvirostra benti", "US", "US-CA"),
      line("species", "Loxia curvirostra", "", "US", "US-OR"),
      line("slash", "Loxia sp.", "", "US", "US-CA"),
      line("species", "Unknown bird", "", "US", "US-CA"),
    ];
    const result = await countSpeciesRecords(lines, { regionCode: "US-CA", codeLookup: buildCodeLookup(taxonomy) });
    expect(result.counts).toEqual({ sbfly: 1, redcro: 2, redcro2: 1 });
    expect(result.rows).toBe(4);
    expect(result.unmatched.get("Unknown bird")).toBe(1);
  });

  it("rejects a file that is not an EBD export", async () => {
    await expect(countSpeciesRecords(["a\tb"], { regionCode: "US-CA", codeLookup: new Map() })).rejects.toThrow("missing the CATEGORY column");
  });
});
