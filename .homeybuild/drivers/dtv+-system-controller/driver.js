'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

const ORDINALS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

module.exports = class KohlerDtvDriver extends Homey.Driver {

  async onInit() {
    this.log('Kohler DTV+ driver initialized');

    // ── Global flow cards (registered once in the driver) ──────────

    this.homey.flow.getActionCard('start-preset')
      .registerRunListener(async (args) => {
        await args.device.api.startPreset(args.preset);
        args.device.homey.app.requestPoll(args.device._address);
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
      const id = values.MAC || address;
      const devices = [];

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
        const caps = ['onoff', 'target_temperature', 'measure_temperature'];
        const capOpts = {
          onoff: { uiQuickAction: true },
          target_temperature: { min: 30, max: 45, step: 0.5 },
        };

        for (let i = 1; i <= vc.ports; i++) {
          const typeKey = `${vc.prefix}${ORDINALS[i]}_type`;
          const typeName = KohlerApi.outletTypeName(values[typeKey]);
          const capId = `outlet_toggle.${i}`;
          caps.push(capId);
          capOpts[capId] = { title: { en: typeName } };
          outlets.push({ number: i, typeName });
        }

        devices.push({
          name: vc.name,
          data: { id: `${id}-valve${vc.num}` },
          store: {
            deviceType: 'valve',
            valveNumber: vc.num,
            portsAvailable: vc.ports,
            outlets,
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
        store: { deviceType: 'amplifier' },
        settings: { address },
        capabilities: ['onoff', 'volume_set'],
        class: 'speaker',
      });

      // ── 3. Steamer (only if installed) ────────────────────────
      if (values.steam_installed) {
        devices.push({
          name: 'Invigoration Steamer',
          data: { id: `${id}-steamer` },
          store: { deviceType: 'steamer' },
          settings: { address },
          capabilities: ['onoff', 'target_temperature'],
          capabilitiesOptions: {
            target_temperature: { min: 35, max: 48, step: 1 },
          },
          class: 'heater',
        });
      }

      return devices;
    });
  }

};
