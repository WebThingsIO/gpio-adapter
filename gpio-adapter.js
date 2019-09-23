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
const manifest = require('./manifest.json');

// The following show up in package.json in the 'direction' field.
const DIRECTION_INPUT = 'in'; // used with .startsWith
const DIRECTION_INPUT_BINARY_SENSOR = 'in - BinarySensor';
const DIRECTION_INPUT_PUSH_BUTTON = 'in - PushButton';
const DIRECTION_OUTPUT = 'out';

class GpioProperty extends Property {
  constructor(device, name, propertyDescr) {
    super(device, name, propertyDescr);
    this.debouncing = false;
    this.update();

    const pinConfig = this.device.pinConfig;
    if (pinConfig.direction.startsWith(DIRECTION_INPUT)) {
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
      pinConfig.direction = DIRECTION_INPUT_BINARY_SENSOR;
    }
    if (pinConfig.direction === DIRECTION_INPUT) {
      pinConfig.direction = DIRECTION_INPUT_BINARY_SENSOR;
    }
    if (pinConfig.hasOwnProperty('activeLow')) {
      options.activeLow = pinConfig.activeLow;
    }
    if (!pinConfig.hasOwnProperty('name')) {
      pinConfig.name = id;
    }
    if (pinConfig.direction.startsWith(DIRECTION_INPUT)) {
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

      case DIRECTION_INPUT_BINARY_SENSOR:
        this.initBinarySensor();
        this.adapter.handleDeviceAdded(this);
        break;

      case DIRECTION_INPUT_PUSH_BUTTON:
        this.initPushButton();
        this.adapter.handleDeviceAdded(this);
        break;

      case DIRECTION_OUTPUT:
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
    this['@type'] = ['BinarySensor'];
    this.properties.set(
      'on',
      new GpioProperty(
        this,
        'on',
        {
          '@type': 'BooleanProperty',
          type: 'boolean',
          readOnly: true,
        }
      )
    );
  }

  initPushButton() {
    this['@type'] = ['PushButton'];
    this.properties.set(
      'pushed',
      new GpioProperty(
        this,
        'pushed',
        {
          '@type': 'PushedProperty',
          type: 'boolean',
          readOnly: true,
        }
      )
    );
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
        }
      )
    );
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
  constructor(addonManager) {
    super(addonManager, manifest.id, manifest.id);
    addonManager.addAdapter(this);

    const db = new Database(manifest.id);
    db.open().then(() => {
      return db.loadConfig();
    }).then((config) => {
      for (const pinConfig of config.gpios) {
        new GpioDevice(this, pinConfig.pin, pinConfig);
      }
    }).catch(console.error);
  }
}

module.exports = GpioAdapter;
