/*
  2022-09-19

  The author disclaims copyright to this source code.  In place of a
  legal notice, here is a blessing:

  *   May you do good and not evil.
  *   May you find forgiveness for yourself and forgive others.
  *   May you share freely, never taking more than you give.

  ***********************************************************************

  A basic demonstration of the SQLite3 "OO#1" API.
*/
"use strict";
(function () {
    /**
     Set up our output channel differently depending
     on whether we are running in a worker thread or
     the main (UI) thread.
  */
    let logHtml;
    if (globalThis.window === globalThis /* UI thread */) {
        console.log("Running demo from main UI thread.");
        logHtml = function (cssClass, ...args) {
            const ln = document.createElement("div");
            if (cssClass) ln.classList.add(cssClass);
            ln.append(document.createTextNode(args.join(" ")));
            document.body.append(ln);
        };
    } else {
        /* Worker thread */
        console.log("Running demo from Worker thread.");
        logHtml = function (cssClass, ...args) {
            postMessage({
                type: "log",
                payload: { cssClass, args },
            });
        };
    }
    const dstyle = {};
    onmessage = (e) => {
        console.log("Worker: Message received from main script#: " + e);
        console.log("Worker: Data received from main script#: " + e.data);
        console.log("Worker: Posting message back to main script");
        //  addEntry(e.data);
				if(db){
        if (e.data.startsWith(".init: ")) {
            db.exec({
                sql: "PRAGMA table_info(" + e.data.substring(7) + ");",
                rowMode: "array", // 'array' (default), 'object', or 'stmt'
                callback: function (row) {
                    ++this.counter;
                    logHtml("init", row[1]);
                }.bind({ counter: 0 }),
            });
						logHtml("init", "*ALL");
					/*		dbass.exec({
								sql: "SELECT data from audio where title='កក.ogg';",
								rowMode: 'object',
								callback: function(row){
									log("row ",++this.counter,"=",JSON.stringify(row.data) + "\n" + typeof(row));
									sendAudio(row.data);
								}.bind({counter: 0})
							});*/
				} else if(e.data.startsWith(".addmedia: ") && dbass){
						let [id, media] = e.data.substring(11).split("@");
						console.log("AUDIO: " + id + " media: " + media);
						dbass.exec({
							sql: "SELECT data from audio where title='" + media + "';",
							rowMode: 'object',
							callback: function(row){
								sendAudio(id, row.data);
							}.bind({counter: 0})
						});
        } else {
            console.log("Worker:" + e.data);
            const lopokup = e.data.match(/SELECT (.*) FROM/)[1].split(", ");
            const que = ("^" + e.data.match(/LIKE '([^\x27]*)' /)[1] + "$").replace(/\^%+/, "").replace(/%+\$/, "").replaceAll("_", ".").replaceAll(/‘/g, "'");
            console.log("query!: " + que);
            const quer = new RegExp(que, "mgi");
            console.log(quer);
            console.log(lopokup);
						let counter = 0;
            db.exec({
                sql: e.data.replaceAll(/‘‘*/g, "''"),
                rowMode: "array", // 'array' (default), 'object', or 'stmt'
                callback: function (row) {
                    ++this.counter;
										++counter;
                    let res = "";
                    for (let i = 0; i < row.length; ++i) {
                        if (row[i]) {
														let temp = row[i].toString();
                            let sty = dstyle[lopokup[i]];
														if(sty){
															if(sty.match("#####")){
																res += sty.replaceAll("#####", temp);
															} else{
																if(que != "" && que != "."){
																	res += sty.replaceAll("###", temp.replace(quer, '<mark>$&</mark>'));
																}else
																	res += sty.replaceAll("###", temp);
															}
														}else{
                                res += temp + "<br />";
                            }
                        }
                    }
                    addEntry("" + res + "");

									//addEntry(row.join('</div><div class="col">'));
                }.bind({ counter: 0 }),
            });
            logHtml("results", "" + counter);
        }
		}
		else if(e.data.startsWith("param: ")){
			log("Loading and initializing sqlite3 module...");
			/*worker thread*/ /*
			If sqlite3.js is in a directory other than this script, in order
			to get sqlite3.js to resolve sqlite3.wasm properly, we have to
			explicitly tell it where sqlite3.js is being loaded from. We do
			that by passing the `sqlite3.dir=theDirName` URL argument to
			_this_ script. That URL argument will be seen by the JS/WASM
			loader and it will adjust the sqlite3.wasm path accordingly. If
			sqlite3.js/.wasm are in the same directory as this script then
			that's not needed.

			URL arguments passed as part of the filename via importScripts()
			are simply lost, and such scripts see the globalThis.location of
			_this_ script.
		*/
			let sqlite3Js = "sqlite3.js";
			const urlParams = new URLSearchParams(e.data.substr(7));
			console.log(e.data.substr(7));
			if (urlParams.has("sqlite3.dir")) {
					sqlite3Js = urlParams.get("sqlite3.dir") + "/" + sqlite3Js;
					log("sqlite3: " + sqlite3Js);
			}
			importScripts(sqlite3Js);
			globalThis
					.sqlite3InitModule({
							/* We can redirect any stdout/stderr from the module like so, but
				 note that doing so makes use of Emscripten-isms, not
				 well-defined sqlite APIs. */
							print: log,
							printErr: error,
					})
					.then(function (sqlite3) {
							//console.log('sqlite3 =',sqlite3);
							console.log("Done initializing...");
							log("URL PARAMS: " + urlParams);
							const dburl = urlParams.get("db");
							console.log("db: " + dburl);
							if (!urlParams.has("db")){
								log("No database!");
							}
							else{
								try {
										demo1(sqlite3, dburl, false, true);
								} catch (e) {
										error("Exception:", e.message);
								}
							}
							if (urlParams.has("dbass")) {
								try {
										initassets(sqlite3, urlParams.get("dbass"));
								} catch (e) {
										error("Exception:", e.message);
								}
							}
					});
			}
    };

    const log = (...args) => logHtml("", ...args);
    const addEntry = (...args) => logHtml("entry", ...args);
    const sendAudio = (...args) => logHtml("audio", ...args);
    const warn = (...args) => logHtml("bg-warning", ...args);
    const error = (...args) => logHtml("bd-error", ...args);
    var db = null;
    var dbass = null;
    const demo1 = function (sqlite3, dbUrl, immutable = false) {
				fetch(dbUrl)
            .then((res) => res.arrayBuffer())
            .then((arrayBuffer) => {
                if (!immutable) {
                    arrayBuffer.resizeable = true;
                }
								console.log("TRYING!!!");
                const p = sqlite3.wasm.allocFromTypedArray(arrayBuffer);
                db = new sqlite3.oo1.DB();
                let deserialize_flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE;
                if (!immutable) {
                    deserialize_flags |= sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
                }
                const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, "main", p, arrayBuffer.byteLength, arrayBuffer.byteLength, deserialize_flags);
                db.checkRc(rc);
								
								try{
								db.exec({
										sql: "SELECT name FROM sqlite_master WHERE type='table' order by name asc;",
										rowMode: "array", // 'array' (default), 'object', or 'stmt'
										callback: function (row) {
											 if(row[0] == "_config"){
												 db.exec({
													sql: "select * from _config;",
													rowMode: "array", // 'array' (default), 'object', or 'stmt'
													callback: function (cow) {
															++this.counter;
															dstyle[cow[0]] = cow[1];
													}.bind({ counter: 0 }),
												});
											 }else{
											 logHtml("dictlist", row);
											 db.exec({
												sql: "PRAGMA table_info(" + row + ");",
												rowMode: "array", // 'array' (default), 'object', or 'stmt'
												callback: function (cow) {
														++this.counter;
														logHtml("init2", cow[1]);
												}.bind({ counter: 0 }),
										});
										}
										}.bind({ counter: 0 }),
								});

									logHtml("refresh", "");
                //        xplorer.setDb(db);
						}catch(e){
							error("ERROR: " + e.message);
						}
            });
    };
    const initassets = function (sqlite3, dbUrl, immutable = false) {
        fetch(dbUrl)
            .then((res) => res.arrayBuffer())
            .then((arrayBuffer) => {
                if (!immutable) {
                    arrayBuffer.resizeable = true;
                }
                const p = sqlite3.wasm.allocFromTypedArray(arrayBuffer);
                dbass = new sqlite3.oo1.DB();
                let deserialize_flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE;
                if (!immutable) {
                    deserialize_flags |= sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
                }
                const rc = sqlite3.capi.sqlite3_deserialize(dbass.pointer, "main", p, arrayBuffer.byteLength, arrayBuffer.byteLength, deserialize_flags);
                dbass.checkRc(rc);

									logHtml("refresh", "");
                //        xplorer.setDb(db);
            });
    };



})();
