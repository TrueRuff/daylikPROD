# Сборка web-версии: vite build с ключом LLM из build-arg (без ключа — режим только правил)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_OPENROUTER_API_KEY=
ARG VITE_LLM_MODEL=openrouter/free
RUN VITE_OPENROUTER_API_KEY=$VITE_OPENROUTER_API_KEY VITE_LLM_MODEL=$VITE_LLM_MODEL npm run build

# Раздача статики nginx'ом: SPA-роутинг, правильный MIME для манифеста, кэширование
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
