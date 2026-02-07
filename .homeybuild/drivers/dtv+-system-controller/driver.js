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

      // ── 1. Controller ─────────────────────────────────────────
      devices.push({
        name: 'DTV+ Controller',
        data: { id: `${id}-controller` },
        store: { deviceType: 'controller' },
        settings: { address },
        capabilities: ['onoff'],
        capabilitiesOptions: {
          onoff: { title: { en: 'Shower' } },
        },
        class: 'other',
      });

      // ── 2. Valves ─────────────────────────────────────────────
      const valves = [];
      if (values.valve1_installed) {
        valves.push({
          num: 1,
          name: values.valve1_name || 'DTV+ Valve 1',
          ports: parseInt(values.valve1PortsAvailable) || 6,
        });
      }
      if (values.valve2_installed) {
        valves.push({
          num: 2,
          name: values.valve2_name || 'DTV+ Valve 2',
          ports: parseInt(values.valve2PortsAvailable) || 6,
        });
      }
      if (!values.valve1_installed && !values.valve2_installed) {
        valves.push({ num: 1, name: 'DTV+ Valve 1', ports: 6 });
      }

      for (const v of valves) {
        devices.push({
          name: v.name,
          data: { id: `${id}-valve${v.num}` },
          store: {
            deviceType: 'valve',
            valveNumber: v.num,
            portsAvailable: v.ports,
          },
          settings: { address },
          capabilities: ['onoff', 'target_temperature', 'measure_temperature'],
          capabilitiesOptions: {
            onoff: { title: { en: 'Valve' } },
            target_temperature: { min: 30, max: 45, step: 0.5 },
          },
          class: 'thermostat',
        });
      }

      // ── 3. Outlets ────────────────────────────────────────────
      const outlets = [];
      if (values.valve1_installed) {
        const ports = parseInt(values.valve1PortsAvailable) || 0;
        for (let i = 1; i <= ports; i++) {
          const typeKey = `${ORDINALS[i]}_type`;
          const massageKey = `${ORDINALS[i]}_massage`;
          const typeName = KohlerApi.outletTypeName(values[typeKey]);
          const typeNum = KohlerApi.outletTypeNumber(values[typeKey]);
          const hasMassage = !!values[massageKey];
          outlets.push({
            name: `Zone 1 — ${typeName}`,
            data: { id: `${id}-valve1-outlet${i}` },
            store: {
              deviceType: 'outlet',
              valveNumber: 1,
              outletNumber: i,
              outletType: typeNum,
              hasMassage,
            },
            settings: { address },
            capabilities: ['onoff'],
            capabilitiesOptions: {
              onoff: { title: { en: 'Outlet' } },
            },
            class: 'other',
          });
        }
      }
      if (values.valve2_installed) {
        const ports = parseInt(values.valve2PortsAvailable) || 0;
        for (let i = 1; i <= ports; i++) {
          const typeKey = `v2_${ORDINALS[i]}_type`;
          const massageKey = `v2_${ORDINALS[i]}_massage`;
          const typeName = KohlerApi.outletTypeName(values[typeKey]);
          const typeNum = KohlerApi.outletTypeNumber(values[typeKey]);
          const hasMassage = !!values[massageKey];
          outlets.push({
            name: `Zone 2 — ${typeName}`,
            data: { id: `${id}-valve2-outlet${i}` },
            store: {
              deviceType: 'outlet',
              valveNumber: 2,
              outletNumber: i,
              outletType: typeNum,
              hasMassage,
            },
            settings: { address },
            capabilities: ['onoff'],
            capabilitiesOptions: {
              onoff: { title: { en: 'Outlet' } },
            },
            class: 'other',
          });
        }
      }

      // Deduplicate outlet names
      const nameCount = {};
      for (const d of outlets) nameCount[d.name] = (nameCount[d.name] || 0) + 1;
      const nameIndex = {};
      for (const d of outlets) {
        if (nameCount[d.name] > 1) {
          nameIndex[d.name] = (nameIndex[d.name] || 0) + 1;
          d.name = `${d.name} ${nameIndex[d.name]}`;
        }
      }
      devices.push(...outlets);

      // ── 4. Amplifier ──────────────────────────────────────────
      devices.push({
        name: 'DTV+ Amplifier',
        data: { id: `${id}-amplifier` },
        store: { deviceType: 'amplifier' },
        settings: { address },
        capabilities: ['onoff', 'volume_set'],
        class: 'speaker',
      });

      // ── 5. Steamer (only if installed) ────────────────────────
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
