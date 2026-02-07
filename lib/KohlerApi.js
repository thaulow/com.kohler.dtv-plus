'use strict';

const http = require('http');

const TIMEOUT_INFO = 5000;
const TIMEOUT_COMMAND = 10000;

class KohlerApi {

  constructor({ address }) {
    this.address = address;
  }

  /**
   * Raw HTTP GET request. Uses insecureHTTPParser to handle the DTV+
   * controller's occasionally malformed HTTP responses.
   */
  _request(path, params = {}, timeout = TIMEOUT_INFO) {
    return new Promise((resolve, reject) => {
      const url = new URL(`http://${this.address}/${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }

      const req = http.get(url, {
        insecureHTTPParser: true,
        timeout,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body.trim()));
        res.on('error', (err) => reject(err));
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
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
