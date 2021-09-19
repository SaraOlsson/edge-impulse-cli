#!/usr/bin/env node

import { SerialConnector } from './serial-connector';
import fs from 'fs';
import Path from 'path';
import EiSerialProtocol, {
    EiSerialDeviceConfig
} from '../shared/daemon/ei-serial-protocol';
import { Config } from './config';
import { findSerial } from './find-serial';
import checkNewVersions from './check-new-version';
import { getCliVersion } from './init-cli-app';

import request from 'request-promise';

const SERIAL_PREFIX = '\x1b[33m[SER]\x1b[0m';

const versionArgv = process.argv.indexOf('--version') > -1;
const version = (<{ version: string }>JSON.parse(fs.readFileSync(Path.join(__dirname, '..', '..', 'package.json'), 'utf-8'))).version;
const debugArgv = process.argv.indexOf('--debug') > -1;
const continuousArgv = process.argv.indexOf('--continuous') > -1;
const rawArgv = process.argv.indexOf('--raw') > -1;
const classesArgvIx = process.argv.indexOf('--classes');
const classesArgv = classesArgvIx !== -1 ? process.argv[classesArgvIx + 1] : undefined;
const whichDeviceArgvIx = process.argv.indexOf('--which-device');
const whichDeviceArgv = whichDeviceArgvIx !== -1 ? Number(process.argv[whichDeviceArgvIx + 1]) : undefined;

let stdinAttached = false;
let serial: SerialConnector | undefined;

let allDataBuffers: Buffer[] = [];

const configFactory = new Config();
// tslint:disable-next-line:no-floating-promises
(async () => {
    try {
        if (versionArgv) {
            console.log(getCliVersion());
            process.exit(0);
        }

        console.log('Edge Impulse impulse runner (Azure Forwarder) v' + version);

        try {
            await checkNewVersions(configFactory);
        }
        catch (ex) {
            /* noop */
        }

        if (rawArgv && (debugArgv || continuousArgv)) {
            console.log('Cannot use --raw while also declaring --debug or --continuous');
            process.exit(1);
        }

        if (debugArgv && continuousArgv) {
            console.log('Cannot combine both --debug and --continuous');
            process.exit(1);
        }

        let deviceId = await findSerial(whichDeviceArgv);
        await connectToSerial(deviceId);
    }
    catch (ex) {
        console.error('Failed to set up serial daemon', ex);
    }
})();

function sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

function onStdIn(data: Buffer) {
    if (!serial) return;

    // tslint:disable-next-line: no-floating-promises
    serial.write(Buffer.from(data.toString('ascii').trim() + '\r\n', 'ascii'));
}

async function connectToSerial(deviceId: string) {
    // if this is set it means we have a connection
    let config: EiSerialDeviceConfig | undefined;

    serial = new SerialConnector(deviceId, 115200);
    const serialProtocol = new EiSerialProtocol(serial);
    serial.on('error', err => {
        console.log(SERIAL_PREFIX, 'Serial error - retrying in 5 seconds', err);
        setTimeout(serial_connect, 5000);
    });
    serial.on('close', () => {
        console.log(SERIAL_PREFIX, 'Serial closed - retrying in 5 seconds');
        setTimeout(serial_connect, 5000);
    });

    let firstExit = true;

    const onSignal = async () => {
        if (!firstExit || !inferenceStarted) {
            process.exit(1);
        }
        else {
            console.log(SERIAL_PREFIX, 'Received stop signal, trying to stop inferencing... ' +
                'Press CTRL+C again to force quit.');
            inferenceStarted = false;
            firstExit = false;
            try {
                await serialProtocol.stopInference();
            }
            catch (ex2) {
                let ex = <Error>ex2;
                console.log(SERIAL_PREFIX, 'Failed to stop inferencing', ex.message);
            }
            process.exit(1);
        }
    };

    process.on('SIGHUP', onSignal);
    process.on('SIGINT', onSignal);

    let inferenceStarted = false;

    serial.on('data', data => {
        if ((serial && serial.isConnected() && inferenceStarted) || rawArgv) {
            process.stdout.write(data.toString('ascii'));
            onData(data)
        }
    });

    // SARA: below

    function onData(data: Buffer) {

        allDataBuffers.push(data);
        let dataBuffer = Buffer.concat(allDataBuffers);
        let dataString = dataBuffer.toString('ascii');
        let subs = dataString.split("Predictions");

        subs.forEach(possiblePred => {

            let part: string = possiblePred.substring(
                possiblePred.indexOf(".):") + 3, 
                possiblePred.indexOf("Starting")
            );
            let withoutLineBreaks = part.replace("\n","");
            let withoutColon = withoutLineBreaks.replace(/:/g,"");
            let trimmed = withoutColon.replace(/\s+/g, ' ').trim();
            
            if(isRelevantString(trimmed))
            {
                console.log("Sara trimmed: ")
                console.log(trimmed)
                sendToAzure(trimmed);

                allDataBuffers = []; // done several times now but only needed once really
            }

        });
    }

    function isRelevantString(data: string) {

        let classes = classesArgv?.split("_"); // e.g no_noise_unknown_yes
        if(classes && classes.every(substring=>data.includes(substring)))
        {
            return true;
        }
        return false;
    }

    async function sendToAzure(data: string) {

        // TODO: make not static
        let azEndpoint = "http://localhost:7071/api/eirundata";

        let predictions: any = [];
        let maxScore: number = 0;
        let resultLabel: string = "none";

        let splitted = data.split(" ");
        while (splitted.length > 0) {
            let arrayElement = splitted.splice(0,2);

            const labelValue = arrayElement[0];
            const scoreValue: number = +arrayElement[1];
        
            predictions.push({ 
                label: labelValue,
                score: scoreValue
            });

            maxScore = (scoreValue > maxScore) ? scoreValue : maxScore;
            resultLabel = (scoreValue > maxScore) ? labelValue : resultLabel;
        }

        var payloadData = {
            predictions: predictions,
            maxScore: maxScore,
            resultLabel: resultLabel
        };
        
        let ingestionPayload = {
            payload: payloadData
        };
        let encoded = JSON.stringify(ingestionPayload);

        await request.post(azEndpoint, {
            headers: {
                'Content-Type': 'application/json'
            },
            body: encoded,
            encoding: 'binary'
        });
    }

    // SARA: above

    async function connectLogic() {
        if (serial && !serial.isConnected()) {
            inferenceStarted = false;
            return setTimeout(serial_connect, 5000);
        }

        if (rawArgv) {
            process.stdin.resume();
            if (!stdinAttached) {
                process.stdin.on('data', onStdIn);
                stdinAttached = true;
            }

            console.log(SERIAL_PREFIX, 'Connected to', deviceId);
            return;
        }

        config = undefined;
        console.log(SERIAL_PREFIX, 'Serial is connected, trying to read config...');

        try {
            await serialProtocol.onConnected();

            config = await serialProtocol.getConfig();

            console.log(SERIAL_PREFIX, 'Retrieved configuration');
            console.log(SERIAL_PREFIX, 'Device is running AT command version ' +
                config.info.atCommandVersion.major + '.' + config.info.atCommandVersion.minor + '.' +
                config.info.atCommandVersion.patch);

            // we support devices with version 1.6.x and lower
            if (config.info.atCommandVersion.major > 1 || config.info.atCommandVersion.minor > 6) {
                console.error(SERIAL_PREFIX,
                    'Unsupported AT command version running on this device. Supported version is 1.6.x and lower, ' +
                    'but found ' + config.info.atCommandVersion.major + '.' + config.info.atCommandVersion.minor + '.' +
                    config.info.atCommandVersion.patch + '.');
                console.error(SERIAL_PREFIX,
                    'Update the Edge Impulse CLI tools (via `npm update edge-impulse-cli -g`) ' +
                    'to continue.');
                process.exit(1);
            }

            let mode: 'normal' | 'continuous' | 'debug' = 'normal';
            if (continuousArgv) {
                mode = 'continuous';
            }
            else if (debugArgv) {
                mode = 'debug';
            }

            await serialProtocol.startInference(mode);

            console.log(SERIAL_PREFIX, 'Started inferencing, press CTRL+C to stop...');

            inferenceStarted = true;
        }
        catch (ex2) {
            let ex = <Error>ex2;
            console.error(SERIAL_PREFIX, 'Failed to get info off device:' + ex.message + '. ' +
                'Is this device running a binary built through Edge Impulse? Reconnecting in 5 seconds...');
            setTimeout(connectLogic, 5000);
        }
    }
    serial.on('connected', connectLogic);

    async function serial_connect() {
        if (!serial) return;

        try {
            await serial.connect();
        }
        catch (ex2) {
            let ex = <Error>ex2;
            console.error(SERIAL_PREFIX, 'Failed to connect to', deviceId, 'retrying in 5 seconds', ex.message || ex);
            if (ex.message && ex.message.indexOf('Permission denied')) {
                console.error(SERIAL_PREFIX, 'You might need `sudo` or set up the right udev rules');
            }
            setTimeout(serial_connect, 5000);
        }
    }

    console.log(SERIAL_PREFIX, 'Connecting to', deviceId);

    // tslint:disable-next-line:no-floating-promises
    serial_connect();
}
