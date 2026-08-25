// Servidor estático simples, sem dependências externas (usa apenas módulos
// nativos do Node.js), para servir o Teleprompter localmente e na rede Wi-Fi.
//
// Se encontrar um certificado em certs/key.pem e certs/cert.pem, serve por
// HTTPS (necessário para o recurso de câmera funcionar no iPhone, já que o
// iOS só libera getUserMedia em contexto seguro). Sem certificado, cai para
// HTTP normal — tudo funciona, exceto o modo câmera fora do localhost.
// Veja generate-cert.sh / README.md para gerar o certificado.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const ROOT = __dirname;
const KEY_PATH = path.join(ROOT, "certs", "key.pem");
const CERT_PATH = path.join(ROOT, "certs", "cert.pem");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function getLocalNetworkIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function requestHandler(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Evita path traversal — restringe a resolução ao diretório do projeto.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Não encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const hasCert = fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH);
const scheme = hasCert ? "https" : "http";
const server = hasCert
  ? https.createServer({ key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) }, requestHandler)
  : http.createServer(requestHandler);

server.listen(PORT, HOST, () => {
  const ips = getLocalNetworkIps();
  console.log("");
  console.log("Teleprompter rodando!" + (hasCert ? " (HTTPS)" : ""));
  console.log("");
  console.log(`  Local:      ${scheme}://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`  Rede local: ${scheme}://${ip}:${PORT}`);
  });
  console.log("");
  console.log("Abra o endereço 'Rede local' no navegador do iPhone");
  console.log("(conectado ao mesmo Wi-Fi) para usar o teleprompter no celular.");
  console.log("");
  if (!hasCert) {
    console.log("Modo câmera: nenhum certificado encontrado em certs/.");
    console.log("A câmera só funciona em HTTPS (ou localhost) — rode ./generate-cert.sh");
    console.log("e reinicie o servidor para gravar vídeo direto do teleprompter.");
    console.log("");
  } else {
    console.log("Ao abrir no iPhone, o Safari vai avisar que o certificado não é");
    console.log("confiável — toque em 'Detalhes' > 'Visitar este site' para continuar.");
    console.log("");
  }
});
