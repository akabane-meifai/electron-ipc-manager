const { app, BrowserWindow } = require('electron');
const { IPCMainManager } = require('./electron-ipc-manager');
const path = require('path');

app.whenReady().then(() => {
	new IPCMainManager("ipc-main", "ipc-renderer", require('./ipc'));
	const window = new BrowserWindow({
		title: "Application",
		width: 1000,
		height: 800,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			preload: path.join(__dirname, "/preload.js")
		}
	});
	window.loadFile("docs/index.html");
});
