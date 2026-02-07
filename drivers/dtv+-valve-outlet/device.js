'use strict';

const Homey = require('homey');

module.exports = class DtvValveOutletDevice extends Homey.Device {

  async onInit() {
    this._address = this.getSetting('address');
    this.api = this.homey.app.getApi(this._address);
    this._lastInfo = null;

    this.registerCapabilityListener('onoff', this._onCapabilityOnOff.bind(this));

    this.homey.app.registerDevice(this._address, this);

    const v = this.getStoreValue('valveNumber');
    const o = this.getStoreValue('outletNumber');
    this.log(`DTV+ Valve Outlet initialized (valve ${v}, outlet ${o})`);
  }

  // ── Capability handler ─────────────────────────────────────────────

  async _onCapabilityOnOff(value) {
    const valveNum = this.getStoreValue('valveNumber');
    const outletNum = this.getStoreValue('outletNumber');
    const info = this._lastInfo || {};

    // Build outlet strings for BOTH valves, flipping only our outlet
    const valve1Outlets = this._buildOutletString(1,
      valveNum === 1 ? outletNum : null,
      valveNum === 1 ? value : null,
    );
    const valve2Outlets = this._buildOutletString(2,
      valveNum === 2 ? outletNum : null,
      valveNum === 2 ? value : null,
    );

    // If every outlet on every valve is now closed, stop the shower
    if (valve1Outlets === '0' && valve2Outlets === '0') {
      await this.api.stopShower();
      this.homey.app.requestPoll(this._address);
      return;
    }

    // Otherwise send the full state to the controller
    const valve1Temp = parseFloat(info.valve1Setpoint) || 100;
    const valve2Temp = parseFloat(info.valve2Setpoint) || 100;

    await this.api.startShower({
      valve1Outlet: valve1Outlets,
      valve1Temp: valve1Temp,
      valve2Outlet: valve2Outlets,
      valve2Temp: valve2Temp,
    });
    this.homey.app.requestPoll(this._address);
  }

  /**
   * Build the outlet string for a valve from the last polled state,
   * optionally toggling one specific outlet.
   */
  _buildOutletString(valve, toggle, state) {
    const info = this._lastInfo || {};
    let str = '';
    for (let i = 1; i <= 6; i++) {
      let isOpen = !!info[`valve${valve}outlet${i}`];
      if (toggle === i) {
        isOpen = state;
      }
      if (isOpen) {
        str += String(i);
      }
    }
    return str || '0';
  }

  // ── Centralized polling callback ──────────────────────────────────

  async onSystemInfo(info) {
    this._lastInfo = info;

    const v = this.getStoreValue('valveNumber');
    const o = this.getStoreValue('outletNumber');
    const isOpen = !!info[`valve${v}outlet${o}`];
    await this.setCapabilityValue('onoff', isOpen).catch(this.error);
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
