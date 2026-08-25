# Teleprompter

Teleprompter simples, rápido e 100% local. Sem login, sem banco de dados,
sem APIs externas e sem dependências de terceiros — apenas HTML, CSS e
JavaScript puro, servidos por um pequeno servidor Node (usando somente
módulos nativos do Node.js).

Todos os dados (roteiro, velocidade, tamanho de fonte, alinhamento e
espelhamento) ficam salvos apenas no `localStorage` do navegador. Nada é
enviado para nenhum servidor.

## Como rodar

Pré-requisito: [Node.js](https://nodejs.org) instalado (qualquer versão
recente, 16+).

```bash
node server.js
```

O terminal vai mostrar algo como:

```
Teleprompter rodando!

  Local:      http://localhost:3000
  Rede local: http://192.168.0.10:3000

Abra o endereço 'Rede local' no navegador do iPhone
(conectado ao mesmo Wi-Fi) para usar o teleprompter no celular.
```

- No computador: abra `http://localhost:3000`.
- No iPhone (conectado ao **mesmo Wi-Fi** do computador): abra o endereço
  "Rede local" mostrado no terminal (ex.: `http://192.168.0.10:3000`) no
  Safari.

Quer usar outra porta? `PORT=8080 node server.js`.

### Modo câmera + gravação (ler o roteiro com a câmera ligada)

O iOS não permite que uma página web fique sobreposta ao app nativo de
Câmera — não existe overlay entre apps no iPhone. Em vez disso, o próprio
teleprompter pode abrir a câmera do celular como fundo ao vivo, com o
roteiro rolando por cima, e gravar o vídeo direto no navegador.

Para isso, o iPhone exige uma conexão segura HTTPS (ou `localhost`) — câmera
não funciona em `http://` normal na rede local. Para gerar um certificado
autoassinado local (uma vez só):

```bash
./generate-cert.sh
node server.js
```

O terminal vai mostrar endereços `https://...`. Ao abrir pela primeira vez
no iPhone, o Safari vai avisar que o certificado não é confiável — toque em
"Detalhes" (ou "Mostrar detalhes") → "Visitar este site" para continuar.
Isso é esperado (é o seu próprio certificado local, gerado na hora) e só
precisa ser feito uma vez por dispositivo.

Depois disso, ative "Câmera" na tela inicial antes de "Iniciar
teleprompter". Na tela do teleprompter você terá:

- vídeo da câmera ao vivo atrás do roteiro (com uma leve camada escura
  atrás do texto para manter a leitura sempre nítida);
- botão para trocar entre câmera frontal e traseira (⇄);
- botão de gravar/parar (grava vídeo + áudio);
- ao parar, uma tela de revisão com o vídeo gravado e os botões "Salvar
  vídeo" (abre o menu de compartilhar do iPhone para salvar em Fotos/
  Arquivos), "Gravar novamente" e "Sair".

A gravação nunca sai do navegador até você tocar em "Salvar vídeo" — o
arquivo fica só na memória do celular.

### Dica: tela cheia real no iPhone

O Safari do iPhone não permite tela cheia via navegador comum para páginas
web. Para uma experiência mais imersiva (sem a barra de endereço), use
"Compartilhar → Adicionar à Tela de Início" depois de abrir a página — o
app abrirá em modo tela cheia (standalone) a partir do ícone.

## Funcionalidades

- Campo de texto para colar/escrever o roteiro.
- Controle de velocidade da rolagem (1–10).
- Controle de tamanho da fonte (18–96px).
- Alinhamento à esquerda ou centralizado.
- Espelhamento de texto (para rigs com vidro espelhado/beam-splitter).
- Modo câmera: câmera ao vivo atrás do roteiro + gravação de vídeo direto
  no navegador (requer HTTPS local, veja acima).
- Modo teleprompter: fundo preto, texto branco, rolagem automática suave.
- Toque no centro da tela para pausar/retomar.
- Controles discretos (aparecem ao tocar, somem sozinhos): play/pause,
  aumentar/diminuir velocidade, aumentar/diminuir fonte, reiniciar, sair.
- Mantém a tela ligada durante o uso (Wake Lock API, quando suportado).
- Layout mobile-first com áreas seguras do iPhone (notch/home indicator).
- Tudo salvo automaticamente no `localStorage`.

## Estrutura

```
index.html        Estrutura das telas (configuração, teleprompter, revisão)
style.css         Estilos (mobile-first, tema escuro)
app.js            Lógica (scroll automático, controles, câmera, gravação, persistência)
server.js         Servidor estático (Node puro), escuta em 0.0.0.0, HTTP ou HTTPS
generate-cert.sh  Gera o certificado autoassinado usado para servir HTTPS
manifest.json     Metadados para "Adicionar à Tela de Início" no iPhone
```
