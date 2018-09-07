var MetaWear = require('metawear');
var winston = require('winston');
var util = require("util");
const SensorConfig = require('./sensor-config.js')
const BleConn = require('./ble-conn.js')

module.exports = async function(config, cache, cacheFile) {
  var devices = [];

  for(let d of config['devices']) {
    winston.info("Connecting to device", { 'mac': d['mac'] });
    try {
      let device = await BleConn.findDevice(d['mac']);
      await BleConn.connect(device, true, cache);
      await BleConn.serializeDeviceState(device, cacheFile, cache)

      await new Promise((resolve, reject) => setTimeout(() => resolve(null), 1000));
      winston.info("Configuring device", { 'mac': d['mac'] });
      let valid = [];
      for(let s of Object.keys(config['sensors'])) {
        if (!(s in SensorConfig)) {
          winston.warn(util.format("'%s' is not a valid sensor name", s));
        } else if (!SensorConfig[s].exists(device.board)) {
          winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': device.address });
        } else {
          valid.push(s);
        }
      };
    
      if (valid.length != 0) {
        if (MetaWear.mbl_mw_metawearboard_lookup_module(device.board, MetaWear.Module.LED) != MetaWear.Const.MODULE_TYPE_NA) {
          let pattern = new MetaWear.LedPattern();
          pattern.repeat_count = 5
          MetaWear.mbl_mw_led_load_preset_pattern(pattern.ref(), MetaWear.LedPreset.BLINK);
          MetaWear.mbl_mw_led_write_pattern(device.board, pattern.ref(), MetaWear.LedColor.GREEN);
          MetaWear.mbl_mw_led_play(device.board);
        }

        let name = Buffer.from('name' in d ? d['name'] : 'MetaWear', 'ascii')
        let length = 4 + name.length
        let response = Buffer.alloc(length)
  
        response[0] = length - 1
        response[1] = 0xff
        response[2] = 0x6d
        response[3] = 0x62
        name.copy(response, 4);
        
        MetaWear.mbl_mw_macro_record(device.board, 1);
        for(let s of valid) {
          await new Promise((resolve, reject) => {
            MetaWear.mbl_mw_datasignal_log(SensorConfig[s].signal(device.board, false), MetaWear.FnVoid_DataLoggerP.toPointer(logger => {
              if (logger.address()) resolve(logger)
              else reject('failed to create logger for: ' + s);
            }))
          });
          await SensorConfig[s].configure(device.board, config["sensors"][s]);
        }
        MetaWear.mbl_mw_settings_set_scan_response(device.board, response, response.length);
        await new Promise((resolve, reject) => 
          MetaWear.mbl_mw_macro_end_record(device.board, MetaWear.FnVoid_MetaWearBoardP_Int.toPointer((pointer, id) =>
            resolve(null)
          ))
        )
  
        MetaWear.mbl_mw_logging_start(device.board, 0);
        for(let s of valid) {
          SensorConfig[s].start(device.board);
        }

        var task = new Promise((resolve, reject) => device.once('disconnect', () => resolve(null)))
        MetaWear.mbl_mw_debug_disconnect(device.board)
        await task;

        winston.info("Begin data recording", { 'mac': d['mac'] });
      } else {
        winston.warn("No sensors were enabled for device", { 'mac': d.address })
      }
    } catch (e) {
      winston.warn(e, {'mac': d['mac']});
    }
  }

  process.exit(0)
}