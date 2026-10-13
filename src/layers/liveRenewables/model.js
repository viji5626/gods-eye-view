/**
 * Live Renewable Energy & Grid Dispatch Layer Models.
 *
 * Visual styles, WorldOverlay label builder, and Analyst SCADA record mapping
 * for 100% non-simulated real-time electricity grid telemetry.
 */

export const RENEWABLE_OVERLAY_SOURCE_ID = 'live-renewables';
export const RENEWABLE_OVERLAY_COHORT_LIMIT = 32;

/**
 * Palette accents based on clean energy penetration & primary generation fuel.
 */
export function fuelColor(fuel, cleanShare = 50) {
  if (cleanShare >= 70) return '#00ff88'; // Neon green for ultra-clean grids (>70%)
  if (fuel === 'solar') return '#ffaa00'; // Amber gold for solar
  return '#00e5ff'; // Cyan aero for wind
}

export function fuelIcon(fuel) {
  if (fuel === 'solar') return '☀️';
  if (fuel === 'wind') return '💨';
  return '⚡';
}

/**
 * Produce a WorldOverlay entry for screen projection above the grid hub.
 * @param {object} node Normalized grid dispatch node.
 * @param {object} position Cartesian3 stem-tip position.
 */
export function createRenewableOverlayEntry(node, position = null) {
  if (!node || !Number.isFinite(node.lat) || !Number.isFinite(node.lon)) {
    return null;
  }

  const icon = fuelIcon(node.primary_fuel);
  const color = fuelColor(node.primary_fuel, node.renewable_share_perc);
  const share = Math.round(node.renewable_share_perc || 0);

  let title = '';
  if (node.solar_mw != null && node.total_wind_mw != null) {
    const sGw = (node.solar_mw / 1000).toFixed(1);
    const wGw = (node.total_wind_mw / 1000).toFixed(1);
    title = `☀️ ${sGw}GW · 💨 ${wGw}GW`;
  } else if (node.wind_perc != null) {
    title = `💨 ${node.wind_perc}% · ☀️ ${node.solar_perc}%`;
  } else {
    title = `${icon} ${share}% Clean`;
  }

  const subtitle = `${node.name || node.country} (${share}% Clean)`;

  const cartesianPosition =
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
      ? position
      : { x: node.lon, y: node.lat, z: 0 };

  return {
    sourceId: RENEWABLE_OVERLAY_SOURCE_ID,
    id: `overlay:renewable:${node.id}`,
    entityId: `live-renewables:${node.id}`,
    position: cartesianPosition,
    variant: 'label',
    title,
    subtitle,
    accent: color,
    priority: share,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 12,
    verticalOnly: true,
    placement: 'above',
    raw: node,
  };
}

/**
 * Filter and sort top grid entries for HUD overlay rendering (cleanest grids first).
 */
export function selectRenewablesOverlayCohort(
  nodes,
  limit = RENEWABLE_OVERLAY_COHORT_LIMIT,
) {
  if (!Array.isArray(nodes)) return [];
  return [...nodes]
    .sort(
      (a, b) => (b.renewable_share_perc || 0) - (a.renewable_share_perc || 0),
    )
    .slice(0, limit);
}

/**
 * Format analyst card intelligence briefing for clicked grid hub.
 */
export function mapAnalystRecord(node) {
  if (!node) return null;
  const icon = fuelIcon(node.primary_fuel);
  const share = Math.round(node.renewable_share_perc || 0);
  const color = fuelColor(node.primary_fuel, share);

  const breakdownLines = [];
  if (node.solar_mw != null) {
    breakdownLines.push(
      `Solar Generation: ${node.solar_mw.toLocaleString()} MW`,
    );
  } else if (node.solar_perc != null) {
    breakdownLines.push(`Solar Share: ${node.solar_perc}%`);
  }

  if (node.wind_onshore_mw != null) {
    breakdownLines.push(
      `Wind Onshore: ${node.wind_onshore_mw.toLocaleString()} MW`,
    );
  }
  if (node.wind_offshore_mw != null) {
    breakdownLines.push(
      `Wind Offshore: ${node.wind_offshore_mw.toLocaleString()} MW`,
    );
  }
  if (node.total_wind_mw != null) {
    breakdownLines.push(
      `Total Wind: ${node.total_wind_mw.toLocaleString()} MW`,
    );
  } else if (node.wind_perc != null) {
    breakdownLines.push(`Wind Share: ${node.wind_perc}%`);
  }

  if (node.total_renewable_mw != null) {
    breakdownLines.push(
      `Combined Clean Generation: ${node.total_renewable_mw.toLocaleString()} MW`,
    );
  }
  if (node.load_mw != null) {
    breakdownLines.push(
      `Total Grid Demand: ${node.load_mw.toLocaleString()} MW`,
    );
  }

  breakdownLines.push(`Clean Power Penetration: ${share}%`);

  return {
    id: `live-renewables:${node.id}`,
    entityId: `live-renewables:${node.id}`,
    layerId: 'live-renewables',
    title: `${icon} ${node.name || node.country}`,
    subtitle: `${node.country} · ${node.source || 'Electricity Grid'}`,
    badge: {
      text: `${share}% CLEAN`,
      color,
    },
    location: {
      lat: node.lat,
      lon: node.lon,
      alt: 0,
    },
    sections: [
      {
        title: 'Real-Time Power Dispatch (Actuals)',
        content: breakdownLines.join('\n'),
      },
      {
        title: 'Grid Operator & Verification',
        content: `Source: ${node.source || 'ENTSO-E / National Grid'}\nResolution: 15-min settlement actuals\nData Quality: 100% Non-Simulated Meter Data`,
      },
    ],
    raw: node,
  };
}
