import noble from '@abandonware/noble';

import type { BleDevice, BooleanResult, BluetoothLePlugin, RequestBleDeviceOptions } from '../../src/definitions';

export class BluetoothLe implements BluetoothLePlugin {
  private deviceMap = new Map<string, noble.Peripheral>();
  private requestBleDeviceOptions: RequestBleDeviceOptions | undefined;

  async initialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      noble.once('stateChange', (state) => {
        if (state === 'poweredOn') {
          resolve();
        } else {
          reject('No Bluetooth radio available.');
        }
      });
    });
  }

  async isEnabled(): Promise<BooleanResult> {
    return { value: true };
  }

  async enable(): Promise<void> {
    throw Error('enable is not available on web.');
  }

  async disable(): Promise<void> {
    throw Error('disable is not available on electron.');
  }

  async requestDevice(options?: RequestBleDeviceOptions): Promise<BleDevice> {}

  async requestLEScan(options?: RequestBleDeviceOptions): Promise<void> {
    this.requestBleDeviceOptions = options;
    const { allowDuplicates, services } = this.getFilters(options);
    await this.stopLEScan();
    this.deviceMap = new Map<string, noble.Peripheral>();
    noble.removeAllListeners('discover');
    noble.on('discover', peripheral => this.onAdvertisementReceived(peripheral));
    noble.startScanning(services, allowDuplicates);
  }

  async stopLEScan(): Promise<void> {
    return new Promise<void>((resolve) => {
      noble.stopScanning(() => resolve());
    });
  }

  private getFilters(options: RequestBleDeviceOptions): { services: string[]; allowDuplicates: boolean } {
    const { services, allowDuplicates } = options;
    return { allowDuplicates: allowDuplicates || false, services: services || [] };
  }

  private onAdvertisementReceived(peripheral: noble.Peripheral): void {
    if (this.requestBleDeviceOptions.name != null || this.requestBleDeviceOptions.namePrefix) {
      if (peripheral.services.find(s => s.name))
    }
    this.deviceMap.set(peripheral.id, peripheral);
  }
}
