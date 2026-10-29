# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-builder

WORKDIR /build

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY index.html metadata.json tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build


FROM nginx:1.27-alpine AS web-runtime

RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /build/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health/live || exit 1

CMD ["nginx", "-g", "daemon off;"]
