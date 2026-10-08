// @vitest-environment happy-dom
import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalRareBird } from "../src/composables/useGlobalRareBird.js";
import { loadRarityLookups } from "../src/utils/rarity.js";

vi.mock("../src/utils/analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("../src/config/index.js", () => ({
  ebirdApiKey: "fixture-token", ebirdBaseUrl: "https://api.ebird.org/v2",
  mapboxStyles: [{ key: "streets", url: "mapbox://styles/mapbox/streets-v12" }],
}));
vi.mock("../src/utils/taxonomy-resources.js", () => ({
  loadTaxonomyResources: vi.fn(async () => ({
    taxonomyLookup: { redcro: { tax: 1, category: "species" }, sbfly: { tax: 2, category: "species" } }, regionTaxonomyLookups: {},
  })),
}));
vi.mock("../src/utils/rarity.js", async (importOriginal) => ({ ...(await importOriginal()), loadRarityLookups: vi.fn() }));

const today = new Date().toISOString().slice(0, 10);
const rows = [
  { speciesCode: "redcro", comName: "Red Crossbill", locId: "L1", subId: "S1", obsId: "O1", obsDt: `${today} 09:00`, lat: 37, lng: -122, subnational1Code: "US-CA" },
  { speciesCode: "sbfly", comName: "Sulphur-bellied Flycatcher", locId: "L2", subId: "S2", obsId: "O2", obsDt: `${today} 08:00`, lat: 36, lng: -121, subnational1Code: "US-CA" },
];

let component;
let app;
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/global-rare-ebird/?mode=r");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rows))));
  vi.spyOn(console, "error").mockImplementation(() => {});
  component = createApp({ setup() { app = useGlobalRareBird(); return () => h("div"); } });
  component.mount(document.createElement("div"));
});
afterEach(() => component.unmount());

describe("default sort", () => {
  it("defaults to rarity when counts are available, unless the user picked another sort", async () => {
    loadRarityLookups.mockResolvedValue({ "US-CA": { redcro: 30000, sbfly: 350 } });
    app.regionSelected = [{ code: "US-CA", name: "California" }];
    await app.loadRegionObservations();
    await nextTick();
    expect(app.filterSortOptionsSelected).toBe("rarity");
    expect(app.filterSortOptions[0].value).toBe("rarity");
    expect(app.speciesFiltered.map((species) => species.speciesCode)).toEqual(["sbfly", "redcro"]);
  });

  it("keeps taxonomic order and hides the option when there is no rarity data", async () => {
    loadRarityLookups.mockResolvedValue({});
    app.regionSelected = [{ code: "US-CA", name: "California" }];
    await app.loadRegionObservations();
    await nextTick();
    expect(app.filterSortOptionsSelected).toBe("tax");
    expect(app.filterSortOptions.some((option) => option.value === "rarity")).toBe(false);
  });
});
