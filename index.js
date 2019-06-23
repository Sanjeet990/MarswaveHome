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

app.onQuery(async (body, headers) => {
  // TODO Get device state
  const userId = await getEmail(headers);
  const { devices } = body.inputs[0].payload;
  const deviceStates = {};
  
  devices.forEach(async(device) => {
      const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
	  if (!doc.exists) {
        throw new Error('deviceNotFound' + deviceId);
      }
      const data = doc.data().states;
	  deviceStates[device.id] = data;
  });
  
  const myObject = {
    requestId: body.requestId,
    payload: {
      devices: deviceStates,
    },
  };
  console.log(JSON.stringify(myObject, null, 4));
  return myObject;
});

app.onDisconnect((body, headers) => {
  // TODO Disconnect user account from Google Assistant
  // You can return an empty body
  return {};
});

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
