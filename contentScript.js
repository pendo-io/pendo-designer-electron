const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const sources = require('./build/sources');
const version = require('./package.json').version;

const MESSAGE_SOURCE_CONTENT_SCRIPT = 'pendo-designer-content-script';

let designerWindow;
let pendoHost;

function addLaunchDesignerFnToWindow (customerWindow) {
    customerWindow.webContents.executeJavaScript(`
        window.pendo.launchDesigner = (debug) => {
            if(!window.ipcRenderer) {
                window.ipcRenderer = require('electron').ipcRenderer;
            }
            window.ipcRenderer.send('pendo-start-designer', { debug: !!debug });
        };
    `);
}

function addAgentPostMessageScriptToWindow (customerWindow, pendoDir) {
    customerWindow.webContents.executeJavaScript(`
        if(!window.ipcRenderer) {
            window.ipcRenderer = require('electron').ipcRenderer;
        }

        var id = 'pendo-designer-plugin-script';
        if (!document.getElementById(id)) {
            const agentPostmessageScript = document.createElement('script');
            agentPostmessageScript.setAttribute('id', id);
            agentPostmessageScript.src = "${pendoDir}/build/plugin.js";
            document.body.appendChild(agentPostmessageScript);
        }
    `);
}

function addDesignerToCustomerWindow (customerWindow, options) {
    const {height} = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const designerWindowOptions = {
        x: 0,
        y: 0,
        width: 370,
        minWidth: 370,
        maxWidth: 370,
        minHeight: 730,
        height: height,
        title: 'Pendo Designer',
        partition: 'persist:pendo'
    };

    if (options.debug) {
        designerWindowOptions.width = 1070;
    }

    const designerWindow = new BrowserWindow(designerWindowOptions);
    designerWindow.loadURL(path.join('file://', __dirname, '/designer.html'));

    if (options.debug) {
        designerWindow.webContents.openDevTools();
    }
    customerWindow.setPosition(designerWindowOptions.width, customerWindow.getPosition()[1]);
    return designerWindow;
}

function addLoginWindowToDesigner (designerWindow) {
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
    const loginURL = `${pendoHost}/login`;
    const dashboardURL = `${pendoHost}/`;

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

function sendMessageToBrowserWindow (browserWindow, messageObj) {
    browserWindow.webContents.send('pendo-designer-message', messageObj);
}

function initPendo (app, customerWindow) {
    customerWindow.on('close', () => {
        if (designerWindow) {
            designerWindow.close();
        }
    });

    customerWindow.webContents.on('did-finish-load', () => {
        addLaunchDesignerFnToWindow(customerWindow);

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
            if(!designerWindow) return;
            addLoginWindowToDesigner(designerWindow);
        });

        ipcMain.on('pendo-start-designer', (event, options) => {
            if (designerWindow) designerWindow.close();

            const pendoDir = __dirname.substring(app.getAppPath().length + 1, __dirname.length);
            addAgentPostMessageScriptToWindow(customerWindow, pendoDir);

            designerWindow = addDesignerToCustomerWindow(customerWindow, options);

            ipcMain.once('pendo-electron-version', (event)=>{
                event.returnValue = {
                    version
                };
            });

            ipcMain.once('pendo-designer-env', (event, message) => {
                pendoHost = message.host;
                addLoginWindowToDesigner(designerWindow);
            });

            ipcMain.once('pendo-electron-app-name', (event) => {
                event.returnValue = app.getName();
            });

            ipcMain.on('pendo-designer-message', ipcMessageBus);

            sendMessageToBrowserWindow(customerWindow, {
                type: 'connect',
                source: MESSAGE_SOURCE_CONTENT_SCRIPT,
                destination: 'pendo-designer-agent'
            });

            designerWindow.on('close', (event) => {
                sendMessageToBrowserWindow(designerWindow, {
                    type: 'unload',
                    source: MESSAGE_SOURCE_CONTENT_SCRIPT,
                    destination: 'pendo-designer'
                });
            });

            designerWindow.on('closed', (event) => {
                designerWindow = null;
                ipcMain.removeListener('pendo-designer-message', ipcMessageBus);
            });
        });
    });
};

exports.use = function (app) {
    app.on('browser-window-created', (event, browserWindow) => {
        if (browserWindow.getTitle().indexOf('Pendo') === -1) {
            initPendo(app, browserWindow);
        }
    });
};
