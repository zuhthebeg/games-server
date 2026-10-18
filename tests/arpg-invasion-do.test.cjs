// Real RoomDO/workerd boundary regression. No REST, BroadcastChannel or fixture relay.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.join(__dirname,'..');
const dependencies=process.env.ARPG_SERVER_DEPS||root;
const esbuild=require(path.join(dependencies,'node_modules/esbuild'));
const {Miniflare}=require(path.join(dependencies,'node_modules/miniflare'));
const script=esbuild.buildSync({entryPoints:[path.join(root,'realtime-poc/src/index.ts')],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,logLevel:'silent'}).outputFiles[0].text;
const registrySource=esbuild.buildSync({entryPoints:[path.join(root,'functions/games/registry.ts')],bundle:true,format:'cjs',platform:'node',write:false,logLevel:'silent'}).outputFiles[0].text;
const registryModule={exports:{}};new Function('module','exports','require',registrySource)(registryModule,registryModule.exports,require);
const {getGame,getDefaultConfig}=registryModule.exports;
assert.equal(getGame('arpg').id,'arpg');assert.equal(getGame('arpg-invasion').id,'arpg-invasion');
assert.notEqual(getGame('arpg'),getGame('arpg-invasion'));
assert.deepEqual(getDefaultConfig('arpg'),{});assert.deepEqual(getDefaultConfig('arpg-invasion'),{invasion:true});
for(const id of ['arpg','arpg-invasion']){assert.equal(getGame(id).relay,true);assert.equal(getGame(id).minPlayers,2);assert.equal(getGame(id).maxPlayers,4);}
function client(socket){socket.accept();const q=[],waiters=[];socket.addEventListener('message',e=>{const d=JSON.parse(e.data),i=waiters.findIndex(w=>w.p(d));if(i<0)q.push(d);else{const w=waiters.splice(i,1)[0];clearTimeout(w.t);w.resolve(d);}});return{send:d=>socket.send(JSON.stringify(d)),close:()=>socket.close(),wait(p,label){const i=q.findIndex(p);if(i>=0)return Promise.resolve(q.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={p,resolve,t:setTimeout(()=>reject(Error('timeout '+label+' messages='+JSON.stringify(q))),2500)};waiters.push(w);});}};}
(async()=>{const mf=new Miniflare({modules:true,script,compatibilityDate:'2025-01-01',durableObjects:{ROOM:{className:'RoomDO',useSQLite:true},COORD:{className:'CoordinatorDO',useSQLite:true}}});const clients=[];try{
 for(const game of ['arpg','arpg-invasion']){const room='regression-'+game;async function connect(uid){const res=await mf.dispatchFetch('http://localhost/room/'+room+'?g='+game+'&u='+uid,{headers:{Upgrade:'websocket'}});assert.equal(res.status,101);const c=client(res.webSocket);clients.push(c);await c.wait(d=>d.type==='connected','connected');return c;}
 const host=await connect('host'),guest=await connect('guest');guest.send({type:'ready',ready:true});await host.wait(d=>d.type==='roster'&&d.players.some(p=>p.user==='guest'&&p.ready),'ready');
 const config={stageId:'S2',threat:1,...(game==='arpg-invasion'?{invasion:true}:{})};host.send({type:'start',config});const started=await host.wait(d=>d.type==='started',game+' started');assert.deepEqual(started.config,config);assert.deepEqual(new Set(started.players),new Set(['host','guest']));await guest.wait(d=>d.type==='started','guest started');
 guest.send({type:'rt',data:{t:'profile',lineage:game==='arpg-invasion'?'skeleton_knight':'human'}});const rt=await host.wait(d=>d.type==='rt','sender bound RT');assert.equal(rt.from,'guest');
 host.send({type:'rt',data:{t:'snapshot',start:{config},tick:1}});assert.equal((await guest.wait(d=>d.type==='rt','snapshot')).from,'host');
 guest.send({type:'leave'});await host.wait(d=>d.type==='roster'&&d.players.length===1,'guest leave');host.send({type:'leave'});console.log('PASS '+game+' create/join/ready/start/sender-bound-RT/leave');}
 }finally{for(const c of clients)c.close();await mf.dispose();}})().catch(e=>{console.error(e);process.exitCode=1;});
