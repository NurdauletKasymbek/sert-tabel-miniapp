# Компания табелі Telegram боты

Бұл бот бір жауапты адамға арналған. Қызметкерлер Telegram қолданбайды: жауапты адам қызметкерді таңдап, сол адамның жеке календарінен күндерді белгілейді. Google Calendar қолданылмайды, себебі аккаунтта сервис жабық. Синхрондау Google Sheets арқылы жүреді.

## Негізгі логика

1. `Қызметкерлер` ашылады.
2. Қызметкер таңдалады.
3. `Жеке календарь` басылады.
4. Сол адамның айлық календарінен күн таңдалады.
5. Статус қойылады: жұмыста, жарты күн, жоқ, ауырып қалды, демалыс.
6. `Google Sheets` басқанда Employees, Attendance, Reports парақтарына жазылады.

## Іске қосу

```powershell
Copy-Item bot\.env.example bot\.env
notepad bot\.env
npm run bot
```

Міндетті `.env`:

```env
TELEGRAM_BOT_TOKEN=BotFather_берген_токен
ADMIN_TELEGRAM_IDS=сіздің_telegram_id
BOT_TIMEZONE=Asia/Almaty
```

## Google Sheets қосу

1. Google Cloud Console ішінде Google Sheets API қосыңыз.
2. Service account жасаңыз.
3. JSON key жүктеп, мына жерге қойыңыз:

```text
bot/google-service-account.json
```

4. Google Sheet файлын service account email-іне `Editor` ретінде share етіңіз.
5. Sheet URL ішіндегі ID-ды `.env` ішіне қойыңыз:

```env
GOOGLE_SHEET_ID=sheet_url_ішіндегі_id
GOOGLE_SERVICE_ACCOUNT_JSON=bot/google-service-account.json
AUTO_SYNC_SHEETS=false
```

Тексеру:

```powershell
npm run check:google
```

## Sheets парақтары

Бот өзі 3 парақ жасайды:

- `Employees` — қызметкерлер тізімі
- `Attendance` — күндік белгілер
- `Reports` — айлық есеп

## Қызметкер қосу

```text
Айбек Нұрлан | 15000
```

Жұмыстан шыққан қызметкерді өшірмеңіз, `Архив` басыңыз. Бұрынғы есеп тарихы сақталады.
