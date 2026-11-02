// Сопровождение текущей ноты в длинной записи: рамка записи прокручивается
// сама, страница — нет. Чистая функция считает новую позицию прокрутки, чтобы
// её можно было проверить тестом без браузера.

/**
 * Новое значение scrollLeft рамки или null, если поддоля уже видна.
 * Прокрутка «страницами»: когда нота подходит к краю, она переносится к левому
 * краю рамки с отступом — так рамка дёргается редко, а не на каждом ударе.
 * @param {{scrollLeft: number, clientWidth: number, scrollWidth: number}} box
 * @param {number} left левый край поддоли, px от начала записи
 * @param {number} right правый край поддоли
 * @param {number} [margin] запас у краёв рамки
 */
export function followScrollLeft(box, left, right, margin = 24) {
  const { scrollLeft, clientWidth, scrollWidth } = box;
  const maxLeft = Math.max(0, scrollWidth - clientWidth);
  if (maxLeft === 0) return null;
  const visible = left >= scrollLeft + Math.min(margin, left) && right <= scrollLeft + clientWidth - margin;
  if (visible) return null;
  const next = Math.min(maxLeft, Math.max(0, left - margin));
  return next === scrollLeft ? null : next;
}
