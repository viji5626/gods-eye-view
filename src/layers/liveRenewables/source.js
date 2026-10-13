/**
 * Live Renewable Energy Source.
 *
 * Fetches real-time electricity grid dispatches from `/api/renewables`.
 */

export function createLiveRenewablesSource({
  url = '/api/renewables',
  fetchFn = fetch,
} = {}) {
  return {
    async fetchLatest(signal) {
      const response = await fetchFn(url, {
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) {
        throw new Error(`Renewables HTTP ${response.status}`);
      }

      const payload = await response.json();
      const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];

      const nodes = rawNodes.filter(
        (n) =>
          n &&
          typeof n.id === 'string' &&
          Number.isFinite(n.lat) &&
          Number.isFinite(n.lon),
      );

      return {
        nodes,
        count: nodes.length,
        fetchedAt: payload?.fetchedAt || Date.now(),
      };
    },
  };
}
