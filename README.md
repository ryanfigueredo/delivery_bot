# 🤖 Bot WhatsApp - Tamboril Burguer

Bot conversacional para receber pedidos via WhatsApp.

## 🚀 Como Rodar Localmente

```bash
npm install
npm start
```

## 📱 Funcionalidades

- ✅ Recebe mensagens no WhatsApp
- ✅ Processa pedidos em linguagem natural
- ✅ Fluxo conversacional completo
- ✅ Verifica se loja está aberta
- ✅ Envia pedidos para API: `https://delivery-back-eosin.vercel.app`

## ⚙️ Configuração

1. Execute `npm start`
2. Escaneie QR code no terminal
3. Pronto! Bot funcionando

## 📝 Comandos do Bot

- "oi" / "olá" - Inicia conversa
- "1" / "cardápio" - Ver cardápio
- "quero 2 hamburguer suino" - Pedido rápido
- "voltar" - Volta etapa anterior

## 🚂 Deploy no Railway

### Configuração Automática

O Railway detecta automaticamente:
- **Node.js 20** (via `.nvmrc`)
- **Start Command**: `npm start`
- **Build Command**: `npm ci`

### Variáveis de Ambiente (Railway)

Configure no Railway Dashboard:
- Não precisa de variáveis (URLs estão no código)

### Deploy Manual

1. Conecte o repositório no Railway
2. Railway detecta automaticamente Node.js
3. Deploy automático!

## 📦 Dependências

- `@whiskeysockets/baileys` - WhatsApp Web API
- `pino` - Logger
- `qrcode-terminal` - QR code no terminal

## 🔧 Troubleshooting

### Erro no npm install
- Verifique Node.js 18+ instalado
- Delete `node_modules` e `package-lock.json`
- Execute `npm install` novamente

### Bot não conecta
- Verifique se a sessão `auth_info_baileys` está correta
- Delete a pasta e escaneie QR code novamente
