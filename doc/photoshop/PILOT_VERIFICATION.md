# Отчёт проверки скриптов (статический + логика пилота)

Дата: 28.10.2026. **Photoshop не запускался** — выводы по коду, статике batch и **офлайн-математике** (`doc/tools/verify_frequency_math.py`). Финальное «как у Лизы в PS» — только после прогона в Photoshop.

### Офлайн без Photoshop

```bash
python3 -m venv doc/tools/.venv
doc/tools/.venv/bin/pip install numpy opencv-python-headless
doc/tools/.venv/bin/python doc/tools/verify_frequency_math.py
```

- **8-bit формула** (Subtract + Linear Light 100%): на синтетике и `doc/previews/TSV_*.jpg` **maxΔ = 0** (идеальная реконструкция при той же blur-модели).
- **16-bit формула** (Add+Invert): та же проверка на симulated 16-bit — **maxΔ = 0** в модели; **не** гарантирует charID `AppI` в ExtendScript.
- **Batch JSX**: grep-проверки (DONOTSAVECHANGES, `_after_button`, log, skip, doAction).
- **Не заменяет PS:** экшен Лизы, ACR/CR3, бит-точный Gaussian Blur Adobe, `до после.psb`.

---

## 1. `ElizFrequencySetup.jsx`

| Критерий | Статус | Комментарий |
|----------|--------|-------------|
| Радиус **7** | OK | `RADIUS = 7`, Gaussian Blur в px |
| **16 bit** | OK* | Apply Image **Add**, **Invert**, Scale **2**, Offset **0**; *визуально на CR3 после ACR |
| **8 bit** | OK* | Apply Image **Subtract**, Scale **2**, Offset **128** |
| Режим / глубина | OK | Отказ: не RGB, 32-bit, indexed; CMYK/Grayscale с сообщением |
| Оригинал | OK | Фильтры только на **дубликатах**; активный слой переименован в «исходник (сравнение)», **пиксели не трогаются** |
| Совпадение без кисти | OK* | Low + High, **Linear Light 100%**, группа 100%; сравнение: группа ↔ слой «исходник (сравнение)» |
| Проверка у оператора | — | **Тест 2** в `PILOT_RUNBOOK.md` |

**Не дублирует экшен Лизы:** частотка у неё **после** слияния кнопки; экшен кнопки создаёт «цвет тела» / «фон», не группу «частотka».

**Риск:** если `Apply Image` упадёт на версии PS (редко), скрипт прервётся — тогда частотку делать её ручным экшеном с «семёркой».

---

## 2. `ElizBatchColorButton.jsx`

| Критерий | Статус | Комментарий |
|----------|--------|-------------|
| CR3 не изменяется | OK | `open` → работа в памяти → `close(SaveOptions.DONOTSAVECHANGES)` — файл на диске не перезаписывается |
| Отдельное сохранение | OK | Только `папка/_after_button/ИМЯ.psd` |
| Конфликт имён | OK | Если `.psd` уже есть — **SKIP**, запись в log |
| Ошибки | OK | try/catch, log в `batch.log`, опция `STOP_ON_ERROR` |
| Пилот | OK | `PILOT_MODE=true`, `PILOT_MAX=5`, confirm если файлов больше |
| Не трогать `_after_button` | OK | Файлы из этой подпапки не берутся как исходники |
| Заглушки ACTION | OK | confirm, если имена не заменены |

**Не дублирует экшен:** скрипт вызывает **только** `app.doAction(ACTION_NAME, ACTION_SET)`. **`ElizCatalogColorStack.jsx` в пакете не вызывается.**

**Риски (ручная проверка):**

- ACR при открытии CR3 может показать диалог — для пилота лучше `displayDialogs = NO` уже стоит; профиль ACR должен быть как у Лизы.
- `.psd` из пилота **не** класть в ту же папку как исходник для повторного прогона (будет skip или путаница).

---

## 3. `ElizCatalogColorStack.jsx` — не использовать вместе с кнопкой

| | Экшен Лизы | CatalogColorStack |
|--|------------|-------------------|
| фон + desaturate + curves | да | да (те же цифры из PSB) |
| цвет тела | да | да (частично; выборочная/HSL reds в JSX неполные) |

**Правило:** есть рабочая кнопка → **только экшен**. CatalogColorStack — резерв, если экшена нет на этом Mac.

---

## 4. Вторая модель

- В batch: `MODEL_PROFILE = "girl2"` → **confirm** перед стартом.
- **Не** гонять girl2 с `ACTION_NAME` от girl1 без отдельного PSB/экшена.
- Тестовые CR3 в `doc/` — **смешанные**; для пилота girl1 выбрать кадры блондинки в бежевом (сверка с `до после.psb`), girl2 — отдельный прогон после пресета.

---

## 5. План тестового запуска (без всей съёмки)

### A. Один кадр `TSV_0035.cr3`

1. Открыть CR3 (ACR как у Лизы → Open).
2. **Только** экшен Лизы (или один раз вручную, без CatalogColorStack).
3. Сравнить с `doc/до после.psb` (слой «после»), 100% на коже и фоне.
4. Слить, как она делает → **Файл → Сценарии → `ElizFrequencySetup.jsx`** → проверка группы on/off.
5. **Не** сохранять поверх CR3; PSD только в `_after_button` при пакете.

### B. Пилот 3–5 файлов

1. Создать `doc/pilot_girl1/` и положить **только** 3–5 CR3 **одной** модели (напр. `TSV_0035`, `0044`, `0047`…).
2. В `ElizBatchColorButton.jsx`: имена ACTION, `PILOT_MODE=true`, `PILOT_MAX=5`, `MODEL_PROFILE="girl1"`.
3. Запустить скрипт, выбрать `pilot_girl1`.
4. Проверить `_after_button/*.psd` + `batch.log`.
5. 1–2 кадра довести по `CHECKLIST_LIZA.md` — оценка минут/кадр.

### C. Girl2

Только после отдельного ACTION/PSB — отдельная папка, `MODEL_PROFILE="girl2"`, confirm.

---

## 6. Что не делали

- Не запускали весь заказ.
- Не делали git push.
- Не вызывали Polza / Pixmuse.

---

## 7. Инструкция запуска (кратко)

См. **`PILOT_RUNBOOK.md`**.
