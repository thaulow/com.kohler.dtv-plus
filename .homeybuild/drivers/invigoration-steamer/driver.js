'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class InvigorationSteamerDriver extends Homey.Driver {

  async onInit() {
    this.log('Invigoration Steamer driver initialized');
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

      if (!values.steam_installed) continue;

      const id = values.MAC || ctrl.address;
      devices.push({
        name: controllers.length > 1
          ? `Invigoration Steamer (${ctrl.name})`
          : 'Invigoration Steamer',
        data: { id: `${id}-steamer` },
        settings: { address: ctrl.address, steamDuration: 10 },
      });
    }

    return devices;
  }

};
