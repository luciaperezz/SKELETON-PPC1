//==============================================================================
//
//     FILE : Firmware_WebBluetooth.ino
//
//  PROJECT : Any Chrome-based Web App requiring access to a Bluetooth Device
//
//    NOTES : Bluetooth SIG Assigned Numbers:
//            https://www.bluetooth.com/wp-content/uploads/Files/Specification/Assigned_Numbers.pdf
//
//            See the following for generating random UUIDs:
//            https://www.uuidgenerator.net/
//
//            The Arduino NANO 33 IoT board seems to stop responding if hit
//            with too many BT messages too fast.
//
//   AUTHOR : Bill Daniels
//            Copyright 2022-2024, D+S Tech Labs, Inc.
//            MIT License
//
//=============================================================================

//--- Includes ----------------------------------------------------------------

#include <Arduino.h>
#include <ArduinoBLE.h>

//--- Defines -----------------------------------------------------------------

#define SERIAL_BAUDRATE          115200L
#define COMMAND_RESPONSE_LENGTH  30       // Update this length to hold your longest message

//--- Globals -----------------------------------------------------------------

const char  *bleDeviceName = "My BLE Device";

char  commandString[COMMAND_RESPONSE_LENGTH] = "";  // Command from BLE client (Chrome browser web app)
int   commandLength = 0;
int   randomValue = 0;

//--- Bluetooth Server (BLE Peripheral Device) ---
BLEService               DeviceService      ("00001815-0000-1000-8000-00805f9b34fb");                                              // Automation IO service
BLEStringCharacteristic  DeviceCommandChar  ("00002b26-0000-1000-8000-00805f9b34fb", BLEWrite         , COMMAND_RESPONSE_LENGTH);  // Your device commands are written here
BLEStringCharacteristic  DeviceResponseChar ("00002b99-0000-1000-8000-00805f9b34fb", BLERead|BLENotify, COMMAND_RESPONSE_LENGTH);  // return string from executing your command
BLEDevice                Client;


//=========================================================
//  setup
//=========================================================

void setup()
{
  Serial.begin (SERIAL_BAUDRATE);

  // Init BLE
  if (!BLE.begin())
  {
    Serial.println ("Unable to initialize BLE.");
    while (true);
  }

  // Add characteristics to service
  DeviceService.addCharacteristic (DeviceCommandChar);   // Command string
  DeviceService.addCharacteristic (DeviceResponseChar);  // Response string

  BLE.setDeviceName        (bleDeviceName);  // Set name for connection
  BLE.setLocalName         (bleDeviceName);  // Set name for connection
  BLE.addService           (DeviceService);  // Add service
  BLE.setAdvertisedService (DeviceService);  // Set Advertise service
  BLE.advertise            ();               // Start advertising

  Serial.println ("Your BLE Device is ready.");
  Serial.print   ("  Device Name : ");
  Serial.println (bleDeviceName);
  Serial.print   ("  MAC Address : ");
  Serial.println (BLE.address());
  Serial.println ("\nListening for BLE clients ...\n");
}

//=========================================================
//  loop
//=========================================================

void loop()
{
  // Wait for a BLE client to connect
  Client = BLE.central ();
  if (Client)
  {
    Serial.print   ("Connected to client, MAC : ");
    Serial.println (Client.address());

    while (Client.connected())
    {
      // Process client commands, if any
      if (DeviceCommandChar.written ())
      {
        // Get command string
        int numChars = min (DeviceCommandChar.valueLength(), COMMAND_RESPONSE_LENGTH-1);
        DeviceCommandChar.readValue (commandString, numChars);
        commandString[numChars] = 0;  // terminate

        Serial.print   ("Received : ");
        Serial.println (commandString);



        // Here, you could execute the command and return a result
        //─────────────────────────────────────────────────────────
        // returnString = MyDevice.ExecuteCommand (commandString);
        //
        // // Send returnString back to client, if any
        // if (strlen (returnString) > 0)
        //   DeviceResponseChar.writeValue (returnString);
        //
        // Serial.print   ("Sent : ");
        // Serial.println (returnString);




        // Just send an ack back for now
        DeviceResponseChar.writeValue ("ACK");




      }
    }

    Serial.println ("Disconnected.");
  }
}
