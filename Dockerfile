# Multi-Stage Build for EquiBudget Frontend SPA
# Stage 1: Build Application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy only package.json to prevent lockfile conflicts
COPY package.json ./

# Install dependencies cleanly with legacy peer deps
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copy source code and build Vite bundle
COPY . .
RUN npm run build

# Stage 2: Production Nginx Server
FROM nginx:alpine

# Copy built assets to Nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx configuration with /api reverse proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
