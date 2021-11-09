import noble from '@abandonware/noble';
import { EventEmitter } from 'events';

export interface BluetoothLEDisplayStrings {
  noDeviceFound: string;
  availableDevices: string;
  scanning: string;
  cancel: string;
}

const connectionTimeout = 10;

export type DescriptorInternal = Pick<noble.Descriptor, 'uuid' | 'name' | 'type'>;

export interface CharacteristicInternal extends Pick<noble.Characteristic, 'uuid' | 'name' | 'type' | 'properties'> {
  descriptors: DescriptorInternal[];
}

export interface ServiceInternal extends Pick<noble.Service, 'uuid' | 'name' | 'type' | 'includedServiceUuids'> {
  characteristics: CharacteristicInternal[];
}

export interface AdvertisementInternal
  extends Pick<noble.Advertisement, 'localName' | 'txPowerLevel' | 'serviceUuids'> {
  serviceData: { uuid: string; data: string }[];
  manufacturerData?: string;
}

export interface PeripheralInternal
  extends Pick<noble.Peripheral, 'id' | 'uuid' | 'address' | 'addressType' | 'connectable' | 'rssi' | 'state'> {
  advertisement: AdvertisementInternal;
  services: ServiceInternal[];
}

export type ScanResultCallback = (peripheral: PeripheralInternal) => void;

export class DeviceManager extends EventEmitter {
  private stateReceiver: ((enabled: boolean) => void) | undefined;
  private scanning = false;
  private discoveredDevices: {
    [key: string]: { peripheral: noble.Peripheral; servicesAndCharacteristics?: noble.ServicesAndCharacteristics };
  } = {};
  private allowDuplicates = false;
  private deviceNameFilter: string | undefined;
  private deviceNamePrefixFilter: string | undefined;

  init(): Promise<void> {
    let callbackCalled = false;
    let error = '';
    return new Promise<void>((resolve, reject) => {
      noble.on('scanStart', () => (this.scanning = true));
      noble.on('scanStop', () => (this.scanning = false));
      noble.on('discover', (peripheral) => this.onDiscoverPeripheral(peripheral));
      if (noble.state === 'poweredOn') {
        callbackCalled = true;
        resolve();
      }
      noble.on('stateChange', (state) => {
        let isInitialized = false;
        switch (state) {
          case 'poweredOn':
            isInitialized = true;
            break;
          case 'poweredOff':
            error = 'BLE powered off';
            this.stopScan();
            break;
          case 'unauthorized':
            error = 'BLE permission denied';
            break;
          case 'unsupported':
            error = 'BLE unsupported';
            break;
          case 'unknown':
          default:
            break;
        }
        if (!callbackCalled) {
          callbackCalled = true;
          if (isInitialized) {
            resolve();
          } else {
            reject(error);
          }
        }
        this.emitState(isInitialized);
      });
    });
  }

  isEnabled(): boolean {
    return noble.state === 'poweredOn';
  }

  registerStateReceiver(receiver: (enabled: boolean) => void): void {
    this.stateReceiver = receiver;
  }

  unregisterStateReceiver(): void {
    this.stateReceiver = undefined;
  }

  startScanning(
    serviceUUIDs: string[],
    name: string | undefined,
    namePrefix: string | undefined,
    allowDuplicates: boolean,
    scanDuration?: number
  ): Promise<void> {
    if (this.scanning) {
      this.stopScan();
      throw new Error('Already scanning. Stopping now.');
    }
    this.discoveredDevices = {};
    this.allowDuplicates = allowDuplicates;
    this.deviceNameFilter = name;
    this.deviceNamePrefixFilter = namePrefix;
    if (scanDuration != null) {
      setTimeout(() => this.stopScan(), scanDuration * 1000);
    }
    return noble.startScanningAsync(serviceUUIDs, allowDuplicates);
  }

  stopScan(): void {
    noble.stopScanning();
  }

  async connect(peripheralDef: PeripheralInternal): Promise<void> {
    const device = this.discoveredDevices[peripheralDef.id];
    if (device == null) {
      throw new Error('Device not found.');
    }
    const { peripheral } = device;
    setTimeout(() => {
      peripheral.cancelConnect();
      throw new Error('Connection timeout.');
    }, connectionTimeout * 1000);
    peripheral.removeAllListeners('disconnect');
    peripheral.on('disconnect', () => {
      this.emit(`disconnected|${peripheral.id}`, {});
    });
    await peripheral.connectAsync();
    const servicesAndCharacteristics = await peripheral.discoverAllServicesAndCharacteristicsAsync();
    this.discoveredDevices[peripheral.id].servicesAndCharacteristics = servicesAndCharacteristics;
  }

  disconnect(peripheralDef: PeripheralInternal): Promise<void> {
    const device = this.discoveredDevices[peripheralDef.id];
    if (device == null) {
      throw new Error('Device not found.');
    }
    const { peripheral } = device;
    return peripheral.disconnectAsync();
  }

  getDevice(id: string): noble.Peripheral | undefined {
    const device = this.discoveredDevices[id];
    return device ? device.peripheral : undefined;
  }

  readCharacteristic(deviceId: string, serviceId: string, characteristicId: string): Promise<Buffer> {
    const characteristic = this.getCharacteristic(deviceId, serviceId, characteristicId);
    if (characteristic == null) {
      throw new Error('Characteristic not found.');
    }
    return characteristic.readAsync();
  }

  writeCharacteristic(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
    data: Buffer,
    withoutResponse = false
  ): Promise<void> {
    const characteristic = this.getCharacteristic(deviceId, serviceId, characteristicId);
    if (characteristic == null) {
      throw new Error('Characteristic not found.');
    }
    return characteristic.writeAsync(data, withoutResponse);
  }

  startNotifications(deviceId: string, serviceId: string, characteristicId: string): Promise<void> {
    const characteristic = this.getCharacteristic(deviceId, serviceId, characteristicId);
    if (characteristic == null) {
      throw new Error('Characteristic not found.');
    }
    characteristic.removeAllListeners('notify');
    characteristic.on('data', (data, isNotification) => {
      if (isNotification) {
        this.emit(`notification|${deviceId}|${serviceId}|${characteristicId}`, data);
      }
    });
    return characteristic.subscribeAsync();
  }

  stopNotifications(deviceId: string, serviceId: string, characteristicId: string): Promise<void> {
    const characteristic = this.getCharacteristic(deviceId, serviceId, characteristicId);
    if (characteristic == null) {
      throw new Error('Characteristic not found.');
    }
    characteristic.removeAllListeners('notify');
    return characteristic.unsubscribeAsync();
  }

  async readRssi(peripheralDef: PeripheralInternal): Promise<void> {
    const device = this.discoveredDevices[peripheralDef.id];
    if (device == null) {
      throw new Error('Device not found.');
    }
    const { peripheral } = device;
    const rssi = await peripheral.updateRssiAsync();
    this.emit(`readRssi|${peripheralDef.id}`, rssi);
  }

  private getCharacteristic(id: string, service: string, characteristic: string): noble.Characteristic | undefined {
    const device = this.discoveredDevices[id];
    if (device) {
      throw new Error('Device not found.');
    }
    if (device.peripheral.state !== 'connected') {
      throw new Error('Device not connected.');
    }
    if (device.servicesAndCharacteristics == null || device.servicesAndCharacteristics.characteristics.length === 0) {
      throw new Error('Device does not have any characteristic.');
    }
    const serviceObj = device.servicesAndCharacteristics.services.find((s) => s.uuid === service);
    if (serviceObj == null) {
      throw new Error('Service not found.');
    }
    return serviceObj.characteristics.find((c) => c.uuid === characteristic);
  }

  private onDiscoverPeripheral(peripheral: noble.Peripheral): void {
    if (peripheral.state === 'connected') {
      return;
    }

    const { id } = peripheral;
    const isNew = this.discoveredDevices[id] == null;
    if (!this.allowDuplicates && !isNew) {
      return;
    }

    const name = peripheral.advertisement.localName;
    if (!this.passesNameFilter(name) || !this.passesNamePrefixFilter(name)) {
      return;
    }

    this.discoveredDevices[id] = { peripheral };
    this.emit('scanResult', this.getPeripheralInternal(peripheral));
  }

  private getPeripheralInternal(peripheral: noble.Peripheral): PeripheralInternal {
    const { id, uuid, address, addressType, connectable, advertisement, rssi, state, services } = peripheral;
    return {
      id,
      uuid,
      address,
      addressType,
      connectable,
      advertisement: {
        ...advertisement,
        serviceData: (advertisement.serviceData || []).map((s) => ({ ...s, data: s.data.toString('base64') })),
        manufacturerData: advertisement.manufacturerData
          ? advertisement.manufacturerData.toString('base64')
          : undefined,
      },
      rssi,
      state,
      services: (services || []).map((s) => this.getServiceInternal(s)),
    };
  }

  private getServiceInternal(service: noble.Service): ServiceInternal {
    const { uuid, name, type, includedServiceUuids, characteristics } = service;
    return {
      uuid,
      name,
      type,
      includedServiceUuids,
      characteristics: (characteristics || []).map((c) => this.getCharacteristicInternal(c)),
    };
  }

  private getCharacteristicInternal(characteristic: noble.Characteristic): CharacteristicInternal {
    const { uuid, name, type, properties, descriptors } = characteristic;
    return {
      uuid,
      name,
      type,
      properties,
      descriptors: (descriptors || []).map((d) => this.getDescriptorInternal(d)),
    };
  }

  private getDescriptorInternal(descriptor: noble.Descriptor): DescriptorInternal {
    const { uuid, name, type } = descriptor;
    return { uuid, name, type };
  }

  private passesNameFilter(name: string): boolean {
    if (this.deviceNameFilter == null) {
      return true;
    }
    return name === this.deviceNameFilter;
  }

  private passesNamePrefixFilter(name: string): boolean {
    if (this.deviceNamePrefixFilter == null) {
      return true;
    }
    return name.startsWith(this.deviceNamePrefixFilter);
  }

  private emitState(enabled: boolean): void {
    if (this.stateReceiver != null) {
      this.stateReceiver(enabled);
    }
  }
}
