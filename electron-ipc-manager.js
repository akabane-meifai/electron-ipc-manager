const { ipcMain, ipcRenderer } = require("electron");

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

exports.IPCMainManager = class{
	constructor(main, renderer, handlers){
		Object.assign(this, {
			renderer: renderer,
			handlers: [],
			iterators: {}
		});
		const methods = {
			[IPCMethods.GET_HANDLERS]: (event, ...args) => {
				event.returnValue = this.handlers.map(handler => {
					return {type: handler.type, name: handler.name}
				});
			},
			[IPCMethods.RUN_HANDLER]: (event, pd, fn, ...args) => {
				this.handlers[fn].run(event.sender, pd, ...args);
			},
			[IPCMethods.ITERATOR_NEXT]: (event, pd, ...args) => {
				const sender = event.sender;
				const res = this.iterators[pd].next(...args);
				if(res.value instanceof Promise){
					res.value.then(result => {
						sender.send(renderer, pd, ResultTypes.RESOLVE, {value: result, done: res.done});
						if(res.done){
							delete this.iterators[pd];
						}
					}, result => {
						sender.send(renderer, pd, ResultTypes.REJECT, {value: result, done: res.done});
						if(res.done){
							delete this.iterators[pd];
						}
					});
				}else{
					sender.send(renderer, pd, ResultTypes.RESOLVE, res);
					if(res.done){
						delete this.iterators[pd];
					}
				}
			},
			[IPCMethods.ABORT_ITERATOR]: (event, pd, ...args) => {
				const sender = event.sender;
				const res = this.iterators[pd].throw(new Error("abort"));
				if(res.value instanceof Promise){
					res.value.then(result => {
						sender.send(renderer, pd, ResultTypes.RESOLVE, {value: result, done: true});
					}, result => {
						sender.send(renderer, pd, ResultTypes.REJECT, {value: result, done: true});
					});
				}else{
					res.done = true;
					sender.send(renderer, pd, ResultTypes.RESOLVE, res);
				}
				delete this.iterators[pd];
			}
		};
		for(let name in handlers){
			this.addHandler(name, handlers[name]);
		}
		ipcMain.on(main, (event, code, ...args) => {
			if(code in methods){
				methods[code](event, ...args);
			}
		});
	}
	addHandler(name, handler){
		const handlerObject = this.createHandlerObject(name, handler);
		if(handlerObject != null){
			this.handlers.push(handlerObject);
		}
	}
	createHandlerObject(name, handler){
		const objectType = handler.constructor.name;
		if(objectType == "AsyncGeneratorFunction"){
			return {
				type: HandlerTypes.GENERATOR,
				name: name,
				run: (sender, pd, ...args) => {
					this.iterators[pd] = handler(...args);
					this.iterators[pd].next().then(result => {
						sender.send(this.renderer, pd, ResultTypes.RESOLVE, result);
						if(result.done){
							delete this.iterators[pd];
						}
					}, result => {
						sender.send(this.renderer, pd, ResultTypes.REJECT, result);
						if(result.done){
							delete this.iterators[pd];
						}
					});
				}
			};
		}
		if(objectType == "GeneratorFunction"){
			return {
				type: HandlerTypes.GENERATOR,
				name: name,
				run: (sender, pd, ...args) => {
					this.iterators[pd] = handler(...args);
					const res = this.iterators[pd].next();
					if(res.value instanceof Promise){
						res.value.then(result => {
							sender.send(this.renderer, pd, ResultTypes.RESOLVE, {value: result, done: res.done});
							if(result.done){
								delete this.iterators[pd];
							}
						}, result => {
							sender.send(this.renderer, pd, ResultTypes.REJECT, {value: result, done: res.done});
							if(result.done){
								delete this.iterators[pd];
							}
						});
					}else{
						sender.send(this.renderer, pd, ResultTypes.RESOLVE, res);
						if(res.done){
							delete this.iterators[pd];
						}
					}
				}
			};
		}
		if(objectType == "AsyncFunction"){
			return {
				type: HandlerTypes.FUNCTION,
				name: name,
				run: (sender, pd, ...args) => {
					handler(...args).then(result => {
						sender.send(this.renderer, pd, ResultTypes.RESOLVE, result);
					}, result => {
						sender.send(this.renderer, pd, ResultTypes.REJECT, result);
					});
				}
			};
		}
		if(objectType == "Function"){
			return {
				type: HandlerTypes.FUNCTION,
				name: name,
				run: (sender, pd, ...args) => {
					const res = handler(...args);
					if(res instanceof Promise){
						res.then(result => {
							sender.send(this.renderer, pd, ResultTypes.RESOLVE, result);
						}, result => {
							sender.send(this.renderer, pd, ResultTypes.REJECT, result);
						});
					}else{
						sender.send(this.renderer, pd, ResultTypes.RESOLVE, res);
					}
				}
			};
		}
		return null;
	}
};

exports.IPCRendererManager = class{
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
};