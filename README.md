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
- Apenas o botão de play/pausa pausa ou retoma a leitura. Tocar no texto apenas mostra os controles.
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
mp4remux.js       Converte o MP4 "fragmentado" do Safari em MP4 clássico (compatível com editores)
server.js         Servidor estático (Node puro), escuta em 0.0.0.0, HTTP ou HTTPS
generate-cert.sh  Gera o certificado autoassinado usado para servir HTTPS
manifest.json     Metadados para "Adicionar à Tela de Início" no iPhone
```

## Revisão de confiabilidade e leitura

- A gravação original é preservada; a conversão MP4 para editores é opcional.
- O último take concluído é guardado no IndexedDB do mesmo navegador/origem.
  Use **Recuperar última gravação**. Não substitui salvar o vídeo: limpeza de
  dados, falta de espaço ou encerramento antes de concluir o take podem impedir recuperação.
- Velocidade de 0,25 a 20 (4–320 px/s), fonte de 16 a 120 px e ajustes durante a leitura.
- Tocar ou arrastar o texto mantém o estado de reprodução. Após soltar o arrasto, a rolagem continua da nova posição; se estava pausada, permanece pausada.
- Largura, altura inicial e entrelinha ajustáveis para aproximar a leitura da lente.
- Câmera abre com leitura pausada. Gravar inicia a rolagem.
- 1080p/30 com bitrate solicitado de 12 Mbps ou 720p/30 com 6 Mbps;
  o navegador pode negociar outros valores. Áudio solicitado a 192 kbps.
- Áudio natural ou com redução de ruído, medidor de microfone e bloqueio de
  gravação quando uma faixa de áudio/vídeo não está disponível.
- Ao ocultar o aplicativo durante gravação, o take é encerrado para revisão.
- Servidor local permite somente os arquivos públicos do aplicativo.

As mudanças reduzem riscos, mas não diagnosticam um arquivo já corrompido.
Valide um take no aparelho e no editor usado antes de uma gravação importante.
Referências: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
 e https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event
