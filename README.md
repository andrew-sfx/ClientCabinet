# Client Cabinet — frontend для технического ревью

React + TypeScript + Vite. Закрытая передача исходников, тестов и минимального набора контрактов/токенов темы.

## Запуск

Node 24.22.1 и npm 11.19.1 (см. .nvmrc и package.json).

```sh
npm ci
npx playwright install chromium --only-shell
npm run check
npm run dev
```

Dev: http://localhost:5173. Нужен именно localhost: origin 127.0.0.1 для API не согласован. Реальные доступы вводятся только в браузере и не сохраняются в файлы. Сборка не требует доступа к аккаунту.

`npm run check` запускает ESLint, unit/contract-тесты, сверку токенов темы, TypeScript, сборку, проверку документов и UI-тесты Chromium (1440/760/390/320 px). UI-транспорт синтетический, внешняя сеть заблокирована. `npm run test:ui` — отдельный UI-прогон. Для браузера можно задать PLAYWRIGHT_BROWSERS_PATH.

`npm run check:api` отдельно сверяет используемый контракт с публичным Swagger; baseline автоматически не обновляется. API по умолчанию: https://api3.soft-fx.com, domainName: client.soft-fx.com. Публичные VITE_API_URL и VITE_DOMAIN_NAME можно задать при запуске/сборке; секреты в VITE-переменные не помещать.

Подробности передачи и ограничения: [REVIEW.md](REVIEW.md).
