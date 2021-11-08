const noble = require('@abandonware/noble');
noble.on('stateChange', () => {
  console.log('starting');
  noble.startScanning(undefined, true, console.log);
});
noble.on('discover', () => console.log('discover'));
