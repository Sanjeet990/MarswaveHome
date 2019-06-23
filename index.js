const express = require('express');
const bodyParser = require('body-parser');

const admin = require('firebase-admin');

let serviceAccount = require('./secrets.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

let db = admin.firestore();

const {AuthenticationClient} = require('auth0');
const auth0 = new AuthenticationClient({
  'clientId': 'v12WpZgnb7rdCH8opzT0I03Zirux4Lm2',
  'domain': 'marswave.auth0.com'
});

const functions = require('firebase-functions');

const {smarthome} = require('actions-on-google');
const app = smarthome();

const getEmail = async (headers) => {
  const accessToken = headers.authorization.substr(7);
  const {email} = await auth0.getProfile(accessToken);
  return email;
}

db.settings({timestampsInSnapshots: true});

var port = process.env.PORT || 3000;

app.onSync(async (body, headers) => {
  const userEmail = await getEmail(headers);
  const userDoc = await db.collection('users').doc(userEmail).get();

  if (!userDoc.exists) {
    // User account does not exist in database.
    // TODO Create user

    // Return an empty device array
    return {
      requestId: body.requestId,
      payload: {
        agentUserId: userEmail,
        devices: []
      }
    }
  }

  const userDevices = await db.collection('users')
      .doc(userEmail)
      .collection('devices')
      .get();
  const devices = [];
  userDevices.forEach(deviceDoc => {
    const data = deviceDoc.data();
    const device = {
        "id": data.id,
        "type": data.type,
        "traits": [data.traits],
        "name": {
          "defaultNames": [data.defaultNames],
          "name": data.name,
          "nicknames": [data.nicknames]
        },
        "willReportState": false,
        "deviceInfo": {
          "manufacturer": data.manufacturer,
          "model": data.model,
          "hwVersion": data.hwVersion,
          "swVersion": data.swVersion
        },
        "customData": {
          "fooValue": 74,
          "barValue": true,
          "bazValue": "foo"
        }
    };
    devices.push(device);
  });

  return {
    requestId: body.requestId,
    payload: {
      agentUserId: userEmail,
      devices
    }
  }
});


app.onExecute(async (body, headers) => {
  // TODO Send command to device
  const userId = await getEmail(headers);
  
  const commands = [{
    ids: [],
    status: 'SUCCESS',
    states: {},
  }];
  
  const { devices, execution } = body.inputs[0].payload.commands[0];
  
  devices.forEach(device => {
	  try {
			const states = doExecute(userId, device.id, execution[0]);
			commands[0].ids.push(device.id);
			commands[0].states = states;
			// Report state back to Homegraph
			app.reportState({
				agentUserId: userId,
				requestId: Math.random().toString(),
				payload: {
					devices: {
						states: {
							[device.id]: states,
						},
					},
				},
			});
		}
		catch (e) {
			commands.push({
				ids: [device.id],
				status: 'ERROR',
				errorCode: e.message,
			});
		}
  });
  
  return {
        requestId: body.requestId,
        payload: {
            commands,
        },
    };
});

app.onDisconnect((body, headers) => {
  // TODO Disconnect user account from Google Assistant
  // You can return an empty body
  return {};
});

const doExecute = async (userId, deviceId, execution) => {
        const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
        if (!doc.exists) {
            throw new Error('deviceNotFound');
        }
        const states = {
            online: true,
        };
        const data = doc.data();
        if (!data.states.online) {
            throw new Error('deviceOffline');
        }
        switch (execution.command) {
            // action.devices.traits.ArmDisarm
            case 'action.devices.commands.ArmDisarm':
                if (execution.params.arm !== undefined) {
                    states.isArmed = execution.params.arm;
                }
                else if (execution.params.cancel) {
                    // Cancel value is in relation to the arm value
                    states.isArmed = !data.states.isArmed;
                }
                if (execution.params.armLevel) {
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.isArmed': states.isArmed || data.states.isArmed,
                        'states.currentArmLevel': execution.params.armLevel,
                    });
                    states['currentArmLevel'] = execution.params.armLevel;
                }
                else {
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.isArmed': states.isArmed || data.states.isArmed,
                    });
                }
                break;
            // action.devices.traits.Brightness
            case 'action.devices.commands.BrightnessAbsolute':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.brightness': execution.params.brightness,
                });
                states['brightness'] = execution.params.brightness;
                break;
            // action.devices.traits.CameraStream
            case 'action.devices.commands.GetCameraStream':
                states['cameraStreamAccessUrl'] = 'https://fluffysheep.com/baaaaa.mp4';
                break;
            // action.devices.traits.ColorSetting
            case 'action.devices.commands.ColorAbsolute':
                let color = {};
                if (execution.params.color.spectrumRGB) {
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.color': {
                            spectrumRgb: execution.params.color.spectrumRGB,
                        },
                    });
                    color = {
                        spectrumRgb: execution.params.color.spectrumRGB,
                    };
                }
                else if (execution.params.color.spectrumHSV) {
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.color': {
                            spectrumHsv: execution.params.color.spectrumHSV,
                        },
                    });
                    color = {
                        spectrumHsv: execution.params.color.spectrumHSV,
                    };
                }
                else if (execution.params.color.temperature) {
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.color': {
                            temperatureK: execution.params.color.temperature,
                        },
                    });
                    color = {
                        temperatureK: execution.params.color.temperature,
                    };
                }
                else {
                    throw new Error('notSupported');
                }
                states['color'] = color;
                break;
            // action.devices.traits.Dock
            case 'action.devices.commands.Dock':
                // This has no parameters
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.isDocked': true,
                });
                states['isDocked'] = true;
                break;
            // action.devices.traits.FanSpeed
            case 'action.devices.commands.SetFanSpeed':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.currentFanSpeedSetting': execution.params.fanSpeed,
                });
                states['currentFanSpeedSetting'] = execution.params.fanSpeed;
                break;
            case 'action.devices.commands.Reverse':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.currentFanSpeedReverse': true,
                });
                break;
            // action.devices.traits.Locator
            case 'action.devices.commands.Locate':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.silent': execution.params.silent,
                    'states.generatedAlert': true,
                });
                states['generatedAlert'] = true;
                break;
            // action.devices.traits.LockUnlock
            case 'action.devices.commands.LockUnlock':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.isLocked': execution.params.lock,
                });
                states['isLocked'] = execution.params.lock;
                break;
            // action.devices.traits.Modes
            case 'action.devices.commands.SetModes':
                const currentModeSettings = data.states.currentModeSettings;
                for (const mode of Object.keys(execution.params.updateModeSettings)) {
                    const setting = execution.params.updateModeSettings[mode];
                    currentModeSettings[mode] = setting;
                }
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.currentModeSettings': currentModeSettings,
                });
                states['currentModeSettings'] = currentModeSettings;
                break;
            // action.devices.traits.OnOff
            case 'action.devices.commands.OnOff':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.on': execution.params.on,
                });
                states['on'] = execution.params.on;
                break;
            // action.devices.traits.OpenClose
            case 'action.devices.commands.OpenClose':
                // Check if the device can open in multiple directions
                if (data.attributes && data.attributes.openDirection) {
                    // The device can open in more than one direction
                    const direction = execution.params.openDirection;
                    data.states.openState.forEach((state) => {
                        if (state.openDirection === direction) {
                            state.openPercent = execution.params.openPercent;
                        }
                    });
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.openState': data.states.openState,
                    });
                }
                else {
                    // The device can only open in one direction
                    await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                        'states.openPercent': execution.params.openPercent,
                    });
                    states['openPercent'] = execution.params.openPercent;
                }
                break;
            // action.devices.traits.RunCycle - No execution
            // action.devices.traits.Scene
            case 'action.devices.commands.ActivateScene':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.deactivate': execution.params.deactivate,
                });
                // Scenes are stateless
                break;
            // action.devices.traits.StartStop
            case 'action.devices.commands.StartStop':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.isRunning': execution.params.start,
                });
                states['isRunning'] = execution.params.start;
                states['isPaused'] = data.states.isPaused;
                break;
            case 'action.devices.commands.PauseUnpause':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.isPaused': execution.params.pause,
                });
                states['isPaused'] = execution.params.pause;
                states['isRunning'] = data.states.isRunning;
                break;
            // action.devices.traits.TemperatureControl
            case 'action.devices.commands.SetTemperature':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.temperatureSetpointCelsius': execution.params.temperature,
                });
                states['temperatureSetpointCelsius'] = execution.params.temperature;
                states['temperatureAmbientCelsius'] = data.states.temperatureAmbientCelsius;
                break;
            // action.devices.traits.TemperatureSetting
            case 'action.devices.commands.ThermostatTemperatureSetpoint':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.thermostatTemperatureSetpoint': execution.params.thermostatTemperatureSetpoint,
                });
                states['thermostatTemperatureSetpoint'] = execution.params.thermostatTemperatureSetpoint;
                states['thermostatMode'] = data.states.thermostatMode;
                states['thermostatTemperatureAmbient'] = data.states.thermostatTemperatureAmbient;
                states['thermostatHumidityAmbient'] = data.states.thermostatHumidityAmbient;
                break;
            case 'action.devices.commands.ThermostatTemperatureSetRange':
                const { thermostatTemperatureSetpointLow, thermostatTemperatureSetpointHigh, } = execution.params;
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.thermostatTemperatureSetpointLow': thermostatTemperatureSetpointLow,
                    'states.thermostatTemperatureSetpointHigh': thermostatTemperatureSetpointHigh,
                });
                states['thermostatTemperatureSetpoint'] = data.states.thermostatTemperatureSetpoint;
                states['thermostatMode'] = data.states.thermostatMode;
                states['thermostatTemperatureAmbient'] = data.states.thermostatTemperatureAmbient;
                states['thermostatHumidityAmbient'] = data.states.thermostatHumidityAmbient;
                break;
            case 'action.devices.commands.ThermostatSetMode':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.thermostatMode': execution.params.thermostatMode,
                });
                states['thermostatMode'] = execution.params.thermostatMode;
                states['thermostatTemperatureSetpoint'] = data.states.thermostatTemperatureSetpoint;
                states['thermostatTemperatureAmbient'] = data.states.thermostatTemperatureAmbient;
                states['thermostatHumidityAmbient'] = data.states.thermostatHumidityAmbient;
                break;
            // action.devices.traits.Timer
            case 'action.devices.commands.TimerStart':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.timerRemainingSec': execution.params.timerTimeSec,
                });
                states['timerRemainingSec'] = execution.params.timerTimeSec;
                break;
            case 'action.devices.commands.TimerAdjust':
                if (data.states.timerRemainingSec === -1) {
                    // No timer exists
                    throw new Error('noTimerExists');
                }
                const newTimerRemainingSec = data.states.timerRemainingSec + execution.params.timerTimeSec;
                if (newTimerRemainingSec < 0) {
                    throw new Error('valueOutOfRange');
                }
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.timerRemainingSec': newTimerRemainingSec,
                });
                states['timerRemainingSec'] = newTimerRemainingSec;
                break;
            case 'action.devices.commands.TimerPause':
                if (data.states.timerRemainingSec === -1) {
                    // No timer exists
                    throw new Error('noTimerExists');
                }
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.timerPaused': true,
                });
                states['timerPaused'] = true;
                break;
            case 'action.devices.commands.TimerResume':
                if (data.states.timerRemainingSec === -1) {
                    // No timer exists
                    throw new Error('noTimerExists');
                }
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.timerPaused': false,
                });
                states['timerPaused'] = false;
                break;
            case 'action.devices.commands.TimerCancel':
                if (data.states.timerRemainingSec === -1) {
                    // No timer exists
                    throw new Error('noTimerExists');
                }
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.timerRemainingSec': -1,
                });
                states['timerRemainingSec'] = 0;
                break;
            // action.devices.traits.Toggles
            case 'action.devices.commands.SetToggles':
                const currentToggleSettings = data.states.currentToggleSettings;
                for (const toggle of Object.keys(execution.params.updateToggleSettings)) {
                    const enable = execution.params.updateToggleSettings[toggle];
                    currentToggleSettings[toggle] = enable;
                }
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.currentToggleSettings': currentToggleSettings,
                });
                states['currentToggleSettings'] = currentToggleSettings;
                break;
            default:
                throw new Error('actionNotAvailable');
        }
        return states;
}

express().use(bodyParser.json(), app).listen(port);
