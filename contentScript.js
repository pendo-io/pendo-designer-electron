const {ipcMain, BrowserWindow} = require('electron');

const path = require('path');
const sources = require('./build/sources');

const MESSAGE_SOURCE_CONTENT_SCRIPT = 'pendo-designer-content-script';
let designerWindow;

exports.use = function (app) {
    app.on('browser-window-created', (event, browserWindow) => {
        if (browserWindow.getTitle().indexOf('Pendo') === -1) {
            initPendo(app, browserWindow);
        }
    });
};

function initPendo (app, customerWindow) {
    customerWindow.webContents.on('did-finish-load', () => {
    //    ipcMain.on('start_designer', (event, message) => {
        if (!designerWindow) {
            const pendoDir = __dirname.substring(app.getAppPath().length + 1, __dirname.length);

            customerWindow.webContents.executeJavaScript(`  
                  window.ipcRenderer = require('electron').ipcRenderer;
            const id = 'pendo-designer-plugin-script';
            if (!document.getElementById(id)) {
                const agentPostmessageScript = document.createElement('script');
                agentPostmessageScript.setAttribute('id', id);
                agentPostmessageScript.src = "${pendoDir}/build/plugin.js";
                document.body.appendChild(agentPostmessageScript);
            }     
        `);

            const designerWindowOptions = {
                width: 1070,
                minWidth: 370,
                height: 840,
                title: 'Pendo Designer',
                parent: customerWindow,
                partition: 'persist:pendo'
            };

            designerWindow = new BrowserWindow(designerWindowOptions);
            designerWindow.loadURL(path.join('file://', __dirname, '/designer.html'));

            designerWindow.webContents.openDevTools();

            ipcMain.once('pendo-designer-env', (event, message) => {
                const hostURL = `${message.host}/`;
                const loginViewOptions = {
                    width: 1070,
                    minWidth: 370,
                    height: 840,
                    title: 'Login to Pendo Designer',
                    partition: 'persist:pendo',
                    webPreferences: {
                        nodeIntegration: false
                    }

                };

                const loginWindow = new BrowserWindow(loginViewOptions);
                loginWindow.loadURL(hostURL);
                loginWindow.show();

                let sentToLogin;

                loginWindow.webContents.on('did-navigate', (event, url) => {
                    if (url.indexOf('/login') !== -1) {
                        sentToLogin = true;
                    }

                    if (sentToLogin && url === hostURL) {
                        loginWindow.hide();
                    }
                });

                loginWindow.on('hide', () => {
                    designerWindow.show();
                    loginWindow.close();
                });
            });

            ipcMain.on('pendo-designer-message', (event, message) => {
                if (message.type === 'pendo_agent_settings') {

                }
                switch (message.destination) {
                    case sources.designer:
                        designerWindow.webContents.send('pendo-designer-message', message);
                        break;
                    case sources.plugin:
                    case sources.agent:
                        customerWindow.webContents.send('pendo-designer-message', message);
                }
            });

            function sendMessageToDesigner (message) {
                designerWindow.webContents.send('pendo-designer-message', Object.assign({
                    source: MESSAGE_SOURCE_CONTENT_SCRIPT,
                    destination: 'pendo-designer'
                }, message));
            }

            customerWindow.webContents.send('pendo-designer-message', {
                type: 'connect',
                source: MESSAGE_SOURCE_CONTENT_SCRIPT,
                destination: 'pendo-designer-agent'
            });

            designerWindow.on('close', (event) => {
                sendMessageToDesigner({
                    type: 'unload'
                });
            });
        } else {
            designerWindow.close();
        }
    });
    // });
};

