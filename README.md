# pendo-designer-electron
## Pendo Designer for Electron Apps ##
**Prerequisites:**
Have `read` access to 
`https://github.com/pendo-io/pendo-designer-electron`


**Installation:**

    npm install --save 'git+ssh://git@github.com:pendo-io/pendo-designer-electron.git'
    
In the main electrion file:


 

    const electron = require('electron');
    const app = electron.app;
    const BrowserWindow = electron.BrowserWindow;
    const ipcMain = electron.ipcMain;
    
    const path = require('path');
    const url = require('url');
    const pendo = require('pendo-electron');
    
    
    let mainWindow;
    
    app.on('ready', createWindow);
    pendo.use(app);
    
    function createWindow() {
        mainWindow = new BrowserWindow({
	        width: 800,
            height: 600});
    
        mainWindow.loadURL('http://site.com');
    
    }
*Note:*
This does not currently support using a `BrowserWindow` with 

    webPreferences: { nodeIntegration: false }

Launching The Designer:
Via the Console:

    window.pendo.launchDesigner();

> Written with [StackEdit](https://stackedit.io/).
