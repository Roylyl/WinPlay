'use strict';
const net = require('node:net');
const dgram = require('node:dgram');
const {findAdapter} = require('./prepare.cjs');

// A private adapter for the disposable receiver process. Every current protocol
// stream takes its sockets from createServer/createSocket in this process.
function endpoint(value, index) {
  if (typeof value !== 'string' || !Number.isSafeInteger(index) || index <= 0) return null;
  const parts = value.toLowerCase().split('%');
  if (parts.length > 2 || (parts.length === 2 && parts[1] !== String(index))) return null;
  if (net.isIP(parts[0]) !== 6 || !/^fe[89ab][0-9a-f]:/.test(parts[0])) return null;
  return new URL('http://[' + parts[0] + ']').hostname.slice(1, -1);
}

async function checkUsb(options, signal) {
  const index = options.ifIndex;
  const local = endpoint(options.local, index);
  const peer = endpoint(options.peer, index);
  const peerSupplied=options.peer!==null && options.peer!==undefined && options.peer!=='';
  if (!local || (peerSupplied && !peer) || local === peer) throw Error('INVALID_USB_ENDPOINTS');
  const adapter=await findAdapter(options.parentInstance,options.controlInterface,signal).catch(error=>{
    if(signal?.aborted)throw error;
    throw Error('USB_NCM_ADAPTER_UNAVAILABLE');
  });
  if(adapter?.ifIndex!==index)throw Error('USB_NCM_ADAPTER_UNAVAILABLE');
  if(endpoint(adapter.local,index)!==local)throw Error('USB_LOCAL_ADDRESS_MISSING');
  return {index, local, peer, address: local+'%'+index, destination: peer ? peer+'%'+index : null};
}

function installScope(scope,onReject=()=>{}) {
  const same = (address, expected) => endpoint(address, scope.index) === expected;
  let announcedPeer,authenticatedPeer;
  const allowedPeer = address => {
    const normalized=endpoint(address,scope.index);
    if(authenticatedPeer) return normalized===authenticatedPeer ? normalized : null;
    return normalized && (normalized===scope.peer || normalized===announcedPeer) ? normalized : null;
  };
  const acceptVerifiedPeer = address => {
    const candidate=endpoint(address,scope.index);
    if(!candidate || candidate===scope.local) return false;
    if(authenticatedPeer) return candidate===authenticatedPeer;
    if(candidate===scope.peer || candidate===announcedPeer) return true;
    if(announcedPeer) return false;
    announcedPeer=candidate;
    return true;
  };
  const acceptAuthenticatedPeer=address=>{
    const candidate=endpoint(address,scope.index);
    if(!candidate || !acceptVerifiedPeer(candidate)) return false;
    authenticatedPeer=candidate;
    return true;
  };
  const rejected = new Set();
  const reject = stage => {if(!rejected.has(stage)){rejected.add(stage);onReject(stage);}};
  const createServer = net.createServer.bind(net), createSocket = dgram.createSocket.bind(dgram);
  function scopedServer(listener,initialControl) {
    const server = createServer(sock => {
      const remote=endpoint(sock.remoteAddress,scope.index);
      // StartSession supplies our control address directly. On a point-to-point
      // USB NCM interface the first pairing connection need not announce DNS-SD.
      // Other servers and all media retain the established peer restriction.
      if (!same(sock.localAddress, scope.local) || !remote || remote===scope.local ||
          (!allowedPeer(remote) && !(initialControl && !announcedPeer && !authenticatedPeer))) {
        reject('usb-tcp-address-mismatch');return sock.destroy();
      }
      listener(sock);
    });
    const listen = server.listen.bind(server);
    server.listen = (options, callback) => {
      if (!options || !Number.isInteger(options.port) || (initialControl && options.port!==17000)) throw Error('UNEXPECTED_TCP_BIND');
      return listen({port: options.port, host:scope.address, ipv6Only:true,exclusive:true},callback);
    };
    return server;
  }
  net.createServer = function(listener) {
    if (typeof listener !== 'function' || arguments.length !== 1) throw Error('UNEXPECTED_SERVER_API');
    return scopedServer(listener,false);
  };
  dgram.createSocket = function(options) {
    const type = typeof options === 'string' ? options : options.type;
    if (arguments.length !== 1 || type !== 'udp6') throw Error('UNEXPECTED_UDP_FAMILY');
    const socket = createSocket({type:'udp6',ipv6Only:true});
    const emit = socket.emit.bind(socket), bind = socket.bind.bind(socket), send = socket.send.bind(socket);
    socket.bind = (options, addressOrCallback, callback) => {
      const port = typeof options === 'number' ? options : options.port;
      if (!Number.isInteger(port)) throw Error('UNEXPECTED_UDP_BIND');
      return bind({port,address:scope.address,exclusive:true},
        typeof addressOrCallback === 'function' ? addressOrCallback : callback);
    };
    socket.emit = function(event,...args) {
      if (event === 'message' && !allowedPeer(args[1]?.address)) {reject('usb-udp-address-mismatch');return false;}
      return emit(event,...args);
    };
    socket.send = function(bytes,port,address) {
      const destination=allowedPeer(address);
      if (arguments.length !== 3 || !destination) throw Error('UNEXPECTED_UDP_DESTINATION');
      // An unbound microphone is deliberately unsupported; timing always binds first.
      socket.address();
      return send(bytes,port,destination+'%'+scope.index);
    };
    return socket;
  };
  return {acceptVerifiedPeer,acceptAuthenticatedPeer,createControlServer:listener=>scopedServer(listener,true)};
}
module.exports = {checkUsb, installScope, endpoint};
