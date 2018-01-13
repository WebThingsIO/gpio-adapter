/**
 *
 * GpioAdapter - an adapter for controlling GPIO pins.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

var Adapter = require('../adapter');
var Device = require('../device');
var Gpio = require('onoff').Gpio;
var Property = require('../property');

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
        } else {
          // If we're debouncing - ignore any extra edges during the debounce period
          if (!this.debouncing) {
            this.debouncing = true;
            setTimeout(() => {
              this.debouncing = false;
              this.update();
              console.log('GPIO:', this.device.name, 'changed to:', this.value);
            }, pinConfig.debounce);
          }
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
  }
}

class GpioDevice extends Device {
  constructor(adapter, pin, pinConfig) {
    var id = 'gpio-' + pin;
    super(adapter, id);

    if (!pinConfig.hasOwnProperty('direction')) {
      pinConfig.direction = 'in';
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
      this.gpio = new Gpio(pin, 'in', pinConfig.edge);
    } else if (pinConfig.direction == 'out') {
      this.gpio = new Gpio(pin, 'out');

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
    var dict = super.asDict();
    dict.pinConfig = this.pinConfig;
    return dict;
  }

  initBinarySensor() {
    this.type = THING_TYPE_BINARY_SENSOR;
    this.properties.set('on',
      new GpioProperty(this, 'on', {type: 'boolean'}));
  }

  initOnOffSwitch() {
    this.type = THING_TYPE_ON_OFF_SWITCH;
    this.properties.set('on',
      new GpioProperty(this, 'on', {type: 'boolean'}));
  }
}

class GpioAdapter extends Adapter {
  constructor(addonManager, manifest) {
    super(addonManager, manifest.name, manifest.name);
    addonManager.addAdapter(this);
    for (var pin in manifest.moziot.config.pins) {
      new GpioDevice(this, pin, manifest.moziot.config.pins[pin]);
    }
  }
}

function loadGpioAdapter(addonManager, manifest, _errorCallback) {
  new GpioAdapter(addonManager, manifest);
}

module.exports = loadGpioAdapter;
