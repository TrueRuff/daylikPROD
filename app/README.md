# Дейлик (app)

Планировщик задач: направления жизни (Н/Ж/П), таймлайн дня, гибридный разбор ввода (правила → LLM).

## Запуск

```bash
cd app
npm install
npm run dev     # открыть адрес из консоли
npm test        # тесты алгоритмов
npm run build   # production-сборка
```

## LLM-разбор ввода (опционально)

Без настройки ввод разбирается локальными правилами. Для разбора сложных
формулировок через OpenRouter: скопировать `.env.example` в `.env`, вставить
свой ключ (`openrouter.ai → Keys`) и перезапустить `npm run dev`. По умолчанию
стоит роутер `openrouter/free` — сам выбирает свободную модель из бесплатных.

## Развёртывание

**Docker** (web-версия за nginx):

```bash
docker build -t daylik .                      # без ключа LLM (только правила)
docker build --build-arg VITE_OPENROUTER_API_KEY=<ключ> -t daylik .
docker run --rm -p 8080:80 daylik             # http://localhost:8080
# или через compose: docker compose up --build
```

Если Docker Hub недоступен (Беларусь), базовые образы через зеркало:

```bash
docker pull docker.m.daocloud.io/library/node:22-alpine
docker tag  docker.m.daocloud.io/library/node:22-alpine node:22-alpine
docker pull docker.m.daocloud.io/library/nginx:alpine
docker tag  docker.m.daocloud.io/library/nginx:alpine nginx:alpine
```

**GitHub Pages**: workflow `.github/workflows/deploy.yml` (в корне репозитория)
собирает `app/` и публикует при каждом push в main. В настройках репозитория
включить Settings → Pages → Source: GitHub Actions.

**Desktop**: `npm run dist:win` → `release/Daylik Setup <версия>.exe`
(Electron + NSIS). `npm run electron` — запуск без сборки установщика.

## Структура

```
app/
├── index.html            — точка входа браузера
├── public/               — PWA: манифест, service worker, иконки, скриншоты обзора
├── electron/
│   └── main.cjs          — главный процесс Electron
├── Dockerfile, nginx.conf, docker-compose.yml — web-версия в контейнере
├── electron-builder.yml  — сборка установщика Windows (NSIS)
├── src/
│   ├── main.js           — вкладки, экраны, напоминания, язык, service worker
│   ├── styles.css
│   ├── core/             — алгоритмы и данные
│   │   ├── models.js     — Sphere, Task, Practice, PlanBlock
│   │   ├── storage.js    — IndexedDB через Dexie (+ таблица журнала)
│   │   ├── categorize.js — гибридный разбор ввода (правила → LLM)
│   │   ├── dayPlan.js    — таймлайн дня: свободные окна и упаковка дел
│   │   ├── schedule.js   — время и дни недели
│   │   ├── reminders.js  — напоминания (Notifications API)
│   │   ├── serialization.js — экспорт/импорт: JSON и двоичный формат .daylik
│   │   ├── log.js        — журнал событий с уровнями
│   │   └── i18n.js       — локализация ru/en
│   ├── ai/
│   │   └── llmClient.js  — клиент OpenRouter с деградацией на правила
│   └── ui/               — экраны: день (таймлайн), сферы, ввод, журнал
└── tests/                — Vitest
```
