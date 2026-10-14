const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const dgram = require("node:dgram");
const dns = require("node:dns");
const { syncBuiltinESMExports } = require("node:module");
const deny = () => { throw new Error("Offline migration generation forbids network access"); };
net.Socket.prototype.connect = deny;
net.connect = deny;
net.createConnection = deny;
tls.connect = deny;
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
http2.connect = deny;
dgram.Socket.prototype.send = deny;
for (const name of Object.keys(dns)) {
  if (typeof dns[name] === "function" && /^(lookup|resolve|reverse)/.test(name)) dns[name] = deny;
}
for (const name of Object.keys(dns.promises)) {
  if (typeof dns.promises[name] === "function") dns.promises[name] = deny;
}
globalThis.fetch = deny;
syncBuiltinESMExports();
