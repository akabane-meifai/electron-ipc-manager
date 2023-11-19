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
			((fuid == uid) && ((mode & 0o400) != 0)) ||
			((fgid == gid) && ((mode & 0o040) != 0)) ||
			(                  (mode & 0o004) != 0 )
		);
		writable = (
			((fuid == uid) && ((mode & 0o200) != 0)) ||
			((fgid == gid) && ((mode & 0o020) != 0)) ||
			(                  (mode & 0o002) != 0 )
		);
		executable = (
			((fuid == uid) && ((mode & 0o100) != 0)) ||
			((fgid == gid) && ((mode & 0o010) != 0)) ||
			(                  (mode & 0o001) != 0 )
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
			const args = yield info;
			if(args.length == 0){
				return null;
			}
			const proc = args.shift();
			if(proc == "read"){
				return (info.readable) ? fs.readFileSync(info.filename, ...args) : null;
			}
			if(proc == "dir"){
				return (info.readable) ? fs.readdirSync(info.filename).map(name => path.join(info.filename, name)) : null;
			}
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
