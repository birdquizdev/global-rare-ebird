// Per-state record counts generated from the eBird Basic Dataset (see scripts/generate-rarity.mjs).
const rarityTables = {
  "US-CA": () => import("../../data/rarity-us-ca.json"),
}

const tablePromises = new Map()

function loadRarityTable(stateCode) {
  if (!tablePromises.has(stateCode)) {
    tablePromises.set(stateCode, rarityTables[stateCode]().then(({ default: table }) => table.counts).catch((error) => {
      tablePromises.delete(stateCode)
      throw error
    }))
  }

  return tablePromises.get(stateCode)
}

// Returns { [stateCode]: { [speciesCode]: recordCount } } for states that have a populated table.
export async function loadRarityLookups(observations) {
  const stateCodes = new Set(observations.map((obs) => obs.subnational1Code).filter((code) => rarityTables[code]))
  const lookups = {}

  await Promise.all([...stateCodes].map(async (stateCode) => {
    const counts = await loadRarityTable(stateCode)
    if (Object.keys(counts).length) lookups[stateCode] = counts
  }))

  return lookups
}

// A species missing from a state's table has no earlier records, so it counts as the rarest (0).
export function applyRarityToObservations(observations, lookups) {
  for (const obs of observations) {
    const counts = lookups[obs.subnational1Code]
    obs.rarityCount = counts ? (counts[obs.speciesCode] ?? 0) : null
  }

  return observations
}
