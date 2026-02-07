'use strict';

const Homey = require('homey');
const KohlerApi = require('./lib/KohlerApi');

// Poll intervals — keep these gentle on the fragile DTV+ controller.
// Only ONE request per interval per controller IP, regardless of device count.
const STATUS_POLL_INTERVAL = 30_000;  // system_info.cgi every 30 s
const CONFIG_POLL_INTERVAL = 300_000; // values.cgi every 5 min
const COMMAND_POLL_DELAY = 2_000;     // extra poll 2 s after a command

module.exports = class KohlerKonnectApp extends Homey.App {

  async onInit() {
    this._controllers = {}; // address → controller state
    this.log('KOHLER Konnect has been initialized');
  }

  // ── API access ─────────────────────────────────────────────────────

  getApi(address) {
    return this._ensureController(address).api;
  }

  // ── Device registration ────────────────────────────────────────────
  // Every device calls registerDevice() in onInit and unregisterDevice()
  // in onDeleted. The app starts polling when the first device registers
  // for a controller and stops when the last device unregisters.

  registerDevice(address, device) {
    const ctrl = this._ensureController(address);
    ctrl.devices.add(device);

    // Start polling if this is the first device
    if (ctrl.devices.size === 1) {
      this._startPolling(address);
    }

    // Send the last known state immediately so the device doesn't
    // have to wait for the next poll cycle.
    if (ctrl.lastInfo) {
      device.onSystemInfo(ctrl.lastInfo).catch(() => {});
    }
    if (ctrl.lastValues && typeof device.onValues === 'function') {
      device.onValues(ctrl.lastValues).catch(() => {});
    }
  }

  unregisterDevice(address, device) {
    const ctrl = this._controllers[address];
    if (!ctrl) return;
    ctrl.devices.delete(device);

    if (ctrl.devices.size === 0) {
      this._stopPolling(address);
      delete this._controllers[address];
    }
  }

  /**
   * Request a one-off extra poll shortly after a command so devices see
   * the result without waiting for the next cycle. Debounced — multiple
   * commands within COMMAND_POLL_DELAY produce only one poll.
   */
  requestPoll(address) {
    const ctrl = this._controllers[address];
    if (!ctrl || ctrl._pendingPoll) return;
    ctrl._pendingPoll = true;
    this.homey.setTimeout(() => {
      ctrl._pendingPoll = false;
      this._pollStatus(address).catch(() => {});
    }, COMMAND_POLL_DELAY);
  }

  // ── Controller discovery (used by subordinate drivers during pairing) ──

  getControllerAddresses() {
    try {
      const scDriver = this.homey.drivers.getDriver('dtv+-system-controller');
      return scDriver.getDevices().map((d) => ({
        address: d.getSetting('address'),
        name: d.getName(),
      }));
    } catch {
      return [];
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  _ensureController(address) {
    if (!this._controllers[address]) {
      this._controllers[address] = {
        api: new KohlerApi({ address }),
        devices: new Set(),
        lastInfo: null,
        lastValues: null,
        statusInterval: null,
        configInterval: null,
        _pendingPoll: false,
      };
    }
    return this._controllers[address];
  }

  _startPolling(address) {
    const ctrl = this._controllers[address];

    // system_info.cgi — real-time status
    this._pollStatus(address).catch(() => {});
    ctrl.statusInterval = this.homey.setInterval(
      () => this._pollStatus(address).catch(() => {}),
      STATUS_POLL_INTERVAL,
    );

    // values.cgi — configuration + steam status
    this._pollConfig(address).catch(() => {});
    ctrl.configInterval = this.homey.setInterval(
      () => this._pollConfig(address).catch(() => {}),
      CONFIG_POLL_INTERVAL,
    );

    this.log(`Polling started for controller at ${address}`);
  }

  _stopPolling(address) {
    const ctrl = this._controllers[address];
    if (!ctrl) return;
    if (ctrl.statusInterval) this.homey.clearInterval(ctrl.statusInterval);
    if (ctrl.configInterval) this.homey.clearInterval(ctrl.configInterval);
    ctrl.statusInterval = null;
    ctrl.configInterval = null;
    this.log(`Polling stopped for controller at ${address}`);
  }

  async _pollStatus(address) {
    const ctrl = this._controllers[address];
    if (!ctrl) return;
    try {
      const info = await ctrl.api.getSystemInfo();
      ctrl.lastInfo = info;
      for (const device of ctrl.devices) {
        device.onSystemInfo(info).catch((err) => {
          this.error(`Device ${device.getName()} status update failed:`, err.message);
        });
      }
    } catch (err) {
      this.error(`system_info poll failed for ${address}:`, err.message);
    }
  }

  async _pollConfig(address) {
    const ctrl = this._controllers[address];
    if (!ctrl) return;
    try {
      const values = await ctrl.api.getValues();
      ctrl.lastValues = values;
      for (const device of ctrl.devices) {
        if (typeof device.onValues === 'function') {
          device.onValues(values).catch((err) => {
            this.error(`Device ${device.getName()} config update failed:`, err.message);
          });
        }
      }
    } catch (err) {
      this.error(`values poll failed for ${address}:`, err.message);
    }
  }

};
