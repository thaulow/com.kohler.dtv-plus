'use strict';

const Homey = require('homey');

module.exports = class DtvSystemControllerDevice extends Homey.Device {

  async onInit() {
    this._address = this.getSetting('address');
    this.api = this.homey.app.getApi(this._address);
    this._lastInfo = null;

    this.registerCapabilityListener('onoff', async (value) => {
      if (value) {
        await this.api.startPreset(1);
      } else {
        await this.api.stopShower();
      }
      this.homey.app.requestPoll(this._address);
    });

    // Flow card: Start shower preset
    this.homey.flow.getActionCard('start-preset')
      .registerRunListener(async (args) => {
        await args.device.api.startPreset(args.preset);
        args.device.homey.app.requestPoll(args.device._address);
      });

    // Flow card: Stop all shower activity
    this.homey.flow.getActionCard('stop-shower')
      .registerRunListener(async (args) => {
        await args.device.api.stopShower();
        await args.device.api.steamOff();
        args.device.homey.app.requestPoll(args.device._address);
      });

    // Flow card: Shower is running (condition)
    this.homey.flow.getConditionCard('shower-is-running')
      .registerRunListener(async (args) => {
        const info = args.device._lastInfo || {};
        return info.valve1_Currentstatus === 'On'
          || info.valve2_Currentstatus === 'On';
      });

    this.homey.app.registerDevice(this._address, this);
    this.log('DTV+ System Controller device initialized at', this._address);
  }

  // Called by app.js when system_info.cgi data arrives
  async onSystemInfo(info) {
    this._lastInfo = info;

    const isOn = info.ui_shower_on === true
      || info.ui_shower_on === 'true'
      || info.valve1_Currentstatus === 'On'
      || info.valve2_Currentstatus === 'On';

    await this.setCapabilityValue('onoff', isOn).catch(this.error);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('address')) {
      this.homey.app.unregisterDevice(this._address, this);
      this._address = newSettings.address;
      this.api = this.homey.app.getApi(this._address);
      this.homey.app.registerDevice(this._address, this);
      this.log('Controller address updated to', this._address);
    }
  }

  onDeleted() {
    this.homey.app.unregisterDevice(this._address, this);
  }

};
