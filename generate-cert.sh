#!/bin/sh
# Gera um certificado autoassinado local (válido por 10 anos) para o
# servidor conseguir rodar em HTTPS na rede local. Necessário apenas se
# você quiser usar o modo câmera do teleprompter fora do localhost
# (ex.: acessando do iPhone pelo IP do computador na mesma Wi-Fi).
#
# Requer o comando `openssl` (já vem instalado no macOS e na maioria das
# distribuições Linux; no Windows, use o Git Bash ou o WSL).

set -e
cd "$(dirname "$0")"
mkdir -p certs

openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 3650 -nodes \
  -subj "/CN=localhost"

echo ""
echo "Certificado gerado em certs/key.pem e certs/cert.pem"
echo "Rode 'node server.js' novamente — ele vai detectar o certificado e"
echo "servir automaticamente por HTTPS."
