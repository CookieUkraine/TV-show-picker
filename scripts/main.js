const form = document.getElementById('search-form');
const yearInput = document.getElementById('year');
const yearOutput = document.getElementById('year-output');
const range = yearInput.closest('.range');

/**
 * Оновлює бульбашку з роком і позицію під повзунком.
 * Враховуємо ширину "пальця" (16px), щоб бульбашка точно була під ним.
 */
function updateYear() {
  const min = Number(yearInput.min);
  const max = Number(yearInput.max);
  const value = Number(yearInput.value);
  const ratio = (value - min) / (max - min);

  const thumbWidth = 16;
  const offset = thumbWidth / 2 - ratio * thumbWidth;

  yearOutput.textContent = value;
  range.style.setProperty('--thumb-pos', `calc(${ratio * 100}% + ${offset}px)`);
  range.style.setProperty('--progress', `${ratio * 100}%`);
}

yearInput.addEventListener('input', updateYear);
window.addEventListener('resize', updateYear);
updateYear();

/**
 * Збирає значення полів форми в об'єкт.
 */
function getFormData() {
  const data = new FormData(form);

  return {
    query: data.get('query').trim(),
    genre: data.get('genre').trim(),
    country: data.get('country').trim(),
    year: Number(data.get('year')),
  };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const filters = getFormData();

  // Тут можна підключити запит до API (TMDB, OMDb тощо).
  console.log('Параметри пошуку:', filters);
});