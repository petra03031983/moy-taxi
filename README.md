# Мой Такси

Next.js-приложение для заказа такси и панели одного водителя.

## Запуск

```bash
npm install
npm run dev
```

## Переменные окружения

- `NEXT_PUBLIC_SUPABASE_URL` — URL проекта Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — публичный anon JWT для вызова Edge Function.

Публичная форма заказа: `/`
Панель водителя: `/driver`

Vercel развёртывает приложение из ветки `main` этого репозитория.