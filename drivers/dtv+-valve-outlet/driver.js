'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

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
          devices.push({
            name: `Shower Zone 1 — Outlet ${i}`,
            data: { id: `${id}-valve1-outlet${i}` },
            store: { valveNumber: 1, outletNumber: i },
            settings: { address },
          });
        }
      }

      // Valve 2 outlets
      if (values.valve2_installed) {
        const ports = parseInt(values.valve2PortsAvailable) || 0;
        for (let i = 1; i <= ports; i++) {
          devices.push({
            name: `Shower Zone 2 — Outlet ${i}`,
            data: { id: `${id}-valve2-outlet${i}` },
            store: { valveNumber: 2, outletNumber: i },
            settings: { address },
          });
        }
      }

      return devices;
    });
  }

};
