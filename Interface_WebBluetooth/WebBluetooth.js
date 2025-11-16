//=============================================================================
//
//    FILE  : website_ble.js
//
//  PROJECT : Any Chrome-based Web App requiring access to a Bluetooth Device
//
//   AUTHOR : Bill Daniels
//            Copyright 2022-2024, D+S Tech Labs, Inc.
//            MIT License
//
//=============================================================================

//--- Globals ---------------------------------------------

const deviceServiceUUID = '34802252-7185-4d5d-b431-630e7050e8f0';
const commandCharUUID   = '34800001-7185-4d5d-b431-630e7050e8f0';
const responseCharUUID  = '34800002-7185-4d5d-b431-630e7050e8f0';

const dataWindow  = document.getElementById ('dataWindow');
const textEncoder = new TextEncoder ();
const textDecoder = new TextDecoder ();

let btDevice     = undefined;
let btServer     = undefined;
let btService    = undefined;
let commandChar  = undefined;
let responseChar = undefined;
let btConnected  = false;
let btReady      = true;

let scanButtonStyle = document.getElementById ('scanButton').style;
let waitGifStyle    = document.getElementById ('waitGif'   ).style;
let commsStyle      = document.getElementById ('comms'     ).style;


//--- scanForDevices --------------------------------------

async function scanForDevices ()
{
  try
  {
    // Scan for bluetooth devices
    btDevice = await navigator.bluetooth.requestDevice
    ({


      //----------------------
      // Look for all devices
      //----------------------
      acceptAllDevices : true,
      optionalServices : [deviceServiceUUID]  // Required to access service later



      // //----------------------
      // // With device name
      // //----------------------
      // filters :
      // [{
      //   name : 'My BLE Device'
      // }]



      // //----------------------
      // // With services
      // //----------------------
      // filters :
      // [{
      //   services : [0x1234, 0x12345678, '99999999-0000-1000-8000-00805f9b34fb']
      // }]



      // //----------------------
      // // With named service
      // //----------------------
      // filters :
      // [{
      //   services : ['battery_service']
      // }]



    });

    // Connecting ...
    updateState (1);

    // Connect to selected device's GATT Server
    btServer = await btDevice.gatt.connect ();

    // Handle disconnect event
    btDevice.addEventListener ('gattserverdisconnected', () =>
    {
      // Not connected
      updateState (0);
    });

    // Get Service
    btService = await btServer.getPrimaryService (deviceServiceUUID);  // BLE Device Service

    // Get all characteristics
    commandChar  = await btService.getCharacteristic (commandCharUUID );  // Characteristic to send commands to device
    responseChar = await btService.getCharacteristic (responseCharUUID);  // Characteristic to receive responses from device

    // Subscribe to device values
    responseChar.startNotifications ();
    responseChar.addEventListener ('characteristicvaluechanged', updateValue);

    // Connected
    updateState (2);
    AddToLog ('Connected to ' + btDevice.name);
  }
  catch (ex)
  {
    alert (ex);
  }
}

//--- updateState -----------------------------------------
// currentState = 0 (not connected)
// currentState = 1 (connecting ...)
// currentState = 2 (connected)

function updateState (currentState)
{
  try
  {
    switch (currentState)
    {
      case 0 : // not connected
               scanButtonStyle.display = 'inline';
               waitGifStyle   .display = 'none';
               commsStyle     .display = 'none';
               btConnected             = false;
               break;

      case 1 : // connecting ...
               scanButtonStyle.display = 'none';
               waitGifStyle   .display = 'inline';
               commsStyle     .display = 'none';
               btConnected             = false;
               break;

      case 2 : // connected
               scanButtonStyle.display = 'none';
               waitGifStyle   .display = 'none';
               commsStyle     .display = 'inline';
               btConnected             = true;
               break;
    }
  }
  catch (ex)
  {
    alert (ex);
  }
}

//--- sendCommand -----------------------------------------

function sendCommand ()
{
  try
  {
    if (btConnected && btReady && commandChar != undefined)
    {
      // Values sent to a Bluetooth device must be an ArrayBuffer of bytes
      const value   = document.getElementById ('commandField').value;
      const btValue = textEncoder.encode (value);  // Encode value into Uint8Array (UTF-8 bytes)

      // Wait until the writeValue promise resolves
      // before sending another command
      btReady = false;

      commandChar.writeValueWithResponse (btValue)
      .then  (()      => { btReady = true;              })
      .catch ((error) => { btReady = true; throw error; })

      AddToLog ('◀── ' + value);
    }
  }
  catch (ex)
  {
    alert (ex);
  }
}

//--- updateValue -----------------------------------------

function updateValue (event)
{
  try
  {
    // BT data is received as a JavaScript DataView object
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView
    // Use a TextDecoder to convert to string
    const stringValue = textDecoder.decode (event.target.value);
    AddToLog ('──▶ ' + stringValue);
  }
  catch (ex)
  {
    alert (ex);
  }
}

//--- AddToLog --------------------------------------------

function AddToLog (htmlMessage)
{
  try
  {
    dataWindow.innerHTML += htmlMessage + '<br>';
    dataWindow.scrollTop = Number.MAX_SAFE_INTEGER;
  }
  catch (ex)
  {
    alert (ex);
  }
}

//--- Personalize variables to capture from the Sensor ------------
document.getElementById('captureBtn').onclick = function() {
  document.getElementById('captureModal').style.display = 'flex';
};

function closeCaptureModal() {
  document.getElementById('captureModal').style.display = 'none';
}

function startMonitoring(type) {
  closeCaptureModal();
  // Aquí iría la lógica para enviar comandos y comenzar la monitorización del tipo seleccionado
  AddToLog('Monitoring: ' + type);
  // Por ejemplo: sendSubscribeCommand(type);
}
