'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class KohlerDtvDevice extends Homey.Device {

  async onInit() {
    this._address = this.getSetting('address');
    this.api = this.homey.app.getApi(this._address);
    this._lastInfo = null;
    this._deviceType = this.getStoreValue('deviceType');

    // Set device class based on type
    const CLASS_MAP = {
      valve: 'other',
      amplifier: 'speaker',
      steamer: 'heater',
      light: 'light',
    };
    const targetClass = CLASS_MAP[this._deviceType] || 'other';
    if (this.getClass() !== targetClass) {
      await this.setClass(targetClass);
    }

    // Route to type-specific init
    switch (this._deviceType) {
      case 'valve':      this._initValve(); break;
      case 'amplifier':  this._initAmplifier(); break;
      case 'steamer':    this._initSteamer(); break;
      case 'light':      this._initLight(); break;
      default:
        this.error('Unknown deviceType:', this._deviceType);
    }

    this.homey.app.registerDevice(this._address, this);
    this.log(`Kohler DTV+ device initialized: ${this._deviceType} at ${this._address}`);
  }

  // ══════════════════════════════════════════════════════════════════
  // VALVE
  // ══════════════════════════════════════════════════════════════════

  _initValve() {
    // Set initial temperature from the controller's default setpoint
    const defaultSetpoint = this.getStoreValue('defaultSetpoint');
    if (defaultSetpoint != null && this.getCapabilityValue('target_temperature') == null) {
      this.setCapabilityValue('target_temperature', defaultSetpoint).catch(this.error);
    }

    this.registerCapabilityListener('shower_toggle', this._onValveOnOff.bind(this));
    this.registerCapabilityListener('target_temperature', this._onValveTargetTemp.bind(this));

    // Register listeners for each outlet toggle and set per-type icons
    const ports = this.getStoreValue('portsAvailable') || 6;
    const outlets = this.getStoreValue('outlets') || [];
    for (let i = 1; i <= ports; i++) {
      const capId = `outlet_${i}`;
      if (this.hasCapability(capId)) {
        this.registerCapabilityListener(capId, this._onOutletToggle.bind(this, i));

        // Set outlet title from stored type name
        const outlet = outlets.find((o) => o.number === i);
        if (outlet) {
          this.setCapabilityOptions(capId, {
            title: { en: outlet.typeName },
          }).catch(this.error);
        }
      }
    }

    // Device trigger card: water temperature changed
    this._tempTrigger = this.homey.flow.getDeviceTriggerCard('valve-temperature-changed');
  }

  async _onValveOnOff(value) {
    const valveNum = this.getStoreValue('valveNumber') || 1;
    if (value) {
      // Open only the outlets that are toggled on
      const outletStr = this._getEnabledOutletString();
      const temp = this._getValveTargetTempForApi();
      await this._sendValveShowerCommand(valveNum, outletStr, temp);
    } else {
      const otherValve = valveNum === 1 ? 2 : 1;
      if (this._isOtherValveRunning(otherValve)) {
        await this._sendValveShowerCommand(valveNum, '0', 100);
      } else {
        await this.api.stopShower();
      }
    }
    this.homey.app.requestPoll(this._address);
  }

  /** Called when an individual outlet toggle changes while the shower may be running */
  async _onOutletToggle(outletNumber, value) {
    // If the valve isn't on, just store the toggle state (no command needed)
    if (!this.getCapabilityValue('shower_toggle')) return;

    const valveNum = this.getStoreValue('valveNumber') || 1;
    const outletStr = this._getEnabledOutletString();

    // If all outlets just got turned off, stop this valve
    if (outletStr === '0') {
      const otherValve = valveNum === 1 ? 2 : 1;
      if (this._isOtherValveRunning(otherValve)) {
        await this._sendValveShowerCommand(valveNum, '0', 100);
      } else {
        await this.api.stopShower();
      }
      await this.setCapabilityValue('shower_toggle', false).catch(this.error);
    } else {
      const temp = this._getValveTargetTempForApi();
      await this._sendValveShowerCommand(valveNum, outletStr, temp);
    }
    this.homey.app.requestPoll(this._address);
  }

  /** Build outlet string from the outlet_N toggle states */
  _getEnabledOutletString() {
    const ports = this.getStoreValue('portsAvailable') || 6;
    let str = '';
    for (let i = 1; i <= ports; i++) {
      const capId = `outlet_${i}`;
      if (this.hasCapability(capId) && this.getCapabilityValue(capId)) {
        str += String(i);
      }
    }
    return str || '0';
  }

  async _onValveTargetTemp(value) {
    if (!this.getCapabilityValue('shower_toggle')) return;
    const valveNum = this.getStoreValue('valveNumber') || 1;
    const info = this._lastInfo || {};
    const apiTemp = KohlerApi.fromHomeyTemp(value, info);
    const outletStr = this._getEnabledOutletString();
    await this._sendValveShowerCommand(valveNum, outletStr, apiTemp);
    this.homey.app.requestPoll(this._address);
  }

  async _sendValveShowerCommand(valveNum, outletStr, temp) {
    const info = this._lastInfo || {};
    const otherValve = valveNum === 1 ? 2 : 1;
    const otherOutlets = this._getCurrentOutletString(otherValve);
    const otherTemp = parseFloat(info[`valve${otherValve}Setpoint`]) || 100;
    await this.api.startShower({
      valve1Outlet: valveNum === 1 ? outletStr : otherOutlets,
      valve1Temp:   valveNum === 1 ? temp : otherTemp,
      valve2Outlet: valveNum === 2 ? outletStr : otherOutlets,
      valve2Temp:   valveNum === 2 ? temp : otherTemp,
    });
  }

  _getCurrentOutletString(valve) {
    const info = this._lastInfo || {};
    // Only include outlets if the valve is actually running —
    // system_info always reports hardware assignments even when off
    if (info[`valve${valve}_Currentstatus`] !== 'On') return '0';
    let str = '';
    for (let i = 1; i <= 6; i++) {
      if (info[`valve${valve}outlet${i}`]) str += String(i);
    }
    return str || '0';
  }

  _isOtherValveRunning(otherValve) {
    const info = this._lastInfo || {};
    return info[`valve${otherValve}_Currentstatus`] === 'On';
  }

  _getValveTargetTempForApi() {
    const homeyTemp = this.getCapabilityValue('target_temperature') || 38;
    const info = this._lastInfo || {};
    return KohlerApi.fromHomeyTemp(homeyTemp, info);
  }

  async _onSystemInfoValve(info) {
    const v = this.getStoreValue('valveNumber') || 1;

    // Update current water temperature
    const rawTemp = KohlerApi.toHomeyTemp(info[`valve${v}Temp`], info);
    if (rawTemp !== null) {
      const prev = this.getCapabilityValue('measure_temperature');
      await this.setCapabilityValue('measure_temperature', rawTemp).catch(this.error);
      if (prev !== rawTemp && this._tempTrigger) {
        this._tempTrigger.trigger(this, { temperature: rawTemp }).catch(this.error);
      }
    }

    // Update target temperature setpoint
    const rawSetpoint = KohlerApi.toHomeyTemp(info[`valve${v}Setpoint`], info);
    if (rawSetpoint !== null) {
      await this.setCapabilityValue('target_temperature', rawSetpoint).catch(this.error);
    }

    // Update master on/off from valve status
    const isOn = info[`valve${v}_Currentstatus`] === 'On';
    await this.setCapabilityValue('shower_toggle', isOn).catch(this.error);

    // Update individual outlet toggle states from controller
    const ports = this.getStoreValue('portsAvailable') || 6;
    for (let i = 1; i <= ports; i++) {
      const capId = `outlet_${i}`;
      if (this.hasCapability(capId)) {
        const isOpen = !!info[`valve${v}outlet${i}`];
        await this.setCapabilityValue(capId, isOpen).catch(this.error);
      }
    }
  }

  async _onValuesValve(values) {
    const v = this.getStoreValue('valveNumber') || 1;
    // Error alarm from fatal or resettable errors
    if (this.hasCapability('alarm_generic')) {
      const hasError = (values[`valve${v}_ErrorFatal`] || 0) > 0
        || (values[`valve${v}_ErrorResettable`] || 0) > 0;
      await this.setCapabilityValue('alarm_generic', hasError).catch(this.error);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // AMPLIFIER
  // ══════════════════════════════════════════════════════════════════

  _initAmplifier() {
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
      if (!this.getCapabilityValue('onoff')) {
        await this.setCapabilityValue('onoff', true).catch(this.error);
      }
      this.homey.app.requestPoll(this._address);
    });
  }

  async _onSystemInfoAmplifier(info) {
    // Update on/off from music status
    const isOn = info.musicStatus === 'On';
    await this.setCapabilityValue('onoff', isOn).catch(this.error);

    // Update volume
    const volStr = info.volStatus;
    if (typeof volStr === 'string') {
      const pct = parseInt(volStr, 10);
      if (!isNaN(pct)) {
        await this.setCapabilityValue('volume_set', pct / 100).catch(this.error);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // STEAMER
  // ══════════════════════════════════════════════════════════════════

  _initSteamer() {
    // Set initial temperature from the controller's default
    const defaultSteamTemp = this.getStoreValue('defaultSteamTemp');
    if (defaultSteamTemp != null && this.getCapabilityValue('target_temperature') == null) {
      this.setCapabilityValue('target_temperature', defaultSteamTemp).catch(this.error);
    }

    this.registerCapabilityListener('onoff', async (value) => {
      if (value) {
        const temp = this._getSteamerTargetTempForApi();
        await this.api.steamOn(temp, 10);
      } else {
        await this.api.steamOff();
      }
      this.homey.app.requestPoll(this._address);
    });

    this.registerCapabilityListener('target_temperature', async (value) => {
      if (this.getCapabilityValue('onoff')) {
        const info = this._lastInfo || {};
        const apiTemp = KohlerApi.fromHomeyTemp(value, info);
        await this.api.steamOn(apiTemp, 10);
        this.homey.app.requestPoll(this._address);
      }
    });
  }

  _getSteamerTargetTempForApi() {
    const homeyTemp = this.getCapabilityValue('target_temperature') || 43;
    const info = this._lastInfo || {};
    return KohlerApi.fromHomeyTemp(homeyTemp, info);
  }

  async _onSystemInfoSteamer(info) {
    // Update on/off from steam status (more real-time than values.cgi)
    const isOn = info.steamStatus === 'On';
    await this.setCapabilityValue('onoff', isOn).catch(this.error);

    // Update current steam temperature
    const steamTemp = parseFloat(info.steamTempStatus);
    if (!isNaN(steamTemp) && this.hasCapability('measure_temperature')) {
      await this.setCapabilityValue('measure_temperature', steamTemp).catch(this.error);
    }

    // Update steam time remaining
    if (this.hasCapability('steam_time')) {
      const timeStr = isOn ? `${info.steamTimeStatus || '—'} min` : '—';
      await this.setCapabilityValue('steam_time', timeStr).catch(this.error);
    }
  }

  async _onValuesSteamer(values) {
    const steamOn = values.steam_running === true
      || values.steam_running === 'true'
      || values.steam_running === 1
      || values.steam_running === '1';
    await this.setCapabilityValue('onoff', steamOn).catch(this.error);
  }

  // ══════════════════════════════════════════════════════════════════
  // LIGHT ZONES
  // ══════════════════════════════════════════════════════════════════

  _initLight() {
    this.registerCapabilityListener('onoff', async (value) => {
      const zone = this.getStoreValue('lightZone') || 1;
      if (value) {
        const level = Math.round((this.getCapabilityValue('dim') || 1) * 100);
        await this.api.lightOn(zone, level);
      } else {
        await this.api.lightOff(zone);
      }
      this.homey.app.requestPoll(this._address);
    });

    this.registerCapabilityListener('dim', async (value) => {
      const zone = this.getStoreValue('lightZone') || 1;
      const level = Math.round(value * 100);
      await this.api.lightOn(zone, level);
      if (!this.getCapabilityValue('onoff')) {
        await this.setCapabilityValue('onoff', true).catch(this.error);
      }
      this.homey.app.requestPoll(this._address);
    });
  }

  async _onSystemInfoLight(info) {
    const zone = this.getStoreValue('lightZone') || 1;
    const isOn = info[`LZ${zone}Status`] === 'On';
    await this.setCapabilityValue('onoff', isOn).catch(this.error);
  }

  // ══════════════════════════════════════════════════════════════════
  // POLLING CALLBACKS (called by app.js)
  // ══════════════════════════════════════════════════════════════════

  async onSystemInfo(info) {
    this._lastInfo = info;
    switch (this._deviceType) {
      case 'valve':      return this._onSystemInfoValve(info);
      case 'amplifier':  return this._onSystemInfoAmplifier(info);
      case 'steamer':    return this._onSystemInfoSteamer(info);
      case 'light':      return this._onSystemInfoLight(info);
    }
  }

  async onValues(values) {
    switch (this._deviceType) {
      case 'steamer': return this._onValuesSteamer(values);
      case 'valve':   return this._onValuesValve(values);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('address')) {
      this.homey.app.unregisterDevice(this._address, this);
      this._address = newSettings.address;
      this.api = this.homey.app.getApi(this._address);
      this.homey.app.registerDevice(this._address, this);
      this.log('Device address updated to', this._address);
    }
  }

  onDeleted() {
    this.homey.app.unregisterDevice(this._address, this);
  }

};
