# Сейчас в Photoshop 2026 (пошагово)

Photoshop уже установлен. Делайте **из меню PS**, не через автomation снаружи.

## 0. Подключить сценарии (один раз)

1. **Файл → Сценарии → Обзор…**
2. Папка: `/Users/maxim/MP_Eingener/pixmuse/doc/photoshop`
3. В списке появятся `ElizPilotSmokeTest.jsx`, `ElizFrequencySetup.jsx`, …

## A. Smoke — частотка без экшена Лизы (~2 мин)

1. **Файл → Сценарии → ElizPilotSmokeTest.jsx** → OK в диалогах.
2. **Файл → Сценарии → ElizFrequencySetup.jsx**.
3. **Тест 2:** глаз у группы **«частотка»** on/off; сравнить со слоем **«исходник (сравнение)»**.
4. Если ошибка «Apply Image» — напишите текст; см. раздел «Если частотка упала» ниже.

## B. Тест 1 — CR3 + экшен Лизы

1. **Файл → Открыть** → `/Users/maxim/MP_Eingener/pixmuse/doc/TSV_0035.cr3`
2. Camera Raw → **Open** (16 bit, как у Лизы).
3. Панель **Операции** → **её экшен** (имена пока вписать в `ElizBatchColorButton.jsx` для пакета).
4. Сравнить с `doc/до после.psb` (слой «после»).
5. Свести слои → выделить итоговый слой → **ElizFrequencySetup.jsx**.
6. Закрыть **без сохранения** (CR3 на диске не меняется).

## C. Тест 3 — пакет 3 CR3

Папка уже есть: `doc/pilot_girl1/` (0035, 0044, 0047).

1. В `ElizBatchColorButton.jsx` — **ACTION_SET** / **ACTION_NAME** с панели Лизы.
2. **Сценарии → ElizBatchColorButton.jsx** → выбрать `pilot_girl1`.
3. Проверить `pilot_girl1/_after_button/*.psd` и `batch.log`.

---

## Если частотка упала на Apply Image

Вручную для слоя **High** (копия исходника):

| Глубина | Apply Image |
|---------|-------------|
| **16 bit** | Add, **Invert** ✓, Scale **2**, Offset **0**, Source = **Low** |
| **8 bit** | Subtract, Scale **2**, Offset **128**, Source = **Low** |

Режим слоя High: **Linear Light**, **100%**. Low — blur **7 px**.

Лог (если запускали сценарий): `/tmp/eliz_frequency.log`

---

## Готовые пути

| Что | Путь |
|-----|------|
| CR3 тест | `doc/TSV_0035.cr3` |
| Пилот-папка | `doc/pilot_girl1/` |
| Эталон | `doc/до после.psb` |
| Сценарии | `doc/photoshop/` |

После A/B/C — возвращаемся к Pixmuse (пятна на коже). Успешный пилот **не** = вся ретушь автоматизирована.
