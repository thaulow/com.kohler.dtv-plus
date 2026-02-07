'use strict';

const Homey = require('homey');

module.exports = class DtvAmplifierDevice extends Homey.Device {

  async onInit() {
    this._address = this.getSetting('address');
    this.api = this.homey.app.getApi(this._address);

    this.registerCapabilityListener('onoff', async (value) => {
      if (value) {
        const vol = Math.round((this.getCapabilityValue('volume_set') || 0.5) * 100);
        await this.api.musicOn(vol);
      } else {
        await this.api.musicOff();
      }
      this.homey.app.requestPoll(this._address);
    });

    this.registerCapabilityListener('volume_set', async (value) => {
      const vol = Math.round(value * 100);
      await this.api.musicOn(vol);
      // Turning volume up while off implicitly turns music on
      if (!this.getCapabilityValue('onoff')) {
        await this.setCapabilityValue('onoff', true).catch(this.error);
      }
      this.homey.app.requestPoll(this._address);
    });

    this.homey.app.registerDevice(this._address, this);
    this.log('DTV+ Amplifier device initialized');
  }

  // Called by app.js when system_info.cgi data arrives
  async onSystemInfo(info) {
    // volStatus is e.g. "50%"
    const volStr = info.volStatus;
    if (typeof volStr === 'string') {
      const pct = parseInt(volStr, 10);
      if (!isNaN(pct)) {
        await this.setCapabilityValue('volume_set', pct / 100).catch(this.error);
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('address')) {
      this.homey.app.unregisterDevice(this._address, this);
      this._address = newSettings.address;
      this.api = this.homey.app.getApi(this._address);
      this.homey.app.registerDevice(this._address, this);
    }
  }

  onDeleted() {
    this.homey.app.unregisterDevice(this._address, this);
  }

};
