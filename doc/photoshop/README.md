# Photoshop: скрипты для заказа Лизы

## Установка

1. Photoshop → **Файл → Сценарии → Обзор…**
2. Укажи папку `doc/photoshop` из проекта (или скопируй `.jsx` в `Presets/Scripts` Photoshop).
3. Скрипты появятся в **Файл → Сценарии**.

## Файлы

| Скрипт | Когда |
|--------|--------|
| `ElizCatalogColorStack.jsx` | Резерв: создать группы «фон!» и «цвет тела» с цифрами из PSB, если кнопки нет |
| `ElizFrequencySetup.jsx` | **После** слияния слоёв кнопки — группа «частотка», blur **7** |
| `ElizBatchColorButton.jsx` | Пакет CR3 → **её экшен** → PSD в `_after_button` |

## Пакетная обработка

1. В `ElizBatchColorButton.jsx` пропиши **ACTION_SET** и **ACTION_NAME** (как в Actions panel у Лизы).
2. Запусти скрипт, выбери папку с CR3 одной модели.
3. Проверь **3–5** файлов из `_after_button` с эталоном `до после.psb`.
4. Дальше по **`../CHECKLIST_LIZA.md`** вручную (частотка, пушок, пластика).

## Пилот (сначала)

1. Прочитать **`PILOT_VERIFICATION.md`** (отчёт проверки).
2. Идти по **`PILOT_RUNBOOK.md`** — один CR3, затем 3–5 в `pilot_girl1/`.
3. **Не** смешивать экшен Лизы и `ElizCatalogColorStack.jsx` на одном кадре.
