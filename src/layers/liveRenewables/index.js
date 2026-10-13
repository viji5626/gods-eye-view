import * as Cesium from 'cesium';
import {
  RENEWABLE_OVERLAY_SOURCE_ID,
  RENEWABLE_OVERLAY_COHORT_LIMIT,
  fuelColor,
  fuelIcon,
  createRenewableOverlayEntry,
  selectRenewablesOverlayCohort,
  mapAnalystRecord,
} from './model.js';
import { registerEntityContext } from '../../data/contextStore.js';

export * from './model.js';
export { createLiveRenewablesSource } from './source.js';

const ENTITY_PREFIX = 'live-renewable:';

/**
 * Own live renewable energy & grid generation display and its lifecycle.
 */
export function createLiveRenewablesLayer({ source, overlayHost } = {}) {
  if (typeof source?.fetchLatest !== 'function') {
    throw new TypeError('Live renewables require a fetchLatest source');
  }
  if (!overlayHost) {
    throw new TypeError('Live renewables require an overlay host');
  }

  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'live-renewables',
    name: 'Renewable Grid',
    icon: '⚡',
    source: 'ENTSO-E / National Grid',
    updateInterval: 60000,

    init(viewer) {
      if (_viewer) throw new Error('Live renewables layer already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('live-renewables');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(RENEWABLE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Renewables] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(RENEWABLE_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(RENEWABLE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RENEWABLE_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;

      try {
        const { nodes, count } = await source.fetchLatest(request.signal);
        if (request.signal.aborted || _request !== request || !_enabled) {
          return false;
        }

        const nextEntities = [];
        const overlayEntries = [];

        for (const node of nodes) {
          const { id, name, lon, lat, primary_fuel, renewable_share_perc } =
            node;
          const share = Math.round(renewable_share_perc || 0);
          const colorHex = fuelColor(primary_fuel, share);
          const color = Cesium.Color.fromCssColorString(colorHex);
          const isNational = node.type === 'national-grid';
          const radius = isNational ? 90000 : 45000;

          const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

          const entity = new Cesium.Entity({
            id: `${ENTITY_PREFIX}${id}`,
            name: `${fuelIcon(primary_fuel)} ${name}`,
            position,
            ellipse: {
              semiMajorAxis: radius,
              semiMinorAxis: radius,
              material: new Cesium.ColorMaterialProperty(
                color.withAlpha(isNational ? 0.35 : 0.22),
              ),
              outline: true,
              outlineColor: color.withAlpha(0.85),
              outlineWidth: isNational ? 3 : 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            point: {
              pixelSize: isNational ? 12 : 9,
              color,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: {
              nodeId: id,
              name,
              country: node.country,
              primaryFuel: primary_fuel,
              renewableShare: share,
              solarMw: node.solar_mw,
              windMw: node.total_wind_mw,
              loadMw: node.load_mw,
              source: node.source,
              rawNode: node,
            },
          });

          registerEntityContext(entity, mapAnalystRecord(node));
          nextEntities.push(entity);

          const overlayItem = createRenewableOverlayEntry(node, position);
          if (overlayItem) overlayEntries.push(overlayItem);
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);

        if (_enabled) {
          overlayHost.setEntries(
            RENEWABLE_OVERLAY_SOURCE_ID,
            selectRenewablesOverlayCohort(overlayEntries),
            {
              cohortLimit: RENEWABLE_OVERLAY_COHORT_LIMIT,
              collisionCapacity: 40,
              moving: false,
            },
          );
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Renewables] Updated: ${_count} grid dispatch hubs`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled) {
          return false;
        }
        console.warn('[Data:Renewables] Fetch error:', e);
        _lastError = e?.message || 'Renewable grid source unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(RENEWABLE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RENEWABLE_OVERLAY_SOURCE_ID, false);
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStatus() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        lastError: _lastError,
        enabled: _enabled,
      };
    },
  };

  return layer;
}
