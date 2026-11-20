# Дейлик (app)

Планировщик задач: направления жизни (Н/Ж/П), таймлайн дня, гибридный разбор ввода (правила → LLM).

## Запуск

```bash
cd app
npm install
npm run dev     # открыть адрес из консоли
npm test        # тесты алгоритмов
npm run build   # production-сборка
npm run docs    # справочник API из исходников (docs/)
```

## LLM-разбор ввода (опционально)

Без настройки ввод разбирается локальными правилами. Для разбора сложных
формулировок скопировать `.env.example` в `.env` и заполнить:

- `VITE_OPENROUTER_API_KEY` — ключ OpenRouter (`openrouter.ai → Keys`);
- `VITE_LLM_API_URL` — адрес API (по умолчанию OpenRouter; для прямого
  DeepSeek — `https://api.deepseek.com/v1/chat/completions`, модель
  `deepseek-chat`; примеры обоих вариантов в `.env.example`).

По умолчанию стоит роутер `openrouter/free` — сам выбирает свободную
модель из бесплатных. После правки `.env` перезапустить `npm run dev`.
Ключ зашивается в бандл (VITE-) — держать на ключе расходный лимит.

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
├── public/               — PWA: манифест, service worker, иконки, скриншоты онбординга
├── electron/
│   └── main.cjs          — главный процесс Electron
├── Dockerfile, nginx.conf, docker-compose.yml — web-версия в контейнере
├── electron-builder.yml  — сборка установщика Windows (NSIS)
├── src/
│   ├── main.ts           — точка входа: вход, вкладки, экраны, напоминания, язык
│   ├── styles.css
│   ├── core/             — алгоритмы и данные
│   │   ├── models.ts     — Sphere, Task, Practice, PlanBlock
│   │   ├── storage.ts    — IndexedDB через Dexie (владельцы, PBKDF2, журнал)
│   │   ├── categorize.ts — гибридный разбор ввода (правила → LLM)
│   │   ├── dayPlan.ts    — таймлайн дня: свободные окна и упаковка дел
│   │   ├── schedule.ts   — время и дни недели
│   │   ├── recurring.ts  — повторяющиеся дела
│   │   ├── calendarEvents.ts — события месяца для экрана «Календарь»
│   │   ├── analytics.ts  — сводка дня: план/факт/свободно
│   │   ├── ics.ts        — экспорт календаря .ics
│   │   ├── demoData.ts   — демо-набор для новых аккаунтов
│   │   ├── auth.ts       — аккаунты, JWT-сессии, пароли
│   │   ├── reminders.ts  — напоминания (Notifications API)
│   │   ├── serialization.ts — экспорт/импорт: JSON и двоичный формат .daylik
│   │   ├── log.ts        — журнал событий с уровнями
│   │   └── i18n.ts       — локализация ru/en
│   ├── ai/
│   │   └── llmClient.ts  — клиент LLM (OpenRouter/DeepSeek) с деградацией на правила
│   └── ui/               — экраны: день (таймлайн), направления, календарь,
│                          журнал; onboarding.ts (обзор «?»), gesture.ts
│                          (long-press drag, сторожа случайных кликов)
└── tests/                — Vitest, файл на модуль
```
