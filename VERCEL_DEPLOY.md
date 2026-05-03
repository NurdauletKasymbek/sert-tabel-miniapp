# Vercel арқылы Telegram Mini App шығару

## 1. Vercel-ге project қосу

1. https://vercel.com ашыңыз.
2. GitHub арқылы кіріңіз.
3. Осы жобаны GitHub-қа жүктеңіз.
4. Vercel ішінде `Add New Project` басып, осы repo-ны таңдаңыз.

Vercel settings:

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

## 2. Environment Variables

Vercel project -> `Settings` -> `Environment Variables`.

Мыналарды қосыңыз:

```env
GOOGLE_SHEET_ID=сіздің_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
BOT_TIMEZONE=Asia/Almaty
```

Маңызды: `GOOGLE_PRIVATE_KEY` мәнін JSON ішінен алыңыз. Егер Vercel-де көп жолды private key қиын болса, `\n` таңбалары бар бір жол қылып қойыңыз.

## 3. Deploy

Vercel `Deploy` басқаннан кейін сізге URL береді:

```text
https://your-project.vercel.app
```

Осы URL Mini App URL болады.

## 4. BotFather-де Mini App URL қою

Telegram-да `@BotFather`:

```text
/mybots
```

Ботыңызды таңдаңыз:

```text
Bot Settings -> Menu Button -> Configure menu button
```

URL ретінде Vercel URL қойыңыз:

```text
https://your-project.vercel.app
```

Button text:

```text
Табель ашу
```

## 5. Bot .env

Егер Telegram боттағы `/start` ішінде де Mini App кнопкасы шықсын десеңіз, сервердегі немесе локалдағы `bot/.env` ішіне:

```env
MINI_APP_URL=https://your-project.vercel.app
```

сосын ботты қайта қосыңыз.

## 6. Google Sheets құрылымы

Vercel API Google Sheets-ті база ретінде қолданады. Парақтар:

- `Employees`
- `Attendance`
- `Summary`

Mini App-та адам қоссаңыз немесе статус қойсаңыз, осы парақтарға жазылады.
