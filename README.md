# status-page

Страница статуса сервисов в стиле status.github.com, которая работает **без сервера и без базы данных**:

- **GitHub Actions** каждые 15 минут проверяет сайты из `sites.json`;
- результаты коммитятся в репозиторий (`site/data/history.json`): **git и есть база данных**;
- **GitHub Pages** раздаёт статическую страницу с аптаймом, временем ответа и историей.

Демо с тестовыми данными: открыть страницу с параметром `?demo`.

## Как это работает

```
 ┌──────────────── GitHub Actions (cron */15) ────────────────┐
 │                                                            │
 │  check job                         deploy job              │
 │  ─────────                         ──────────              │
 │  node scripts/check.mjs   ──►      upload site/  ──►  Pages│
 │  git commit history.json                                   │
 └────────────────────────────────────────────────────────────┘
                                                │
                       браузер ◄── index.html + app.js читают history.json
```

| Что | Где |
|---|---|
| Список сайтов | `sites.json` |
| Проверка (fetch, таймаут 10 с, код и время ответа) | `scripts/check.mjs` |
| Пайплайн: проверка → коммит → деплой | `.github/workflows/uptime.yml` |
| Фронтенд (чистый HTML/CSS/JS, без фреймворков) | `site/` |
| Генератор демо-данных | `scripts/demo.mjs` |

Статусы:
- 🟢 **up**: ответ с кодом < 400;
- 🟡 **degraded**: ответ медленнее 1500 мс;
- 🔴 **down**: ошибка, таймаут или код ≥ 400.

## Запуск локально

Нужен Node.js 18+. Зависимостей нет.

```bash
npm run check   # проверить сайты и дописать историю
npm run demo    # сгенерировать демо-данные
npm start       # открыть http://localhost:8080 (или /?demo)
```

## Деплой на GitHub

1. Создать репозиторий на GitHub и запушить код.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Actions → General → Workflow permissions: Read and write**.
4. **Actions → Uptime check & deploy → Run workflow**, чтобы не ждать первого крона.

Свои сайты добавляются в `sites.json`.

## Стек

GitHub Actions · GitHub Pages · Node.js · vanilla JS · CSS (тёмная тема по системной настройке)

## Идеи для развития

- [ ] Алерты в Telegram при падении сервиса
- [ ] Проверка SSL-сертификата и срока его действия
- [ ] Страница инцидентов из GitHub Issues
- [ ] Badge с аптаймом для README других проектов
