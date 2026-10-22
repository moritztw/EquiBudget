# Multi-Stage Build for EquiBudget Frontend SPA
# Stage 1: Build Application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy only package.json
COPY ../package.json ./

# Install dependencies cleanly with legacy peer deps
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copy source code and build Vite bundle
COPY ../ .
RUN npm run build

# Stage 2: Production Nginx Server
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx SPA & API reverse proxy configuration
COPY ../nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
