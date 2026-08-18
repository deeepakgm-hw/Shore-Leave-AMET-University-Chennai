const { createFingerprintProvider } = require('./providers');

class FingerprintBridgeClient {
  constructor({ io, logger = console } = {}) {
    this.io = io;
    this.logger = logger;
    this.provider = createFingerprintProvider({ logger });
    this.lastStatus = {
      connected: false,
      configured: true,
      provider: process.env.FINGERPRINT_DEVICE_TYPE || 'MANTRA_MFS110',
      providerMode: 'INITIALIZING',
      deviceModel: process.env.FINGERPRINT_DEVICE_LABEL || 'Mantra MFS110',
      serialNumber: null,
      sdkVersion: null,
      checkedAt: null,
      code: 'INITIALIZING'
    };
    this.heartbeat = null;
  }

  async status() {
    this.lastStatus = await this.provider.status();
    return this.lastStatus;
  }

  async capture() {
    return this.provider.capture();
  }

  async match(storedTemplate, liveTemplate) {
    return this.provider.match(storedTemplate, liveTemplate);
  }

  startHeartbeat() {
    if (this.heartbeat) return;
    const interval = Math.max(5_000, Number(process.env.FINGERPRINT_HEARTBEAT_MS) || 10_000);
    this.heartbeat = setInterval(async () => {
      const previous = this.lastStatus.connected;
      const status = await this.status();
      this.io?.emit('fingerprint:device-status', status);
      if (previous !== status.connected) {
        this.logger.info?.(`[FINGERPRINT] ${status.deviceModel || 'Mantra MFS110'} ${status.connected ? 'connected' : 'offline'} (${status.providerMode || status.provider || 'provider'})`);
      }
    }, interval);
    this.heartbeat.unref?.();
    this.status().then((status) => this.io?.emit('fingerprint:device-status', status));
  }
}

// Keep existing export names so current imports, routes, and deployments stay compatible.
const MantraMfs110Sdk = FingerprintBridgeClient;

module.exports = { FingerprintBridgeClient, MantraMfs110Sdk };
