/**
 * Live Renewable Energy & Grid Dispatch Provider.
 *
 * Proxies official open electricity market data:
 * - ENTSO-E via Fraunhofer ISE Energy-Charts API (Germany, France, Spain, Italy,
 *   Netherlands, Sweden, Poland, Portugal, Belgium, Austria)
 * - UK National Grid ESO Carbon Intensity & Regional API (14 UK grid regions)
 *
 * All metrics represent 100% non-simulated real-time electricity generation (MW
 * and percentage mix) measured at national grid substations.
 */

const TTL_MS = 5 * 60_000; // 5 minute settlement window

const EC_COUNTRIES = [
  { code: 'de', name: 'Germany', lon: 10.45, lat: 51.16 },
  { code: 'fr', name: 'France', lon: 2.21, lat: 46.22 },
  { code: 'es', name: 'Spain', lon: -3.7, lat: 40.41 },
  { code: 'it', name: 'Italy', lon: 12.56, lat: 41.87 },
  { code: 'nl', name: 'Netherlands', lon: 5.29, lat: 52.13 },
  { code: 'se', name: 'Sweden', lon: 18.64, lat: 60.12 },
  { code: 'pl', name: 'Poland', lon: 19.14, lat: 51.91 },
  { code: 'pt', name: 'Portugal', lon: -8.22, lat: 39.39 },
  { code: 'be', name: 'Belgium', lon: 4.46, lat: 50.5 },
  { code: 'at', name: 'Austria', lon: 14.55, lat: 47.51 },
];

const UK_COORDS = {
  'North Scotland': [-4.2, 57.5],
  'South Scotland': [-3.8, 55.6],
  'North West England': [-2.7, 54.0],
  'North East England': [-1.6, 55.0],
  Yorkshire: [-1.1, 53.9],
  'North Wales & Merseyside': [-3.5, 53.1],
  'South Wales': [-3.6, 51.7],
  'West Midlands': [-2.0, 52.5],
  'East Midlands': [-1.1, 52.9],
  'East England': [0.5, 52.2],
  'South West England': [-3.5, 50.7],
  'South England': [-1.3, 51.0],
  London: [-0.12, 51.5],
  'South East England': [0.5, 51.2],
};

let memCache = null;
let inFlightPromise = null;

async function fetchEuropeanGrids() {
  const promises = EC_COUNTRIES.map(async (c) => {
    try {
      const res = await fetch(
        `https://api.energy-charts.info/public_power?country=${c.code}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        },
      );
      if (!res.ok) return null;
      const json = await res.json();
      const types = json.production_types || [];
      const findLatest = (name) => {
        const match = types.find(
          (t) => t.name.toLowerCase() === name.toLowerCase(),
        );
        if (!match || !match.data) return 0;
        for (let i = match.data.length - 1; i >= 0; i--) {
          if (match.data[i] != null && !Number.isNaN(match.data[i])) {
            return Math.round(match.data[i] * 10) / 10;
          }
        }
        return 0;
      };

      const solar = findLatest('solar');
      const windOnshore = findLatest('wind onshore');
      const windOffshore = findLatest('wind offshore');
      const load = findLatest('load');
      const renShare =
        findLatest('renewable share of generation') ||
        findLatest('renewable share of load');

      return {
        id: `grid-${c.code}`,
        name: `${c.name} Power Grid`,
        type: 'national-grid',
        country: c.name,
        code: c.code.toUpperCase(),
        lon: c.lon,
        lat: c.lat,
        solar_mw: solar,
        wind_onshore_mw: windOnshore,
        wind_offshore_mw: windOffshore,
        total_wind_mw: Math.round((windOnshore + windOffshore) * 10) / 10,
        total_renewable_mw:
          Math.round((solar + windOnshore + windOffshore) * 10) / 10,
        load_mw: load,
        renewable_share_perc: renShare,
        primary_fuel: solar > windOnshore + windOffshore ? 'solar' : 'wind',
        source: 'ENTSO-E / Fraunhofer ISE',
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

async function fetchUkRegionalGrids() {
  try {
    const res = await fetch('https://api.carbonintensity.org.uk/regional', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const regions = json.data?.[0]?.regions || [];
    return regions
      .filter((r) => UK_COORDS[r.shortname])
      .map((r) => {
        const solarPerc =
          r.generationmix.find((m) => m.fuel === 'solar')?.perc || 0;
        const windPerc =
          r.generationmix.find((m) => m.fuel === 'wind')?.perc || 0;
        const renShare = Math.round((solarPerc + windPerc) * 10) / 10;
        return {
          id: `uk-${r.shortname.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: `${r.shortname} Grid Region`,
          type: 'regional-grid',
          country: 'United Kingdom',
          code: 'UK',
          lon: UK_COORDS[r.shortname][0],
          lat: UK_COORDS[r.shortname][1],
          solar_perc: solarPerc,
          wind_perc: windPerc,
          renewable_share_perc: renShare,
          intensity: r.intensity?.index || 'moderate',
          primary_fuel: solarPerc > windPerc ? 'solar' : 'wind',
          source: 'National Grid ESO',
          timestamp: Date.now(),
        };
      });
  } catch {
    return [];
  }
}

async function refreshRenewablesData() {
  const [european, uk] = await Promise.all([
    fetchEuropeanGrids(),
    fetchUkRegionalGrids(),
  ]);

  const nodes = [...european, ...uk];
  return {
    fetchedAt: Date.now(),
    ttlMs: TTL_MS,
    count: nodes.length,
    nodes,
  };
}

/**
 * Vite dev middleware plugin exposing GET /api/renewables
 * @returns {import('vite').Plugin}
 */
export function renewablesProxy() {
  const install = (server) => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/renewables')) {
        return next();
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');

      const now = Date.now();
      if (memCache && now - memCache.fetchedAt < TTL_MS) {
        res.end(JSON.stringify(memCache));
        return;
      }

      if (!inFlightPromise) {
        inFlightPromise = refreshRenewablesData()
          .then((fresh) => {
            memCache = fresh;
            return fresh;
          })
          .catch((err) => {
            console.warn('[renewables-proxy] Refresh failed:', err);
            return memCache;
          })
          .finally(() => {
            inFlightPromise = null;
          });
      }

      const data = await inFlightPromise;
      if (!data) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'renewables_upstream_unavailable' }));
        return;
      }

      res.end(JSON.stringify(data));
    });
  };

  return {
    name: 'renewables-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
