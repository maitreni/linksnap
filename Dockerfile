FROM node:20-alpine

WORKDIR /app

# Copie les manifestes en premier (cache layer)
COPY package.json ./

# npm install génère le lock file si absent, npm ci l'exige
RUN npm install --omit=dev

# Copie le reste du code
COPY . .

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "src/server.js"]
