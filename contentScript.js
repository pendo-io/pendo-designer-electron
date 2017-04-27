const {ipcMain, BrowserWindow} = require('electron');
const path = require('path');
const https = require('https');
const version = require('./package.json').version;
const DEV_MODE = process.env.DEV_MODE;
const REMOTE_HOST = process.env.REMOTE_HOST;
const MESSAGE_SOURCE_CONTENT_SCRIPT = 'pendo-designer-content-script';

let designerWindow;

function addLaunchDesignerFnsToWindow(customerWindow) {
    customerWindow.webContents.executeJavaScript(`
        if (!window.ipcRenderer) {
            window.ipcRenderer = require('electron').ipcRenderer;
        }

        window.pendo.launchDesigner = (debug) => {
            window.ipcRenderer.send('pendo-start-designer', {
                debug: !!debug
            });
        };
        window.ipcRenderer.on('request-pendo-host', () => {
            window.ipcRenderer.send('respond-pendo-host', {
                host: window.pendo.HOST,
                version: window.pendo.VERSION,
                arePluginsLoaded: !!window.pendo.DESIGNER_VERSION
            });
        });
    `);
}

function addAgentPostMessageScriptToWindow(customerWindow, host) {
    customerWindow.webContents.executeJavaScript(`
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

    if (DEV_MODE && REMOTE_HOST) {
        const {session} = require('electron');
        session.defaultSession.webRequest.onBeforeRequest(['https://*/designer/latest', 'https://*/designer/latest/*'], function(details, callback) {
            const url = details.url;
            if (url.match(/designer\/latest/)) {
                const substring = details.url.substring(details.url.lastIndexOf('/') + 1);
                const redirectURL = `${REMOTE_HOST}/${substring}`;
                return callback({
                    redirectURL
                });
            }
            callback({});
        });
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

function sendMessageToBrowserWindow(browserWindow, messageObj) {
    browserWindow.webContents.send('pendo-designer-message', messageObj);
}

function getRemoteSources(cb, host) {
    if (DEV_MODE && REMOTE_HOST) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    return https.get(`${host}/designer/latest/sources.json`, (response) => {
        // Continuously update stream with data
        let body = '';
        response.on('data', function(d) {
            body += d;
        });
        response.on('end', function() {
            cb(JSON.parse(new String(body, "UTF-8")));
        });
    });
}


function putWindowIntoDesignerMode(window) {
    // put agent into designer mode
    sendMessageToBrowserWindow(window, {
        type: 'connect',
        source: MESSAGE_SOURCE_CONTENT_SCRIPT,
        destination: 'pendo-designer-agent'
    });
}

function unloadDesignerFromWindow() {
    sendMessageToBrowserWindow(designerWindow, {
        type: 'unload',
        source: MESSAGE_SOURCE_CONTENT_SCRIPT,
        destination: 'pendo-designer'
    });
}


function bootstrapDesigner(customerWindow, options) {
    designerWindow = addDesignerToCustomerWindow(customerWindow, options);

    putWindowIntoDesignerMode(customerWindow);

    designerWindow.on('close', unloadDesignerFromWindow);

    designerWindow.on('closed', () => {
        designerWindow = null;
        ipcMain.removeAllListeners('pendo-designer-message');
    });
}

function initPendo(app, customerWindow) {
    customerWindow.webContents.on('did-finish-load', () => {
        addLaunchDesignerFnsToWindow(customerWindow);
        let sources;
        let pendoOptions;


        customerWindow.webContents.send('request-pendo-host');

        ipcMain.once('respond-pendo-host', (event, options) => {
            pendoOptions = options;

            getRemoteSources((remoteSource) => {
                sources = remoteSource;
            }, options.host)
        });

        const ipcMessageBus = (event, message) => {
            switch (message.destination) {
                case sources.designer:
                    if (!designerWindow) return console.warn('Designer window does not exist');
                    sendMessageToBrowserWindow(designerWindow, message);
                    break;
                case sources.plugin:
                case sources.agent:
                    sendMessageToBrowserWindow(customerWindow, message);
            }
        };

        ipcMain.on('pendo-login-designer', (event, options) => {
            if (!designerWindow) return;
            addLoginWindowToDesigner(designerWindow);
        });


        ipcMain.on('pendo-start-designer', (event, options) => {
            if (designerWindow) designerWindow.close();

            const arePluginsLoaded = setInterval(function() {
                customerWindow.webContents.send('request-pendo-host');
            }, 100);

            ipcMain.on('respond-pendo-host', (event, message) => {

                if (!message.arePluginsLoaded) {
                    return addAgentPostMessageScriptToWindow(customerWindow, message.host);
                }

                clearInterval(arePluginsLoaded);

                ipcMain.removeAllListeners('respond-pendo-host');


                bootstrapDesigner(customerWindow, Object.assign({}, pendoOptions, message));
                addLoginWindowToDesigner(designerWindow, pendoOptions);

            });


            ipcMain.once('pendo-electron-version', (event) => {
                event.returnValue = {
                    version
                };
            });

            ipcMain.once('pendo-electron-app-name', (event) => {
                event.returnValue = app.getName();
            });

            ipcMain.on('pendo-designer-message', ipcMessageBus);


        });

    });
}

exports.use = function(app) {

    app.on('browser-window-created', (event, browserWindow) => {
        if (browserWindow.getTitle().indexOf('Pendo') === -1) {
            initPendo(app, browserWindow);
        }
    });

    if (DEV_MODE && REMOTE_HOST) {
        app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
            if (url.match(/localhost:8080/)) {
                event.preventDefault();
                callback(true)
            }
        });
    }

};
