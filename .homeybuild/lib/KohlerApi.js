'use strict';

const net = require('net');

const TIMEOUT_INFO = 5000;
const TIMEOUT_COMMAND = 10000;

class KohlerApi {

  constructor({ address }) {
    this.address = address;
  }

  /**
   * Raw TCP GET request. The DTV+ controller sends HTTP responses so
   * malformed that Node's http parser rejects them even with
   * insecureHTTPParser. We use a raw TCP socket and extract the body
   * ourselves.
   */
  _request(path, params = {}, timeout = TIMEOUT_INFO) {
    return new Promise((resolve, reject) => {
      const url = new URL(`http://${this.address}/${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }

      const host = url.hostname;
      const port = parseInt(url.port, 10) || 80;
      const reqPath = url.pathname + url.search;

      const socket = net.createConnection({ host, port }, () => {
        socket.write(`GET ${reqPath} HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });

      let data = '';
      socket.setEncoding('utf8');
      socket.setTimeout(timeout);

      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => {
        // Strip HTTP headers if present, otherwise treat entire response as body
        const headerEnd = data.indexOf('\r\n\r\n');
        const body = headerEnd !== -1 ? data.substring(headerEnd + 4) : data;
        resolve(body.trim());
      });
      socket.on('error', (err) => reject(err));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Request to ${path} timed out`));
      });
    });
  }

  /**
   * Request that returns parsed JSON. Handles responses where the JSON
   * may be preceded by garbage or malformed HTTP framing.
   */
  async _requestJson(path, params = {}, timeout = TIMEOUT_INFO) {
    const text = await this._request(path, params, timeout);
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error(`Invalid JSON from ${path}: ${text.substring(0, 100)}`);
    }
  }

  // ── Query endpoints ────────────────────────────────────────────────

  /** Full device configuration (installed hardware, port assignments, etc.) */
  async getValues() {
    return this._requestJson('values.cgi');
  }

  /** Real-time operational status (temps, valve states, volume, etc.) */
  async getSystemInfo() {
    return this._requestJson('system_info.cgi');
  }

  // ── Shower control ─────────────────────────────────────────────────

  /**
   * Start the shower.
   * @param {object} opts
   * @param {string} opts.valve1Outlet - Concatenated outlet numbers, e.g. "135"
   * @param {number} opts.valve1Temp   - Temperature for valve 1
   * @param {string} opts.valve2Outlet - Concatenated outlet numbers for valve 2
   * @param {number} opts.valve2Temp   - Temperature for valve 2
   */
  async startShower({
    valve1Outlet = '0',
    valve1Temp = 100,
    valve2Outlet = '0',
    valve2Temp = 100,
  } = {}) {
    return this._request('quick_shower.cgi', {
      valve_num: 1,
      valve1_outlet: valve1Outlet,
      valve1_massage: 0,
      valve1_temp: Math.round(valve1Temp),
      valve2_outlet: valve2Outlet,
      valve2_massage: 0,
      valve2_temp: Math.round(valve2Temp),
    }, TIMEOUT_COMMAND);
  }

  async stopShower() {
    return this._request('stop_shower.cgi', {}, TIMEOUT_COMMAND);
  }

  async startPreset(user = 1) {
    return this._request('start_user.cgi', { user }, TIMEOUT_COMMAND);
  }

  // ── Steam control ──────────────────────────────────────────────────

  async steamOn(temp = 110, time = 10) {
    return this._request('steam_on.cgi', {
      temp: Math.round(temp),
      time: Math.round(time),
    }, TIMEOUT_COMMAND);
  }

  async steamOff() {
    return this._request('steam_off.cgi', {}, TIMEOUT_COMMAND);
  }

  // ── Music / audio control ──────────────────────────────────────────

  async musicOn(volume = 50) {
    return this._request('music_on.cgi', { volume: Math.round(volume) });
  }

  async musicOff() {
    return this._request('music_off.cgi', {});
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Build an outlet string like "123" for a given port count. */
  static buildOutletString(portCount) {
    let s = '';
    for (let i = 1; i <= portCount; i++) {
      s += String(i);
    }
    return s;
  }

  // Outlet icon/type names indexed 0–23 matching the controller's icon grid
  static OUTLET_NAMES = [
    'Outlet',            // 0  – blank / unassigned
    'Shower Head',       // 1
    'Shower Head',       // 2
    'Shower Head',       // 3
    'Shower Head',       // 4
    'Shower Head',       // 5
    'Shower Head',       // 6
    'Hand Shower',       // 7
    'Hand Shower',       // 8
    'Tub Spout',         // 9
    'Tub Filler',        // 10
    'Rain Head',         // 11
    'Body Spray',        // 12
    'Body Spray',        // 13
    'Body Spray',        // 14
    'Body Spray',        // 15
    'Body Spray Panel',  // 16
    'Body Spray Panel',  // 17
    'Multi Spray',       // 18
    'Rain Panel',        // 19
    'Spray Panel',       // 20
    'Spray Panel',       // 21
    'WaterTile',         // 22
    'Real Rain',         // 23
  ];

  /** Map an outlet type string like "outlet_23" to a human-readable name. */
  static outletTypeName(typeString) {
    const num = parseInt((typeString || '').replace('outlet_', ''), 10);
    if (isNaN(num) || num < 0 || num >= KohlerApi.OUTLET_NAMES.length) {
      return 'Outlet';
    }
    return KohlerApi.OUTLET_NAMES[num];
  }

  /** Extract the outlet type number from a type string like "outlet_23". */
  static outletTypeNumber(typeString) {
    const num = parseInt((typeString || '').replace('outlet_', ''), 10);
    return isNaN(num) ? 0 : num;
  }

  /** True when the controller reports Fahrenheit. */
  static isFahrenheit(info) {
    return info.degree_symbol && info.degree_symbol.includes('F');
  }

  static fahrenheitToCelsius(f) {
    return Math.round(((f - 32) * 5) / 9 * 10) / 10;
  }

  static celsiusToFahrenheit(c) {
    return Math.round(c * 9 / 5 + 32);
  }

  /** Convert a temperature from the controller's unit to Celsius. */
  static toHomeyTemp(temp, info) {
    const val = parseFloat(temp);
    if (isNaN(val)) return null;
    return KohlerApi.isFahrenheit(info) ? KohlerApi.fahrenheitToCelsius(val) : val;
  }

  /** Convert a Homey temperature (Celsius) to the controller's unit. */
  static fromHomeyTemp(temp, info) {
    return KohlerApi.isFahrenheit(info) ? KohlerApi.celsiusToFahrenheit(temp) : temp;
  }

}

module.exports = KohlerApi;
