# 🤖 Bot WhatsApp - Tamboril Burguer

Bot conversacional para receber pedidos via WhatsApp.

## 🚀 Como Rodar

```bash
npm install
npm start
```

## 📱 Funcionalidades

- ✅ Recebe mensagens no WhatsApp
- ✅ Processa pedidos em linguagem natural
- ✅ Fluxo conversacional completo
- ✅ Verifica se loja está aberta
- ✅ Envia pedidos para API

## ⚙️ Configuração

1. Configure `WEBHOOK_URL` no código
2. Execute `npm start`
3. Escaneie QR code no terminal
4. Pronto! Bot funcionando

## 📝 Comandos do Bot

- "oi" / "olá" - Inicia conversa
- "1" / "cardápio" - Ver cardápio
- "quero 2 hamburguer suino" - Pedido rápido
- "voltar" - Volta etapa anterior

## 🔄 Deploy

### Railway
```bash
railway up
```

### Heroku
```bash
git push heroku main
```

### Servidor Próprio
```bash
pm2 start bot-conversacional.js --name tamboril-bot
```

## 📦 Dependências

- `@whiskeysockets/baileys` - WhatsApp Web API
- `node-fetch` - HTTP requests
- `qrcode-terminal` - QR code no terminal
