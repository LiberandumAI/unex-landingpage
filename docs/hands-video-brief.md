# Видео рук для финала — как сгенерировать и подготовить

## Что нужно на выходе

`public/hands.mp4`, 16:9, 1920×1080 (лучше 2560×1440), 5–6 секунд, 24–30 fps, без звука.
Сайт скраббит видео скроллом: первый кадр показывается, когда секция только входит,
последний — когда монета садится в ладони. Видео НЕ проигрывается само.

## Генерация (Kling / Veo / Runway, image-to-video с двумя кадрами)

- Стартовый кадр: `public/hero-desk.jpg` (стол без рук).
- Конечный кадр: `public/hands.jpg` (те же стол и предметы, раскрытые ладони по центру).
- Промпт:

  Locked-off top-down camera, no camera movement at all. Same dark walnut desk, notebook,
  pencil, coffee cup and hardware wallet stay perfectly still. Two hands in dark sleeves
  enter slowly from the bottom edge of the frame, palms up, and come to rest cupped
  together in the exact centre, opening gently as they settle, ready to receive a coin.
  Slow, calm, deliberate motion, ends completely still on the last frame. Warm cinematic
  key light from the upper right, deep soft shadows, film-like, no flicker, no text,
  no coin, no logos.

- Негатив (если поле есть): camera pan, zoom, shaking, flicker, extra fingers, second
  pair of hands, coin, text, watermark.
- Отбраковка: любое движение камеры или «плавание» предметов на столе — переделать.
  Руки должны входить снизу и замереть, не дрожать.

## Подготовка под скраб (обязательно)

Обычный H.264 с редкими ключевыми кадрами при перемотке скроллом дёргается. Нужен
файл, где каждый кадр ключевой:

```bash
ffmpeg -i hands_raw.mp4 -an -vf "scale=1920:-2,fps=30" -c:v libx264 -profile:v high \
  -pix_fmt yuv420p -g 1 -keyint_min 1 -crf 20 -movflags +faststart public/hands.mp4
```

Ожидаемый вес 15–30 МБ на 6 секунд — это нормально для all-intra. Если нужен вес
меньше, второй вариант — секвенция кадров: `ffmpeg -i hands_raw.mp4 -vf fps=24
frames/hands_%03d.webp`, тогда скраб идёт по картинкам на canvas (сделаем, если выберем
этот путь).

Пока файла нет, на сайте стоит статичный `hands.jpg`, всё остальное уже работает.
