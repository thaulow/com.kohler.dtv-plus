'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class DtvAmplifierDriver extends Homey.Driver {

  async onInit() {
    this.log('DTV+ Amplifier driver initialized');
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

      devices.push({
        name: controllers.length > 1
          ? `DTV+ Amplifier (${ctrl.name})`
          : 'DTV+ Amplifier',
        data: { id: `${id}-amplifier` },
        settings: { address: ctrl.address },
      });
    }

    return devices;
  }

};
