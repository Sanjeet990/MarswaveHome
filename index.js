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


express().use(bodyParser.json(), app).listen(port);
