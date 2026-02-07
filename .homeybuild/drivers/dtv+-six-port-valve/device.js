'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class DtvValveDevice extends Homey.Device {

  async onInit() {
    this._address = this.getSetting('address');
    this.api = this.homey.app.getApi(this._address);
    this._lastInfo = null;

    this.registerCapabilityListener('onoff', this._onCapabilityOnOff.bind(this));
    this.registerCapabilityListener('target_temperature', this._onCapabilityTargetTemp.bind(this));

    // Flow card: Water temperature changed
    this._tempTrigger = this.homey.flow.getDeviceTriggerCard('valve-temperature-changed');

    this.homey.app.registerDevice(this._address, this);
    this.log('DTV+ Valve device initialized (valve', this.getStoreValue('valveNumber'), ')');
  }

  // ── Capability handlers ────────────────────────────────────────────

  async _onCapabilityOnOff(value) {
    const valveNum = this.getStoreValue('valveNumber') || 1;

    if (value) {
      // Open all configured outlets on this valve
      const temp = this._getTargetTempForApi();
      const ports = this.getStoreValue('portsAvailable') || 6;
      const outletStr = KohlerApi.buildOutletString(ports);
      await this._sendShowerCommand(valveNum, outletStr, temp);
    } else {
      // Close this valve's outlets. If the other valve is still active,
      // we must send quick_shower with our outlets zeroed but the other
      // valve preserved. Otherwise just stop everything.
      const otherValve = valveNum === 1 ? 2 : 1;
      const otherRunning = this._isOtherValveRunning(otherValve);

      if (otherRunning) {
        await this._sendShowerCommand(valveNum, '0', 100);
      } else {
        await this.api.stopShower();
      }
    }
    this.homey.app.requestPoll(this._address);
  }

  async _onCapabilityTargetTemp(value) {
    // Only send the command if the valve is currently on
    if (!this.getCapabilityValue('onoff')) return;

    const valveNum = this.getStoreValue('valveNumber') || 1;
    const info = this._lastInfo || {};
    const apiTemp = KohlerApi.fromHomeyTemp(value, info);
    const currentOutlets = this._getCurrentOutletString(valveNum);
    await this._sendShowerCommand(valveNum, currentOutlets, apiTemp);
    this.homey.app.requestPoll(this._address);
  }

  // ── Shower command with cross-valve preservation ───────────────────

  async _sendShowerCommand(valveNum, outletStr, temp) {
    const info = this._lastInfo || {};
    const otherValve = valveNum === 1 ? 2 : 1;

    // Read the other valve's current state from the last poll
    const otherOutlets = this._getCurrentOutletString(otherValve);
    const otherTemp = parseFloat(info[`valve${otherValve}Setpoint`]) || 100;

    const params = {
      valve1Outlet: valveNum === 1 ? outletStr : otherOutlets,
      valve1Temp:   valveNum === 1 ? temp : otherTemp,
      valve2Outlet: valveNum === 2 ? outletStr : otherOutlets,
      valve2Temp:   valveNum === 2 ? temp : otherTemp,
    };

    await this.api.startShower(params);
  }

  // ── Outlet / state helpers ─────────────────────────────────────────

  _getCurrentOutletString(valve) {
    const info = this._lastInfo || {};
    let str = '';
    for (let i = 1; i <= 6; i++) {
      if (info[`valve${valve}outlet${i}`]) {
        str += String(i);
      }
    }
    return str || '0';
  }

  _isOtherValveRunning(otherValve) {
    const info = this._lastInfo || {};
    return info[`valve${otherValve}_Currentstatus`] === 'On';
  }

  _getTargetTempForApi() {
    const homeyTemp = this.getCapabilityValue('target_temperature') || 38;
    const info = this._lastInfo || {};
    return KohlerApi.fromHomeyTemp(homeyTemp, info);
  }

  // ── Centralized polling callbacks ─────────────────────────────────

  async onSystemInfo(info) {
    this._lastInfo = info;
    const v = this.getStoreValue('valveNumber') || 1;

    // Current water temperature
    const rawTemp = KohlerApi.toHomeyTemp(info[`valve${v}Temp`], info);
    if (rawTemp !== null) {
      const prev = this.getCapabilityValue('measure_temperature');
      await this.setCapabilityValue('measure_temperature', rawTemp).catch(this.error);
      if (prev !== rawTemp && this._tempTrigger) {
        this._tempTrigger.trigger(this, { temperature: rawTemp }).catch(this.error);
      }
    }

    // Target temperature (setpoint)
    const rawSetpoint = KohlerApi.toHomeyTemp(info[`valve${v}Setpoint`], info);
    if (rawSetpoint !== null) {
      await this.setCapabilityValue('target_temperature', rawSetpoint).catch(this.error);
    }

    // Valve on/off — true if any outlet on this valve is open
    const isOn = info[`valve${v}_Currentstatus`] === 'On';
    await this.setCapabilityValue('onoff', isOn).catch(this.error);
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
