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
- Modo teleprompter: fundo preto, texto branco, rolagem automática suave.
- Toque no centro da tela para pausar/retomar.
- Controles discretos (aparecem ao tocar, somem sozinhos): play/pause,
  aumentar/diminuir velocidade, aumentar/diminuir fonte, reiniciar, sair.
- Mantém a tela ligada durante o uso (Wake Lock API, quando suportado).
- Layout mobile-first com áreas seguras do iPhone (notch/home indicator).
- Tudo salvo automaticamente no `localStorage`.

## Estrutura

```
index.html    Estrutura das duas telas (configuração e teleprompter)
style.css     Estilos (mobile-first, tema escuro)
app.js        Lógica (scroll automático, controles, persistência)
server.js     Servidor estático (Node puro), escuta em 0.0.0.0
manifest.json Metadados para "Adicionar à Tela de Início" no iPhone
```
