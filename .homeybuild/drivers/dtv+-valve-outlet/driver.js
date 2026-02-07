'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

const ORDINALS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

module.exports = class DtvValveOutletDriver extends Homey.Driver {

  async onInit() {
    this.log('DTV+ Valve Outlet driver initialized');
  }

  async onPair(session) {
    let address = '';

    session.setHandler('address', async (ip) => {
      const api = new KohlerApi({ address: ip });
      await api.getValues();
      address = ip;
    });

    session.setHandler('list_devices', async () => {
      const api = new KohlerApi({ address });
      const values = await api.getValues();
      const id = values.MAC || address;
      const devices = [];

      // Valve 1 outlets
      if (values.valve1_installed) {
        const ports = parseInt(values.valve1PortsAvailable) || 0;
        for (let i = 1; i <= ports; i++) {
          const typeKey = `${ORDINALS[i]}_type`;
          const massageKey = `${ORDINALS[i]}_massage`;
          const typeName = KohlerApi.outletTypeName(values[typeKey]);
          const typeNum = KohlerApi.outletTypeNumber(values[typeKey]);
          const hasMassage = !!values[massageKey];
          devices.push({
            name: `Zone 1 — ${typeName}`,
            data: { id: `${id}-valve1-outlet${i}` },
            store: {
              valveNumber: 1,
              outletNumber: i,
              outletType: typeNum,
              hasMassage,
            },
            settings: { address },
          });
        }
      }

      // Valve 2 outlets
      if (values.valve2_installed) {
        const ports = parseInt(values.valve2PortsAvailable) || 0;
        for (let i = 1; i <= ports; i++) {
          const typeKey = `v2_${ORDINALS[i]}_type`;
          const massageKey = `v2_${ORDINALS[i]}_massage`;
          const typeName = KohlerApi.outletTypeName(values[typeKey]);
          const typeNum = KohlerApi.outletTypeNumber(values[typeKey]);
          const hasMassage = !!values[massageKey];
          devices.push({
            name: `Zone 2 — ${typeName}`,
            data: { id: `${id}-valve2-outlet${i}` },
            store: {
              valveNumber: 2,
              outletNumber: i,
              outletType: typeNum,
              hasMassage,
            },
            settings: { address },
          });
        }
      }

      // Deduplicate names: if two outlets share a name, append " 1", " 2"
      const nameCount = {};
      for (const d of devices) {
        nameCount[d.name] = (nameCount[d.name] || 0) + 1;
      }
      const nameIndex = {};
      for (const d of devices) {
        if (nameCount[d.name] > 1) {
          nameIndex[d.name] = (nameIndex[d.name] || 0) + 1;
          d.name = `${d.name} ${nameIndex[d.name]}`;
        }
      }

      return devices;
    });
  }

};
