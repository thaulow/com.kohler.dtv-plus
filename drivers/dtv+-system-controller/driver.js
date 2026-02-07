'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class DtvSystemControllerDriver extends Homey.Driver {

  async onInit() {
    this.log('DTV+ System Controller driver initialized');
  }

  async onPair(session) {
    let address = '';

    session.setHandler('address', async (ip) => {
      const api = new KohlerApi({ address: ip });
      await api.getValues(); // throws on failure -> shown as error in pair UI
      address = ip;
    });

    session.setHandler('list_devices', async () => {
      const api = new KohlerApi({ address });
      const values = await api.getValues();
      const id = values.MAC || address;

      return [{
        name: 'DTV+ System Controller',
        data: { id },
        settings: { address },
      }];
    });
  }

};
