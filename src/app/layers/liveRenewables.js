import {
  createLiveRenewablesLayer,
  createLiveRenewablesSource,
} from '../../layers/liveRenewables/index.js';
import { overlayHost } from './overlayHost.js';

/** Wire live renewable energy grid layer to the application overlay host. */
export function createApplicationLiveRenewables(options = {}) {
  const source = options.source || createLiveRenewablesSource();
  return createLiveRenewablesLayer({ overlayHost, source, ...options });
}
