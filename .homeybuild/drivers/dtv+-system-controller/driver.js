'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

const ORDINALS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

module.exports = class KohlerDtvDriver extends Homey.Driver {

  async onInit() {
    this.log('Kohler DTV+ driver initialized');

    // ── Global flow cards (registered once in the driver) ──────────

    const presetCard = this.homey.flow.getActionCard('start-preset');
    presetCard.registerRunListener(async (args) => {
      await args.device.api.startPreset(args.preset.id);
      args.device.homey.app.requestPoll(args.device._address);
    });
    presetCard.registerArgumentAutocompleteListener('preset', async (query, args) => {
      const presets = args.device.getStoreValue('userPresets') || [];
      return presets.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    });

    this.homey.flow.getActionCard('stop-shower')
      .registerRunListener(async (args) => {
        await args.device.api.stopShower();
        await args.device.api.steamOff();
        args.device.homey.app.requestPoll(args.device._address);
      });

    this.homey.flow.getConditionCard('shower-is-running')
      .registerRunListener(async (args) => {
        const info = args.device._lastInfo || {};
        return info.valve1_Currentstatus === 'On'
          || info.valve2_Currentstatus === 'On';
      });

    this.homey.flow.getActionCard('start-steam-duration')
      .registerRunListener(async (args) => {
        const info = args.device._lastInfo || {};
        const apiTemp = KohlerApi.fromHomeyTemp(args.temperature, info);
        await args.device.api.steamOn(apiTemp, args.duration);
        args.device.homey.app.requestPoll(args.device._address);
      });
  }

  async onPair(session) {
    let address = '';

    session.setHandler('address', async (ip) => {
      const api = new KohlerApi({ address: ip });
      await api.getValues(); // throws on failure
      address = ip;
    });

    session.setHandler('list_devices', async () => {
      const api = new KohlerApi({ address });
      const values = await api.getValues();
      const info = await api.getSystemInfo();
      const id = values.MAC || address;
      const devices = [];

      // Build user presets list from values.cgi
      const userPresets = [];
      for (let i = 1; i <= 6; i++) {
        const name = values[`user_${i}`] || values[`user${i}_string`];
        if (name) {
          userPresets.push({ id: i, name });
        }
      }

      // ── 1. Valves (shower zones) ────────────────────────────────
      const valveConfigs = [];
      if (values.valve1_installed) {
        valveConfigs.push({
          num: 1,
          name: values.valve1_name || 'DTV+ Shower Zone 1',
          ports: parseInt(values.valve1PortsAvailable) || 6,
          prefix: '',  // valve 1 keys: one_type, two_type, etc.
        });
      }
      if (values.valve2_installed) {
        valveConfigs.push({
          num: 2,
          name: values.valve2_name || 'DTV+ Shower Zone 2',
          ports: parseInt(values.valve2PortsAvailable) || 6,
          prefix: 'v2_',  // valve 2 keys: v2_one_type, v2_two_type, etc.
        });
      }
      if (valveConfigs.length === 0) {
        valveConfigs.push({ num: 1, name: 'DTV+ Shower', ports: 6, prefix: '' });
      }

      for (const vc of valveConfigs) {
        // Build outlet info and sub-capabilities
        const outlets = [];
        const caps = [];
        const capOpts = {
          target_temperature: { min: 30, max: 45, step: 0.5, uiComponent: 'slider' },
        };

        // Outlet buttons first so the button grid is the default page
        for (let i = 1; i <= vc.ports; i++) {
          const typeKey = `${vc.prefix}${ORDINALS[i]}_type`;
          const typeName = KohlerApi.outletTypeName(values[typeKey]);
          const typeNum = KohlerApi.outletTypeNumber(values[typeKey]);
          const capId = `outlet_toggle.${i}`;
          caps.push(capId);
          capOpts[capId] = {
            title: { en: typeName },
            icon: `/assets/outlets/${typeNum}.svg`,
          };
          outlets.push({ number: i, typeName });
        }

        // Start/Stop button at the bottom of the grid (alone on last row)
        caps.push('shower_toggle');

        // Temperature after buttons
        caps.push('target_temperature', 'measure_temperature');

        // Error alarm
        caps.push('alarm_generic');

        devices.push({
          name: vc.name,
          data: { id: `${id}-valve${vc.num}` },
          store: {
            deviceType: 'valve',
            valveNumber: vc.num,
            portsAvailable: vc.ports,
            outlets,
            defaultSetpoint: KohlerApi.toHomeyTemp(info[`valve${vc.num}Setpoint`], info),
            userPresets,
          },
          settings: { address },
          capabilities: caps,
          capabilitiesOptions: capOpts,
          class: 'other',
        });
      }

      // ── 2. Amplifier ──────────────────────────────────────────
      devices.push({
        name: 'DTV+ Amplifier',
        data: { id: `${id}-amplifier` },
        store: { deviceType: 'amplifier', userPresets },
        settings: { address },
        capabilities: ['onoff', 'volume_set'],
        class: 'speaker',
      });

      // ── 3. Steamer (only if installed) ────────────────────────
      if (values.steam_installed) {
        const defaultSteamTemp = parseFloat(values.steam_default_string_temp);
        devices.push({
          name: 'Invigoration Steamer',
          data: { id: `${id}-steamer` },
          store: {
            deviceType: 'steamer',
            defaultSteamTemp: isNaN(defaultSteamTemp) ? 43 : defaultSteamTemp,
            userPresets,
          },
          settings: { address },
          capabilities: ['onoff', 'target_temperature', 'measure_temperature', 'steam_time'],
          capabilitiesOptions: {
            target_temperature: { min: 35, max: 48, step: 1 },
          },
          class: 'heater',
        });
      }

      // ── 4. Light zones (if lighting module connected) ────────
      if (values.lighting_con_string === 'conn') {
        for (let z = 1; z <= 3; z++) {
          const name = values[`light${z}_name`] || `Light Zone ${z}`;
          devices.push({
            name,
            data: { id: `${id}-light${z}` },
            store: { deviceType: 'light', lightZone: z },
            settings: { address },
            capabilities: ['onoff', 'dim'],
            class: 'light',
          });
        }
      }

      return devices;
    });
  }

};
