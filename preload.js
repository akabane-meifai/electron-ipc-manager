const { contextBridge, ipcRenderer } = require('electron');

const HandlerTypes = {
	GENERATOR: 0,
	FUNCTION: 1
};
const IPCMethods = {
	GET_HANDLERS: 0,
	RUN_HANDLER: 1,
	ITERATOR_NEXT: 2,
	ABORT_ITERATOR: 3
};
const ResultTypes = {
	REJECT: 0,
	RESOLVE: 1
};
class IPCRendererManager{
	constructor(main, renderer){
		Object.assign(this, {
			main: main,
			worldObject: {},
			d: 0,
			p: {}
		});
		const handlers = ipcRenderer.sendSync(main, IPCMethods.GET_HANDLERS);
		for(let i = handlers.length - 1; i >= 0; i--){
			const {name, type} = handlers[i];
			if(type == HandlerTypes.GENERATOR){
				this.worldObject[name] = (...args) => this.sendIterable(i, ...args);
			}else if(type == HandlerTypes.FUNCTION){
				this.worldObject[name] = (...args) => this.send(i, ...args);
			}
		}
		ipcRenderer.on(renderer, (...args) => { this.render(...args); });
	}
	
	send(fn, ...args){
		const pd = this.d++;
		return new Promise((resolve, reject) => {
			this.p[pd] = {resolve, reject, iterator: null};
			ipcRenderer.send(this.main, IPCMethods.RUN_HANDLER, pd, fn, ...args);
		});
	}
	sendIterable(fn, iterator,  ...args){
		const pd = this.d++;
		return new Promise((resolve, reject) => {
			this.p[pd] = {resolve, reject, iterator, iterable: (("next" in iterator) && (typeof iterator.next == "function"))};
			ipcRenderer.send(this.main, IPCMethods.RUN_HANDLER, pd, fn, ...args);
		});
	}
	render(event, pd, code, result = null){
		const promise = this.p;
		let action = "resolve";
		if(code == ResultTypes.REJECT){
			action = "reject";
		}
		if(pd in promise){
			if(promise[pd].iterator != null){
				if(result.done){
					promise[pd][action](result.value);
					delete promise[pd];
				}else{
					const it = {
						next(...args){
							this.args = args;
						},
						args: null
					};
					if(promise[pd].iterable){
						promise[pd].iterator.next([result.value, it, true]);
					}else{
						promise[pd].iterator(result.value, it, true);
					}
					if(it.args){
						ipcRenderer.send(this.main, IPCMethods.ITERATOR_NEXT, pd, it.args);
					}else{
						ipcRenderer.send(this.main, IPCMethods.ABORT_ITERATOR, pd);
						delete promise[pd];
					}
				}
			}else{
				promise[pd][action](result);
				delete promise[pd];
			}
		}
	}
}
const manager = new IPCRendererManager("ipc-main", "ipc-renderer");
contextBridge.exposeInMainWorld("IPCPromise", manager.worldObject);
