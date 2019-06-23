var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });

function asyncForEach(array, callback) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let index = 0; index < array.length; index++) {
            yield callback(array[index], index, array);
        }
    });
}


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
const app = smarthome({
  jwt: require('./secrets.json')
});

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
				requestId: body.requestId,
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

app.onQuery(async (body, headers) => {
  // TODO Get device state
  try{
  const userId = await getEmail(headers);
  const { devices } = body.inputs[0].payload;
  const deviceStates = {};
  
  devices.forEach(async(device) => {
	  const states = await doCheck(userId, device.id);
	  deviceStates[device.id] = states;
  });
      
  const myObject = {
    requestId: body.requestId,
    payload: {
      devices: deviceStates,
    },
  };
  console.log(JSON.stringify(myObject, null, 4));
  return myObject;
  }catch(e){
  console(e.getmessage);
  }
});

app.onDisconnect((body, headers) => {
  // TODO Disconnect user account from Google Assistant
  // You can return an empty body
  return {};
});

const doCheck = async (userId, deviceId) => {
	  const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
	  if (!doc.exists) {
        throw new Error('deviceNotFound' + deviceId);
      }
      const data = doc.data().states;
	  return data;
}

const doExecute = async (userId, deviceId, execution) => {
        const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
        if (!doc.exists) {
            throw new Error('deviceNotFound' + deviceId);
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
            case 'action.devices.commands.OnOff':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.on': execution.params.on,
                });
                states['on'] = execution.params.on;
                break;
            // action.devices.traits.OpenClose
            default:
                throw new Error('actionNotAvailable');
        }
        return states;
}

express().use(bodyParser.json(), app).listen(port);
