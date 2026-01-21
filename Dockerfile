FROM node:20-alpine

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código
COPY . .

# Criar diretório para sessão WhatsApp
RUN mkdir -p auth_info_baileys

# Expor porta (se necessário)
EXPOSE 3000

# Comando de start
CMD ["npm", "start"]
