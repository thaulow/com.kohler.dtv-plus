'use strict';

const Homey = require('homey');
const KohlerApi = require('../../lib/KohlerApi');

module.exports = class InvigorationSteamerDriver extends Homey.Driver {

  async onInit() {
    this.log('Invigoration Steamer driver initialized');
  }

  async onPair(session) {
    let address = '';

    session.setHandler('address', async (ip) => {
      const api = new KohlerApi({ address: ip });
      const values = await api.getValues();
      if (!values.steam_installed) {
        throw new Error('No steam generator detected on this controller');
      }
      address = ip;
    });

    session.setHandler('list_devices', async () => {
      const api = new KohlerApi({ address });
      const values = await api.getValues();
      const id = values.MAC || address;

      return [{
        name: 'Invigoration Steamer',
        data: { id: `${id}-steamer` },
        settings: { address, steamDuration: 10 },
      }];
    });
  }

};
