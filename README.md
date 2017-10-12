## Pendo Designer for Electron Apps ##
**Overview**
 This NPM module for electron will allow you to set up Pendo by tagging pages and features in your app.  It will also allow you to author Pendo guides for your application.  This module is only needed for the setup process, it is not needed for your end users - so it can be installed in just a Dev instance of your application if you wish.
 
**Prerequisites:**
Have `read` access to 
`https://github.com/pendo-io/pendo-designer-electron`


**Installation:**

    npm install --save 'git+ssh://git@github.com:pendo-io/pendo-designer-electron.git'
    
In the main electron file:

    const app = require('electron').app;
    const pendo = require('pendo-electron');
    pendo.use(app);


 After we init pendo, we look for any `BrowserWindow` created event, and append a  `ipcMain` listener to launch and communicate with the Pendo Designer `BrowserWindow`


Example:

    const electron = require('electron');
    const app = electron.app;
    const BrowserWindow = electron.BrowserWindow;

    const pendo = require('pendo-electron'); // <-- Import Pendo Electron module
    pendo.use(app); // <-- Tell your app to use Pendo Designer
    
    let mainWindow;    
    app.on('ready', createWindow);
    
    function createWindow() {
        mainWindow = new BrowserWindow({
	        width: 800,
            height: 600});
    
        mainWindow.loadURL(./index.html);    
    }
*Note:*
This does not currently support using a `BrowserWindow` with     `webPreferences: { nodeIntegration: false }`

Launching The Designer:
You can use this function to launch the designer from any `BrowserWindow` or from the console if you have Dev Tools enabled:
 
    window.pendo.launchDesigner();


**Support**

We would love to hear from you: feedback, question, bugs, you name it. [Drop us a line](mailto:help@pendo.io) and a human will follow up. 

