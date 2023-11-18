const { app, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isMac = process.platform === 'darwin';
const exeDir = path.dirname(app.getPath("exe"));
let cwd;
if(isMac && exeDir.endsWith('.app/Contents/MacOS')){
	cwd = path.dirname(path.dirname(exeDir));
}else{
	cwd = exeDir;
}
const dataDir = path.join(cwd, "data");
const {uid, gid} = os.userInfo();
const dataDirLength = dataDir.length;
const dirEnv = {
	["%cwd%"]: cwd,
	["%data%"]: dataDir,
	["%asar%"]: __dirname
};
const pathInfo = (arg) => {
	const filename = path.join(...arg.split("/").map(t => (t in dirEnv) ? dirEnv[t] : t));
	let dirname = filename;
	while(dirname.length > dataDirLength){
		dirname = path.dirname(dirname);
	}
	const subdir = (dirname == dataDir);
	const exists = subdir ? fs.existsSync(filename) : false;
	let readable = false;
	let writable = false;
	let executable = false;
	if(exists){
		const {uid: fuid, gid: fgid, mode} = fs.statSync(filename);
		readable = (
			((fuid == uid) && ((mode & fs.constants.S_IRUSR) != 0)) ||
			((fgid == gid) && ((mode & fs.constants.S_IRGRP) != 0)) ||
			(                  (mode & fs.constants.S_IROTH) != 0 )
		);
		writable = (
			((fuid == uid) && ((mode & fs.constants.S_IWUSR) != 0)) ||
			((fgid == gid) && ((mode & fs.constants.S_IWGRP) != 0)) ||
			(                  (mode & fs.constants.S_IWOTH) != 0 )
		);
		executable = (
			((fuid == uid) && ((mode & fs.constants.S_IXUSR) != 0)) ||
			((fgid == gid) && ((mode & fs.constants.S_IXGRP) != 0)) ||
			(                  (mode & fs.constants.S_IXOTH) != 0 )
		);
	}
	return {filename, exists, readable, writable, executable};
};
if(!fs.existsSync(dataDir)){
	fs.mkdirSync(dataDir);
	fs.copyFileSync(path.join(__dirname, "docs", "default.html"), path.join(dataDir, "index.html"));
}


module.exports = {
	*file(filename){
		const info = pathInfo(filename);
		try{
			yield info;
		}catch(ex){}
		return null;
	},
	applicationMenu(template){
		Menu.setApplicationMenu(Menu.buildFromTemplate($(template)));
		function $(menu){
			for(let item of menu){
				if("role" in item){
					if(isMac && (item.role == "quit")){
						item.role = "close";
					}
				}
				if("submenu" in item){
					$(item.submenu);
				}
			}
			return menu;
		}
		return null;
	},
	contextMenu(template){
		return new Promise((resolve, reject) => {
			Menu.buildFromTemplate($(template)).popup({callback: () => { reject(null); }});
			function $(menu){
				for(let item of menu){
					if("click" in item){
						const value = item.click;
						item.click = () => { resolve(value); };
					}
					if("submenu" in item){
						$(item.submenu);
					}
				}
				return menu;
			}
		});
	}
};