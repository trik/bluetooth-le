import { CapacitorException } from '@capacitor/core';
import { EventEmitter } from 'events';

import type {
  BleDevice,
  BleServices,
  BluetoothLePlugin,
  BooleanResult,
  DeviceIdOptions,
  GetConnectedDevicesOptions,
  GetDevicesResult,
  ReadOptions,
  ReadResult,
  ReadRssiResult,
  RequestBleDeviceOptions,
  ScanResultInternal,
  WriteOptions,
} from '../../src/definitions';

import { DeviceManager } from './device-manager';
import type { PeripheralInternal as Peripheral } from './device-manager';

export type BluetoothLEStateReceiver = (enabled: boolean) => void;

export interface Device {
  bleDevice: BleDevice;
  peripheral: Peripheral;
}

const dataToString = (buffer: Buffer, start = 0): string => {
  let str = '';
  for (let i = start; i < buffer.length; i++) {
    str = `${str}${buffer[i].toString(16).padStart(2, '0')}`;
  }
  return str;
};

export class BluetoothLe extends EventEmitter implements Omit<BluetoothLePlugin, 'addListener'> {
  private deviceManager: DeviceManager | undefined;
  private deviceMap = new Map<string, Device>();

  constructor() {
    super();
    this.deviceManager = new DeviceManager();
  }

  async initialize(): Promise<void> {
    return this.deviceManager.init();
  }

  async isEnabled(): Promise<BooleanResult> {
    return { value: this.deviceManager.isEnabled() };
  }

  async enable(): Promise<void> {
    throw this.unavailable('enable is not available on electron.');
  }

  async disable(): Promise<void> {
    throw this.unavailable('disable is not available on electron.');
  }

  async startEnabledNotifications(): Promise<void> {
    this.deviceManager.registerStateReceiver((enabled) => {
      this.emit('onEnabledChanged', { value: enabled });
    });
  }

  async stopEnabledNotifications(): Promise<void> {
    this.deviceManager.unregisterStateReceiver();
  }

  async isLocationEnabled(): Promise<BooleanResult> {
    throw this.unavailable('isLocationEnabled is not available on electron.');
  }

  async openLocationSettings(): Promise<void> {
    throw this.unavailable('openLocationSettings is not available on electron.');
  }

  async openBluetoothSettings(): Promise<void> {
    throw this.unavailable('openBluetoothSettings is not available on electron.');
  }

  async openAppSettings(): Promise<void> {
    throw this.unavailable('openAppSettings is not available on electron.');
  }

  async setDisplayStrings(): Promise<void> {
    throw this.unavailable('setDisplayStrings is not available on electron.');
  }

  async requestDevice(options?: RequestBleDeviceOptions): Promise<BleDevice> {
    const { name, namePrefix } = this.getScanOptions(options);
    const serviceUUIDs = this.getServiceUUIDs(options);

    return new Promise<BleDevice>((resolve) => {
      this.deviceManager.removeAllListeners('scanResult');
      this.deviceManager.on('scanResult', (peripheral: Peripheral) => {
        const bleDevice = this.getBleDevice(peripheral);
        this.deviceMap.set(peripheral.id, { bleDevice, peripheral });
        resolve(bleDevice);
      });
      this.deviceManager.startScanning(serviceUUIDs, name, namePrefix, false, 30);
    });
  }

  async requestLEScan(options?: RequestBleDeviceOptions): Promise<void> {
    const { allowDuplicates, name, namePrefix } = this.getScanOptions(options);
    const serviceUUIDs = this.getServiceUUIDs(options);

    this.deviceManager.removeAllListeners('scanResult');
    this.deviceManager.on('scanResult', (peripheral: Peripheral) => {
      const data = this.getScanResult(peripheral);
      this.deviceMap.set(peripheral.id, { bleDevice: data.device, peripheral });
      this.emit('onScanResult', data);
    });
    return this.deviceManager.startScanning(serviceUUIDs, name, namePrefix, allowDuplicates);
  }

  async stopLEScan(): Promise<void> {
    this.deviceManager.stopScan();
  }

  async getDevices(): Promise<GetDevicesResult> {
    throw this.unavailable('getDevices is not available on electron.');
  }

  async getConnectedDevices(_options: GetConnectedDevicesOptions): Promise<GetDevicesResult> {
    throw this.unavailable('getDevices is not available on electron.');
  }

  async connect(options: DeviceIdOptions): Promise<void> {
    const { peripheral } = this.getDevice(options, false);
    const disconnectKey = `disconnected|${peripheral.id}`;
    this.deviceManager.removeAllListeners(disconnectKey);
    this.deviceManager.on(disconnectKey, () => this.emit(disconnectKey, {}));
    await this.deviceManager.connect(peripheral);
  }

  async createBond(_options: DeviceIdOptions): Promise<void> {
    throw this.unavailable('createBond is not available on electron.');
  }

  async isBonded(_options: DeviceIdOptions): Promise<BooleanResult> {
    throw this.unavailable('isBonded is not available on electron.');
  }

  async disconnect(options: DeviceIdOptions): Promise<void> {
    const { peripheral } = this.getDevice(options, false);
    await this.deviceManager.disconnect(peripheral);
  }

  async getServices(options: DeviceIdOptions): Promise<BleServices> {
    const { peripheral } = this.getDevice(options, false);
    return {
      services: peripheral.services.map((service) => {
        return {
          uuid: service.uuid,
          characteristics: service.characteristics.map((characteristic) => ({
            uuid: characteristic.uuid,
            properties: {
              broadcast: characteristic.properties.includes('broadcast'),
              read: characteristic.properties.includes('read'),
              writeWithoutResponse: characteristic.properties.includes('writeWithoutResponse'),
              write: characteristic.properties.includes('write'),
              notify: characteristic.properties.includes('notify'),
              indicate: characteristic.properties.includes('indicate'),
              authenticatedSignedWrites: characteristic.properties.includes('authenticatedSignedWrites'),
              extendedProperties: characteristic.properties.includes('extendedProperties'),
              notifyEncryptionRequired: characteristic.properties.includes('notifyEncryptionRequired'),
              indicateEncryptionRequired: characteristic.properties.includes('indicateEncryptionRequired'),
            },
          })),
        };
      }),
    };
  }

  async readRssi(options: DeviceIdOptions): Promise<ReadRssiResult> {
    const { peripheral } = this.getDevice(options);
    const key = `readRssi|${peripheral.id}`;
    this.deviceManager.removeAllListeners(key);
    return new Promise((resolve, reject) => {
      this.deviceManager.on(key, (value: number) => resolve({ value: `${value}` }));
      try {
        this.deviceManager.readRssi(peripheral);
      } catch (err) {
        reject(err);
      }
    });
  }

  async read(options: ReadOptions): Promise<ReadResult> {
    const { deviceId, characteristic, service } = options;
    const result = await this.deviceManager.readCharacteristic(deviceId, service, characteristic);
    return { value: new DataView(result) };
  }

  async write(options: WriteOptions): Promise<void> {
    const { deviceId, characteristic, service, value } = options;
    return await this.deviceManager.writeCharacteristic(
      deviceId,
      service,
      characteristic,
      Buffer.from((value as DataView).buffer)
    );
  }

  async writeWithoutResponse(options: WriteOptions): Promise<void> {
    const { deviceId, characteristic, service, value } = options;
    return await this.deviceManager.writeCharacteristic(
      deviceId,
      service,
      characteristic,
      Buffer.from((value as DataView).buffer),
      true
    );
  }

  async startNotifications(options: ReadOptions): Promise<void> {
    const { deviceId, service, characteristic } = options;
    const listenerId = `notification|${deviceId}|${service}|${characteristic}`;
    this.deviceManager.removeAllListeners(listenerId);
    this.deviceManager.on(listenerId, (value: Buffer) => {
      this.emit(listenerId, { value: new DataView(value) });
    });
    return this.deviceManager.startNotifications(deviceId, service, characteristic);
  }

  async stopNotifications(options: ReadOptions): Promise<void> {
    const { deviceId, service, characteristic } = options;
    return this.deviceManager.stopNotifications(deviceId, service, characteristic);
  }

  private getDevice(options: DeviceIdOptions, checkConnection = true): Device {
    const { deviceId } = options;
    if (deviceId == null) {
      throw new Error('deviceId required.');
    }
    const device = this.deviceMap.get(deviceId);
    if (device == null) {
      throw new Error(`Device not found. Call 'requestDevice', 'requestLEScan' or 'getDevices' first.`);
    }
    const { peripheral } = device;
    if (checkConnection && peripheral.state !== 'connected') {
      throw new Error('Not connected to device.');
    }
    return device;
  }

  private getBleDevice(peripheral: Peripheral): BleDevice {
    const bleDevice: BleDevice = {
      deviceId: peripheral.id,
      // use undefined instead of null if name is not available
      name: peripheral.advertisement.localName,
      uuids: peripheral.advertisement.serviceUuids,
    };
    return bleDevice;
  }

  private getServiceUUIDs(options?: RequestBleDeviceOptions): string[] {
    return (options || {}).services || [];
  }

  private getScanResult(peripheral: Peripheral): ScanResultInternal<string> {
    return {
      device: this.getBleDevice(peripheral),
      rssi: peripheral.rssi,
      txPower: peripheral.advertisement.txPowerLevel,
      uuids: peripheral.advertisement.serviceUuids,
      localName: peripheral.advertisement.localName,
      manufacturerData: this.getManufacturerData(peripheral.advertisement.manufacturerData),
      serviceData: this.getServiceData(peripheral.advertisement.serviceData),
    };
  }

  private getManufacturerData(bufferStr: string): { [key: string]: string } | undefined {
    if (bufferStr == null || bufferStr.length === 0) {
      return undefined;
    }
    const buffer = Buffer.from(bufferStr, 'base64');
    if (buffer.length < 2) {
      return {};
    }
    const company = buffer[0] + buffer[1] * 256;
    const data = {} as { [key: string]: string };
    data[`${company}`] = dataToString(buffer, 2);
    return data;
  }

  private getServiceData(data: { uuid: string; data: string }[]): { [key: string]: string } {
    const result = {} as { [key: string]: string };
    data.forEach((d) => {
      result[d.uuid] = dataToString(Buffer.from(d.data, 'base64'));
    });
    return result;
  }

  private getScanOptions(options?: RequestBleDeviceOptions): RequestBleDeviceOptions {
    options = options || {};
    if (options.allowDuplicates == null) {
      options.allowDuplicates = false;
    }
    if (options.services == null) {
      options.services = [];
    }
    return options;
  }

  private unavailable(message: string): CapacitorException {
    return new CapacitorException(message);
  }
}
