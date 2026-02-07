'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class DtvAmplifierDriver extends Homey.Driver {

  async onInit() {
    this.log('DTV+ Amplifier driver initialized');
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

      return [{
        name: 'DTV+ Amplifier',
        data: { id: `${id}-amplifier` },
        settings: { address },
      }];
    });
  }

};
