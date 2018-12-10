/**
 *
 * GpioAdapter - an adapter for controlling GPIO pins.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const Gpio = require('onoff').Gpio;
const {Adapter, Database, Device, Event, Property} = require('gateway-addon');

const THING_TYPE_ON_OFF_SWITCH = 'onOffSwitch';
const THING_TYPE_BINARY_SENSOR = 'binarySensor';

class GpioProperty extends Property {
  constructor(device, name, propertyDescr) {
    super(device, name, propertyDescr);
    this.debouncing = false;
    this.update();

    const pinConfig = this.device.pinConfig;
    if (pinConfig.direction === 'in') {
      this.device.gpio.watch(() => {
        if (pinConfig.debounce === 0) {
          this.update();
          console.log('GPIO:', this.name, ' was changed to:', this.value);
        } else if (!this.debouncing) {
          // If we're debouncing - ignore any extra edges during the debounce
          // period
          this.debouncing = true;
          setTimeout(() => {
            this.debouncing = false;
            this.update();
            console.log('GPIO:', this.name, 'changed to:', this.value);
          }, pinConfig.debounce);
        }
      });
    }
  }

  /**
   * @method setValue
   * @returns a promise which resolves to the updated value.
   *
   * @note it is possible that the updated value doesn't match
   * the value passed in.
   */
  setValue(value) {
    return new Promise((resolve, reject) => {
      this.device.gpio.write(value ? 1 : 0, (err) => {
        if (err) {
          console.error('GPIO: write for pin:', this.device.name, 'failed');
          console.error(err);
          reject(err);
        } else {
          this.setCachedValue(value);
          console.log('GPIO:', this.device.name, 'set to:', this.value);
          resolve(this.value);
          this.device.notifyPropertyChanged(this);
        }
      });
    });
  }

  update() {
    this.setCachedValue(this.device.gpio.readSync());
    this.device.notifyPropertyChanged(this);
    if (this['@type'] == 'PushedProperty') {
      const evt = this.value ? 'pressed' : 'released';
      this.device.notifyEvent(evt);
    }
  }
}

class GpioDevice extends Device {
  constructor(adapter, pin, pinConfig) {
    const id = `gpio-${pin}`;
    super(adapter, id);

    const options = {};

    if (!pinConfig.hasOwnProperty('direction')) {
      pinConfig.direction = 'in';
    }
    if (pinConfig.hasOwnProperty('activeLow')) {
      options.activeLow = pinConfig.activeLow;
    }
    if (!pinConfig.hasOwnProperty('name')) {
      pinConfig.name = id;
    }
    if (pinConfig.direction == 'in') {
      if (!pinConfig.hasOwnProperty('edge')) {
        pinConfig.edge = 'both';
      }
      if (!pinConfig.hasOwnProperty('debounce')) {
        pinConfig.debounce = 10;  // msec
      }
      this.gpio = new Gpio(pin, 'in', pinConfig.edge, options);
    } else if (pinConfig.direction == 'out') {
      this.gpio = new Gpio(pin, 'out', options);

      // Unfortunately, the onoff library writes to the direction file
      // even if the direction is already set to out. This has a side
      // effect of setting the value to zero, so for the time being
      // we reflect that behaviour.
      if (!pinConfig.hasOwnProperty('value')) {
        pinConfig.value = 0;
      }
      this.gpio.writeSync(pinConfig.value);
    }
    pinConfig.pin = pin;
    this.pinConfig = pinConfig;
    this.name = pinConfig.name;

    console.log('GPIO:', this.pinConfig);
    switch (pinConfig.direction) {

      case 'in':
        this.initBinarySensor();
        this.adapter.handleDeviceAdded(this);
        break;

      case 'out':
        this.initOnOffSwitch();
        this.adapter.handleDeviceAdded(this);
        break;

      default:
        console.error('Unsupported direction:', pinConfig.direction);
        break;
    }
  }

  asDict() {
    const dict = super.asDict();
    dict.pinConfig = this.pinConfig;
    return dict;
  }

  initBinarySensor() {
    this.type = THING_TYPE_BINARY_SENSOR;
    this['@type'] = ['BinarySensor', 'PushButton'];
    this.properties.set(
      'on',
      new GpioProperty(
        this,
        'on',
        {
          '@type': 'BooleanProperty',
          type: 'boolean',
          readOnly: true,
        }));
    this.properties.set(
      'pushed',
      new GpioProperty(
        this,
        'pushed',
        {
          '@type': 'PushedProperty',
          type: 'boolean',
          readOnly: true,
        }));
    this.addEvent('pressed', {
      '@type': 'PressedEvent',
      description: 'Button pressed',
    });
    this.addEvent('released', {
      '@type': 'ReleasedEvent',
      description: 'Button released',
    });
  }

  initOnOffSwitch() {
    this.type = THING_TYPE_ON_OFF_SWITCH;
    this['@type'] = ['OnOffSwitch'];
    this.properties.set(
      'on',
      new GpioProperty(
        this,
        'on',
        {
          '@type': 'OnOffProperty',
          label: 'On/Off',
          type: 'boolean',
        }));
  }

  notifyEvent(eventName, eventData) {
    if (eventData) {
      console.log(this.name, 'event:', eventName, 'data:', eventData);
    } else {
      console.log(this.name, 'event:', eventName);
    }
    this.eventNotify(new Event(this, eventName, eventData));
  }
}

class GpioAdapter extends Adapter {
  constructor(addonManager, manifest) {
    super(addonManager, manifest.name, manifest.name);
    addonManager.addAdapter(this);

    let gpios = {};

    // The 'gpios' config item used to be 'pins'. Retain compatibility.
    if (manifest.moziot.config.hasOwnProperty('pins')) {
      gpios = Object.assign(gpios, manifest.moziot.config.pins);
    }

    if (manifest.moziot.config.hasOwnProperty('gpios')) {
      // gpios used to be an object, but to make schema validation work, it is
      // now an array.
      if (Array.isArray(manifest.moziot.config.gpios)) {
        for (const gpio of manifest.moziot.config.gpios) {
          gpios[gpio.pin.toFixed(0).toString()] = {
            name: gpio.name,
            direction: gpio.direction,
            value: gpio.value,
            activeLow: gpio.activeLow,
          };
        }
      } else {
        // this handles the old object-based config
        gpios = Object.assign(gpios, manifest.moziot.config.gpios);
      }
    }

    for (const pin in gpios) {
      new GpioDevice(this, pin, gpios[pin]);
    }
  }
}

function loadGpioAdapter(addonManager, manifest, _errorCallback) {
  let promise;

  // Attempt to move to new config format
  if (Database) {
    const db = new Database(manifest.name);
    promise = db.open().then(() => {
      return db.loadConfig();
    }).then((config) => {
      let oldGpios = {};

      // The 'gpios' config item used to be 'pins'. Retain compatibility.
      if (config.hasOwnProperty('pins')) {
        oldGpios = Object.assign(oldGpios, config.pins);
        delete config.pins;
      }

      if (config.hasOwnProperty('gpios') && !Array.isArray(config.gpios)) {
        // this handles the old object-based config
        oldGpios = Object.assign(oldGpios, config.gpios);
      }

      const gpios = [];

      for (const gpioPin in oldGpios) {
        const gpio = Object.assign({}, oldGpios[gpioPin]);
        gpio.pin = parseInt(gpioPin, 10);
        gpios.push(gpio);
      }
      if (gpios.length > 0) {
        manifest.moziot.config.gpios = gpios;
        return db.saveConfig({gpios});
      }
    });
  } else {
    promise = Promise.resolve();
  }

  promise.then(() => new GpioAdapter(addonManager, manifest));
}

module.exports = loadGpioAdapter;
