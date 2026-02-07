'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class InvigorationSteamerDevice extends Homey.Device {

  async onInit() {
    this._address = this.getSetting('address');
    this.api = this.homey.app.getApi(this._address);
    this._lastInfo = null;

    this.registerCapabilityListener('onoff', async (value) => {
      if (value) {
        const duration = this.getSetting('steamDuration') || 10;
        const temp = this._getTargetTempForApi();
        await this.api.steamOn(temp, duration);
      } else {
        await this.api.steamOff();
      }
      this.homey.app.requestPoll(this._address);
    });

    this.registerCapabilityListener('target_temperature', async (value) => {
      // Only send the command if steam is currently running
      const isOn = this.getCapabilityValue('onoff');
      if (isOn) {
        const info = this._lastInfo || {};
        const apiTemp = KohlerApi.fromHomeyTemp(value, info);
        const duration = this.getSetting('steamDuration') || 10;
        await this.api.steamOn(apiTemp, duration);
        this.homey.app.requestPoll(this._address);
      }
    });

    // Flow card: Start steam with custom duration
    this.homey.flow.getActionCard('start-steam-duration')
      .registerRunListener(async (args) => {
        const info = args.device._lastInfo || {};
        const apiTemp = KohlerApi.fromHomeyTemp(args.temperature, info);
        await args.device.api.steamOn(apiTemp, args.duration);
        args.device.homey.app.requestPoll(args.device._address);
      });

    this.homey.app.registerDevice(this._address, this);
    this.log('Invigoration Steamer device initialized');
  }

  _getTargetTempForApi() {
    const homeyTemp = this.getCapabilityValue('target_temperature') || 43;
    const info = this._lastInfo || {};
    return KohlerApi.fromHomeyTemp(homeyTemp, info);
  }

  // Called by app.js when system_info.cgi data arrives
  async onSystemInfo(info) {
    this._lastInfo = info;
  }

  // Called by app.js when values.cgi data arrives
  async onValues(values) {
    // steam_running comes from values.cgi
    const steamOn = values.steam_running === true
      || values.steam_running === 'true'
      || values.steam_running === 1
      || values.steam_running === '1';
    await this.setCapabilityValue('onoff', steamOn).catch(this.error);
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
