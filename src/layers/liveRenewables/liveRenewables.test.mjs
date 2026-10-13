import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fuelColor,
  fuelIcon,
  createRenewableOverlayEntry,
  selectRenewablesOverlayCohort,
  mapAnalystRecord,
} from './model.js';
import { createLiveRenewablesSource } from './source.js';
import { createLiveRenewablesLayer } from './index.js';

test('fuelColor returns amber for solar, cyan for wind, emerald for >70% clean', () => {
  assert.equal(fuelColor('solar', 40), '#ffaa00');
  assert.equal(fuelColor('wind', 50), '#00e5ff');
  assert.equal(fuelColor('solar', 75), '#00ff88');
  assert.equal(fuelColor('wind', 85), '#00ff88');
});

test('fuelIcon returns intuitive icons', () => {
  assert.equal(fuelIcon('solar'), '☀️');
  assert.equal(fuelIcon('wind'), '💨');
  assert.equal(fuelIcon('unknown'), '⚡');
});

test('createRenewableOverlayEntry builds prioritized label overlay', () => {
  const entry = createRenewableOverlayEntry({
    id: 'grid-de',
    name: 'Germany Power Grid',
    country: 'Germany',
    lat: 51.16,
    lon: 10.45,
    solar_mw: 7358.6,
    total_wind_mw: 24179.3,
    renewable_share_perc: 62,
    primary_fuel: 'wind',
  });

  assert.equal(entry.id, 'overlay:renewable:grid-de');
  assert.equal(entry.entityId, 'live-renewables:grid-de');
  assert.ok(entry.title.includes('7.4GW'));
  assert.ok(entry.title.includes('24.2GW'));
  assert.equal(entry.subtitle, 'Germany Power Grid (62% Clean)');
  assert.equal(entry.accent, '#00e5ff');
  assert.equal(entry.priority, 62);
});

test('selectRenewablesOverlayCohort prioritizes highest renewable penetration', () => {
  const nodes = [
    { id: 'grid-1', renewable_share_perc: 30 },
    { id: 'grid-2', renewable_share_perc: 85 },
    { id: 'grid-3', renewable_share_perc: 55 },
  ];
  const sorted = selectRenewablesOverlayCohort(nodes, 2);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].id, 'grid-2'); // 85% first
  assert.equal(sorted[1].id, 'grid-3'); // 55% second
});

test('mapAnalystRecord generates rich SCADA briefing card', () => {
  const record = mapAnalystRecord({
    id: 'grid-de',
    name: 'Germany Power Grid',
    country: 'Germany',
    lat: 51.16,
    lon: 10.45,
    solar_mw: 7358,
    wind_onshore_mw: 17638,
    wind_offshore_mw: 6541,
    total_wind_mw: 24179,
    total_renewable_mw: 31537,
    load_mw: 63481,
    renewable_share_perc: 62,
    primary_fuel: 'wind',
    source: 'ENTSO-E / Fraunhofer ISE',
  });

  assert.equal(record.id, 'live-renewables:grid-de');
  assert.equal(record.layerId, 'live-renewables');
  assert.equal(record.badge.text, '62% CLEAN');
  assert.ok(record.sections[0].content.includes('Solar Generation: 7,358 MW'));
  assert.ok(record.sections[0].content.includes('Wind Offshore: 6,541 MW'));
  assert.ok(record.sections[0].content.includes('Total Grid Demand: 63,481 MW'));
  assert.ok(
    record.sections[1].content.includes('100% Non-Simulated Meter Data'),
  );
});

test('createLiveRenewablesSource filters invalid records and handles responses', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      fetchedAt: 1700000000000,
      nodes: [
        { id: 'node-1', lat: 50.0, lon: 10.0 },
        { id: 'node-invalid', lat: null, lon: 10.0 },
      ],
    }),
  });

  const source = createLiveRenewablesSource({ fetchFn: mockFetch });
  const result = await source.fetchLatest();
  assert.equal(result.count, 1);
  assert.equal(result.nodes[0].id, 'node-1');
  assert.equal(result.fetchedAt, 1700000000000);
});

test('createLiveRenewablesLayer manages lifecycle', () => {
  const mockOverlayHost = {
    setVisible: () => {},
    clearSource: () => {},
    setEntries: () => {},
  };
  const mockSource = {
    fetchLatest: async () => ({ nodes: [], count: 0, fetchedAt: Date.now() }),
  };

  const layer = createLiveRenewablesLayer({
    source: mockSource,
    overlayHost: mockOverlayHost,
  });

  assert.equal(layer.id, 'live-renewables');
  assert.equal(layer.name, 'Renewable Grid');
  assert.equal(layer.getStatus().enabled, false);

  const mockViewer = {
    dataSources: {
      add: () => {},
      remove: () => {},
    },
  };

  layer.init(mockViewer);
  layer.enable();
  assert.equal(layer.getStatus().enabled, true);

  layer.disable();
  assert.equal(layer.getStatus().enabled, false);

  layer.destroy(mockViewer);
});
