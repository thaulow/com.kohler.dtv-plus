'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class DtvValveDriver extends Homey.Driver {

  async onInit() {
    this.log('DTV+ Valve driver initialized');
  }

  async onPairListDevices() {
    const controllers = this.homey.app.getControllerAddresses();
    if (controllers.length === 0) {
      throw new Error('No DTV+ System Controller paired yet. Please add a System Controller first.');
    }

    const devices = [];
    for (const ctrl of controllers) {
      const api = new KohlerApi({ address: ctrl.address });
      const values = await api.getValues();
      const id = values.MAC || ctrl.address;
      const suffix = controllers.length > 1 ? ` (${ctrl.name})` : '';

      if (values.valve1_installed) {
        const ports = parseInt(values.valve1PortsAvailable) || 6;
        devices.push({
          name: (values.valve1_name || 'DTV+ Valve 1') + suffix,
          data: { id: `${id}-valve1` },
          store: { valveNumber: 1, portsAvailable: ports },
          settings: { address: ctrl.address },
        });
      }

      if (values.valve2_installed) {
        const ports = parseInt(values.valve2PortsAvailable) || 6;
        devices.push({
          name: (values.valve2_name || 'DTV+ Valve 2') + suffix,
          data: { id: `${id}-valve2` },
          store: { valveNumber: 2, portsAvailable: ports },
          settings: { address: ctrl.address },
        });
      }

      // If nothing detected on this controller, offer valve 1 as default
      if (!values.valve1_installed && !values.valve2_installed) {
        devices.push({
          name: 'DTV+ Valve 1' + suffix,
          data: { id: `${id}-valve1` },
          store: { valveNumber: 1, portsAvailable: 6 },
          settings: { address: ctrl.address },
        });
      }
    }

    return devices;
  }

};
