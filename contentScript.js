const {ipcMain, BrowserWindow} = require('electron');
const path = require('path');
const https = require('https');
const version = require('./package.json').version;
const DEV_MODE = process.env.DEV_MODE;
const REMOTE_HOST = process.env.REMOTE_HOST;
const pendoHost = REMOTE_HOST ? REMOTE_HOST : 'https://app.pendo.io';
const MESSAGE_SOURCE_CONTENT_SCRIPT = 'pendo-designer-content-script';

const windowPairings = {};
let sources;

function addLaunchDesignerFnsToWindow(event) {
    event.sender.executeJavaScript(`
        if (!window.ipcRenderer) {
            window.ipcRenderer = require('electron').ipcRenderer;
        }

        var isReadyInterval = setInterval(function() {
            if(window.pendo && window.pendo.isReady && window.pendo.isReady()) {
                clearInterval(isReadyInterval);
                window.pendo.launchDesigner = (debug) => {
                    window.ipcRenderer.send('pendo-start-designer', {
                        debug: !!debug
                    });
                };
            }
        }, 100);


        window.ipcRenderer.on('request-pendo', () => {
            if(window.pendo) {
                window.ipcRenderer.send('respond-pendo', {
                    arePluginsLoaded: !!window.pendo.DESIGNER_VERSION
                });
            }
        });
    `);
}

function addAgentPostMessageScriptToWindow(customerWindow, host) {
    customerWindow.sender.executeJavaScript(`
        if (!window.ipcRenderer) {
            window.ipcRenderer = require('electron').ipcRenderer;
        }

        var id = 'pendo-designer-plugin-script';
        if (!document.getElementById(id)) {
            const agentPostmessageScript = document.createElement('script');
            agentPostmessageScript.setAttribute('id', id);
            agentPostmessageScript.src = "${host}/designer/latest/plugin.js";
            document.body.appendChild(agentPostmessageScript);
        }
    `);
}

function addDesignerToCustomerWindow(customerWindow, options) {
    const {height} = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const designerWindowOptions = {
        x: 0,
        y: 0,
        width: 370,
        minWidth: 370,
        maxWidth: 370,
        minHeight: 700,
        height: height,
        title: 'Pendo Designer',
        partition: 'persist:pendo',
        plugins: true
    };

    if (options.debug) {
        designerWindowOptions.width = 1070;
    }

    const designerWindow = new BrowserWindow(designerWindowOptions);
    designerWindow.webContents.on('dom-ready', () => {
        if (DEV_MODE) {
            designerWindow.webContents.executeJavaScript(`window.PENDO_MODE="dev";`);
        }
    });

    designerWindow.loadURL(`${options.host}/designer/latest/designer.html`);

    if (options.debug) {
        designerWindow.webContents.openDevTools();
    }

    customerWindow.setPosition(designerWindowOptions.width, customerWindow.getPosition()[1]);
    return designerWindow;
}

function addLoginWindowToDesigner(designerWindow, options) {
    const loginViewOptions = {
        width: 1070,
        resizable: false,
        height: 840,
        title: 'Login to Pendo Designer',
        parent: designerWindow,
        partition: 'persist:pendo',
        webPreferences: {
            nodeIntegration: false
        }
    };

    const loginWindow = new BrowserWindow(loginViewOptions);
    const loginURL = `${options.host}/login`;
    const dashboardURL = `${options.host}/`;

    loginWindow.loadURL(loginURL);
    loginWindow.show();

    // When logging in for the first time, we get a real navigation event
    loginWindow.webContents.on('did-navigate', (event, url) => {
        if (url === dashboardURL) {
            loginWindow.hide();
        }
    });

    // When already logged in, we get an in-page redirect from app.pendo
    loginWindow.webContents.on('did-navigate-in-page', (event, url) => {
        if (url === dashboardURL) {
            loginWindow.hide();
        }
    });

    loginWindow.on('hide', () => {
        designerWindow.show();
    });
}

function sendMessageToBrowserWindow(destinationWebContents, messageObj) {
    destinationWebContents.send('pendo-designer-message', messageObj);
}

function getRemoteSources(cb, host) {
    if (DEV_MODE && REMOTE_HOST) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    return https.get(`${host}/designer/latest/sources.json`, (response) => {
        // Continuously update stream with data
        let body = '';
        response.on('data', function (d) {
            body += d;
        });
        response.on('end', function () {
            cb(JSON.parse(new String(body, "UTF-8")));
        });
    });
}

function putWindowIntoDesignerMode(event) {
    // put agent into designer mode
    sendMessageToBrowserWindow(event.sender, {
        type: 'connect',
        source: MESSAGE_SOURCE_CONTENT_SCRIPT,
        destination: 'pendo-designer-agent'
    });
}

function unloadDesignerFromWindow(event) {
    sendMessageToBrowserWindow(event.sender, {
        type: 'unload',
        source: MESSAGE_SOURCE_CONTENT_SCRIPT,
        destination: 'pendo-designer'
    });
}

function bootstrapDesigner(event, options) {
    const windowPairing = windowPairings[event.sender];
    const designerWindow = addDesignerToCustomerWindow(windowPairing.customerWindow, options);
    windowPairing.designerWindow = designerWindow;

    putWindowIntoDesignerMode(event);

    designerWindow.on('close', unloadDesignerFromWindow);

    designerWindow.on('closed', () => {
        delete windowPairing.designerWindow;
    });

    return designerWindow;
}

function pendoLoginDesigner(event, options) {

    addLoginWindowToDesigner(event);
}

function pendoStartDesigner(event, options) {
    const arePluginsLoaded = setInterval(function () {
        event.sender.send('request-pendo');
    }, 100);


    const respondPendo = (event, message) => {
        if (!message.arePluginsLoaded) {
            return addAgentPostMessageScriptToWindow(event, pendoHost);
        }

        clearInterval(arePluginsLoaded);

        ipcMain.removeListener('respond-pendo', respondPendo);

        const config = Object.assign({}, options, {host: pendoHost});
        const designerWindow = bootstrapDesigner(event, config);
        addLoginWindowToDesigner(designerWindow, config);
    };


    ipcMain.on('respond-pendo', respondPendo);


    ipcMain.on('pendo-designer-message', ipcMessageBus);
}

function ipcMessageBus(event, message) {
    switch (message.destination) {
        case sources.designer:
            const {designerWindow} = windowPairings[event.sender];
            if (!designerWindow) return console.warn('Designer window does not exist');

            sendMessageToBrowserWindow(designerWindow.webContents, message);
            break;
        case sources.plugin:
        case sources.agent:
            const {customerWindow} = Object.values(windowPairings).find(windowPairing => {
                if (windowPairing.designerWindow) {
                    return windowPairing.designerWindow.webContents === event.sender
                }
            });

            if (!customerWindow) return console.warn('Customer window does not exist');
            sendMessageToBrowserWindow(customerWindow.webContents, message);
    }
}

function initPendo(app, browserWindow) {
    windowPairings[browserWindow.webContents] = {
        customerWindow: browserWindow
    };
    browserWindow.webContents.on('did-finish-load', (event) => {
        addLaunchDesignerFnsToWindow(event);

        ipcMain.on('pendo-start-designer', pendoStartDesigner);


        ipcMain.on('pendo-login-designer', pendoLoginDesigner);
    });
}

function canInit(browserWindow, options = {}) {
    const {restricted, browserTitles} = options;

    const isNotPendoWindow = browserWindow.getTitle().indexOf('Pendo') === -1;
    const isNotFrameless = browserWindow.webContents.browserWindowOptions.frame;
    const isPendoEnabled = restricted ? browserWindow.webContents.browserWindowOptions.pendoEnabled : true;

    let isValidBrowserWindowTitle = true;

    if (browserTitles) {
        isValidBrowserWindowTitle = browserTitles.includes(browserWindow.getTitle());
    }

    return isNotPendoWindow && isNotFrameless && isValidBrowserWindowTitle && isPendoEnabled;
}


function startUp() {
    getRemoteSources((remoteSource) => {
        sources = remoteSource;
    }, pendoHost);


    ipcMain.once('pendo-electron-version', (event) => {
        event.returnValue = {
            version
        };
    });
}

exports.use = function (app, options) {

    startUp();

    app.on('browser-window-created', (event, browserWindow) => {
        if (canInit(browserWindow, options)) {
            initPendo(app, browserWindow);
        }
    });

    if (DEV_MODE && REMOTE_HOST) {
        app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
            if (url.match(/local/) || url.match(/127\.0\.0\.1/)) {
                event.preventDefault();
                callback(true)
            }
        });
    }
};
