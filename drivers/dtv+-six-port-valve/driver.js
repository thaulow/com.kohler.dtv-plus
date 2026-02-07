'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class DtvValveDriver extends Homey.Driver {

  async onInit() {
    this.log('DTV+ Valve driver initialized');
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

      if (values.valve1_installed) {
        const ports = parseInt(values.valve1PortsAvailable) || 6;
        devices.push({
          name: values.valve1_name || 'DTV+ Valve 1',
          data: { id: `${id}-valve1` },
          store: { valveNumber: 1, portsAvailable: ports },
          settings: { address },
        });
      }

      if (values.valve2_installed) {
        const ports = parseInt(values.valve2PortsAvailable) || 6;
        devices.push({
          name: values.valve2_name || 'DTV+ Valve 2',
          data: { id: `${id}-valve2` },
          store: { valveNumber: 2, portsAvailable: ports },
          settings: { address },
        });
      }

      // If nothing detected, offer valve 1 as default
      if (devices.length === 0) {
        devices.push({
          name: 'DTV+ Valve 1',
          data: { id: `${id}-valve1` },
          store: { valveNumber: 1, portsAvailable: 6 },
          settings: { address },
        });
      }

      return devices;
    });
  }

};
