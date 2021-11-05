const noble = require('@abandonware/noble');
noble.on('stateChange', () => {
  console.log('starting');
  noble.startScanning();
});
noble.on('discover', console.log);
