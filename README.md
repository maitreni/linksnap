# ⚡ LinkSnap — Raccourcisseur de liens

## 🚀 Démarrage rapide

### Option 1 : Node.js direct

npm install
cp .env.example .env
# Éditez .env avec vos paramètres
npm start

Ouvrez http://localhost:3000

### Option 2 : Docker (recommandé pour la prod)

docker-compose up -d

### Option 3 : Déploiement sur Railway/Render

1. Pushez sur GitHub
2. Connectez votre repo sur railway.app ou render.com
3. Ajoutez les variables d'environnement depuis .env.example
4. Déployez !

## 📡 API REST

| Méthode | Route             | Description              |
|---------|-------------------|--------------------------|
| POST    | /api/links        | Créer un lien court       |
| GET     | /api/links        | Lister les liens (paginé) |
| GET     | /api/links/:code  | Détail + analytics        |
| DELETE  | /api/links/:code  | Supprimer un lien         |
| GET     | /api/stats        | Statistiques globales     |
| GET     | /:code            | Redirection →             |

### Exemple cURL

# Créer un lien
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -d '{"url":"https://exemple.com/lien-long","alias":"mon-alias"}'

# Lister
curl http://localhost:3000/api/links?page=1&limit=10
