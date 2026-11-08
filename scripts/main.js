/* ==========================================================
   Config
   ========================================================== */

const API_KEY = '50f0c1a67a10c654b5c9ff0030f6f409';
const API_URL = 'https://api.themoviedb.org/3';
const IMG_URL = 'https://image.tmdb.org/t/p/w342';
const SITE_URL = 'https://www.themoviedb.org';
const LANGUAGE = 'uk-UA';
const MAX_RESULTS = 24;

/* ==========================================================
   DOM
   ========================================================== */

const form = document.getElementById('search-form');
const yearInput = document.getElementById('year');
const yearOutput = document.getElementById('year-output');
const range = yearInput.closest('.range');
/**
 * Якщо в index.html немає блоку результатів (стара версія розмітки),
 * створюємо його, щоб скрипт не падав.
 */
function ensureResultsBlock() {
  let section = document.querySelector('.results');

  if (!section) {
    section = document.createElement('section');
    section.className = 'results';
    section.setAttribute('aria-live', 'polite');
    document.body.append(section);
  }

  let status = document.getElementById('status');

  if (!status) {
    status = document.createElement('p');
    status.className = 'results__status';
    status.id = 'status';
    status.hidden = true;
    section.append(status);
  }

  let list = document.getElementById('results');

  if (!list) {
    list = document.createElement('ul');
    list.className = 'results__list';
    list.id = 'results';
    section.append(list);
  }

  return { statusEl: status, resultsEl: list };
}

const { statusEl, resultsEl } = ensureResultsBlock();
const submitButtons = form.querySelectorAll('button[type="submit"]');

/* ==========================================================
   Year slider
   ========================================================== */

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

/* ==========================================================
   TMDB helpers
   ========================================================== */

async function tmdb(path, params = {}) {
  const url = new URL(API_URL + path);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('language', LANGUAGE);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TMDB відповів зі статусом ${response.status}`);
  }

  return response.json();
}

/* ---------- Genres (typed text -> TMDB genre ids) ---------- */

let genresPromise = null;

function loadGenres() {
  if (!genresPromise) {
    genresPromise = Promise.all([
      tmdb('/genre/movie/list'),
      tmdb('/genre/tv/list'),
    ])
      .then(([movie, tv]) => ({ movie: movie.genres, tv: tv.genres }))
      .catch((error) => {
        genresPromise = null;
        throw error;
      });
  }

  return genresPromise;
}

/**
 * "комедія, драма" -> { ids: [35, 18], unknown: [] }
 * Достатньо ввести частину назви ("комед").
 */
function resolveGenres(text, list) {
  const terms = text
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  const ids = [];
  const unknown = [];

  terms.forEach((term) => {
    const hit =
      list.find((genre) => genre.name.toLowerCase().startsWith(term)) ||
      list.find((genre) => genre.name.toLowerCase().includes(term));

    if (hit) {
      ids.push(hit.id);
    } else {
      unknown.push(term);
    }
  });

  return { ids, unknown };
}

/* ---------- Countries (typed text -> ISO 3166-1 code) ---------- */

let countryList = null;

function getCountryList() {
  if (countryList) return countryList;

  countryList = [];
  const displayNames = ['uk', 'en'].map(
    (lang) => new Intl.DisplayNames([lang], { type: 'region' })
  );

  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);

      displayNames.forEach((names) => {
        try {
          const name = names.of(code);
          if (name && name !== code) {
            countryList.push({ code, name: name.toLowerCase() });
          }
        } catch {
          /* неіснуючий код — пропускаємо */
        }
      });
    }
  }

  return countryList;
}

/** "Україна" | "ukraine" | "UA" -> "UA"; null, якщо не знайдено */
function resolveCountry(text) {
  const term = text.trim().toLowerCase();
  if (!term) return '';
  if (/^[a-z]{2}$/.test(term)) return term.toUpperCase();

  const list = getCountryList();
  const hit =
    list.find((country) => country.name === term) ||
    list.find((country) => country.name.startsWith(term)) ||
    list.find((country) => country.name.includes(term));

  return hit ? hit.code : null;
}

/* ==========================================================
   Search strategies
   ========================================================== */

/**
 * Режим 1: користувач вписав, що йому сподобалось.
 * Шукаємо цей фільм/серіал і беремо рекомендації TMDB.
 */
async function searchByLiked(filters, genreIds) {
  const found = await tmdb('/search/multi', { query: filters.query });
  const base = pickBestMatch(found.results, filters.query);

  if (!base) {
    return { base: null, items: [] };
  }

  const pages = await Promise.all([
    tmdb(`/${base.media_type}/${base.id}/recommendations`, { page: 1 }),
    tmdb(`/${base.media_type}/${base.id}/recommendations`, { page: 2 }),
  ]);

  const items = pages
    .flatMap((page) => page.results)
    .map((item) => ({ ...item, media_type: item.media_type || base.media_type }))
    .filter((item) => matchesFilters(item, filters, genreIds));

  return { base, items };
}

/**
 * search/multi сортує за релевантністю, тож перший результат може бути
 * побічним проєктом (промо, спецвипуск). Серед перших результатів беремо
 * точний збіг назви (якщо є), а з них — тайтл з найбільшою кількістю голосів:
 * це майже завжди основний фільм або серіал.
 */
function pickBestMatch(results, query) {
  const candidates = results
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .slice(0, 5);

  if (!candidates.length) return null;

  const q = query.trim().toLowerCase();
  const exact = candidates.filter(
    (item) => (item.title || item.name || '').toLowerCase() === q
  );
  const pool = exact.length ? exact : candidates;

  return pool.reduce((best, item) =>
    (item.vote_count || 0) > (best.vote_count || 0) ? item : best
  );
}

/** Фільтри, які TMDB не вміє застосувати до рекомендацій — робимо самі. */
function matchesFilters(item, filters, genreIds) {
  const itemYear = Number((item.release_date || item.first_air_date || '').slice(0, 4));
  if (!itemYear || itemYear < filters.year) return false;

  if (filters.genre) {
    const wanted = genreIds[item.media_type] || [];
    const has = (item.genre_ids || []).some((id) => wanted.includes(id));
    if (!has) return false;
  }

  // origin_country є лише у серіалів; для фільмів TMDB цього поля не віддає
  if (filters.countryCode && Array.isArray(item.origin_country)) {
    if (!item.origin_country.includes(filters.countryCode)) return false;
  }

  return true;
}

/**
 * Режим 2: поле пошуку порожнє — підбираємо за жанром, країною та роком.
 */
async function searchByFilters(filters, genreIds) {
  const requests = [];
  const baseParams = {
    sort_by: 'popularity.desc',
    'vote_count.gte': 50,
    with_origin_country: filters.countryCode,
  };

  // якщо жанр вказано, але в одному з типів його немає — цей тип пропускаємо
  if (!filters.genre || genreIds.movie.length) {
    requests.push(
      tmdb('/discover/movie', {
        ...baseParams,
        with_genres: genreIds.movie.join('|'),
        'primary_release_date.gte': `${filters.year}-01-01`,
      }).then((data) => data.results.map((item) => ({ ...item, media_type: 'movie' })))
    );
  }

  if (!filters.genre || genreIds.tv.length) {
    requests.push(
      tmdb('/discover/tv', {
        ...baseParams,
        with_genres: genreIds.tv.join('|'),
        'first_air_date.gte': `${filters.year}-01-01`,
      }).then((data) => data.results.map((item) => ({ ...item, media_type: 'tv' })))
    );
  }

  const lists = await Promise.all(requests);

  return lists.flat().sort((a, b) => b.popularity - a.popularity);
}

/* ==========================================================
   Rendering
   ========================================================== */

function setStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function createCard(item) {
  const title = item.title || item.name || 'Без назви';
  const date = item.release_date || item.first_air_date || '';
  const year = date.slice(0, 4);
  const type = item.media_type === 'tv' ? 'Серіал' : 'Фільм';
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '—';

  const li = document.createElement('li');

  const link = document.createElement('a');
  link.className = 'movie';
  link.href = `${SITE_URL}/${item.media_type}/${item.id}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  if (item.poster_path) {
    const img = document.createElement('img');
    img.className = 'movie__poster';
    img.src = IMG_URL + item.poster_path;
    img.alt = `Постер: ${title}`;
    img.loading = 'lazy';
    link.append(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'movie__poster movie__poster--empty';
    placeholder.textContent = 'Немає постера';
    link.append(placeholder);
  }

  const body = document.createElement('div');
  body.className = 'movie__body';

  const heading = document.createElement('h2');
  heading.className = 'movie__title';
  heading.textContent = title;

  const meta = document.createElement('p');
  meta.className = 'movie__meta';
  meta.textContent = [type, year, `★ ${rating}`].filter(Boolean).join(' · ');

  body.append(heading, meta);

  if (item.overview) {
    const overview = document.createElement('p');
    overview.className = 'movie__overview';
    overview.textContent = item.overview;
    body.append(overview);
  }

  link.append(body);
  li.append(link);

  return li;
}

function renderResults(items) {
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = `${item.media_type}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  resultsEl.replaceChildren(...unique.slice(0, MAX_RESULTS).map(createCard));

  return unique.length;
}

/* ==========================================================
   Form
   ========================================================== */

function getFormData() {
  const data = new FormData(form);

  return {
    query: data.get('query').trim(),
    genre: data.get('genre').trim(),
    country: data.get('country').trim(),
    year: Number(data.get('year')),
  };
}

function setLoading(isLoading) {
  submitButtons.forEach((button) => {
    button.disabled = isLoading;
  });
}




form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const filters = getFormData();

  setLoading(true);
  setStatus('Шукаємо...');
  resultsEl.replaceChildren();

  try {
    // 1. Жанр: текст -> id окремо для фільмів і серіалів
    const genreIds = { movie: [], tv: [] };

    if (filters.genre) {
      const genres = await loadGenres();
      const movie = resolveGenres(filters.genre, genres.movie);
      const tv = resolveGenres(filters.genre, genres.tv);

      if (!movie.ids.length && !tv.ids.length) {
        setStatus(`Жанр «${filters.genre}» не знайдено. Спробуйте, наприклад: комедія, драма, трилер.`);
        return;
      }

      genreIds.movie = movie.ids;
      genreIds.tv = tv.ids;
    }

    // 2. Країна: текст -> код
    filters.countryCode = resolveCountry(filters.country);

    if (filters.countryCode === null) {
      setStatus(`Країну «${filters.country}» не знайдено. Спробуйте, наприклад: Україна, США, Франція.`);
      return;
    }

    // 3. Пошук
    let items;
    let base = null;

    if (filters.query) {
      ({ base, items } = await searchByLiked(filters, genreIds));

      if (!base) {
        setStatus(`Нічого не знайшли за запитом «${filters.query}».`);
        return;
      }
    } else {
      items = await searchByFilters(filters, genreIds);
    }

    const count = renderResults(items);

    if (!count) {
      setStatus('За цими фільтрами нічого не знайдено. Спробуйте послабити умови.');
    } else if (base) {
      setStatus(`Схоже на «${base.title || base.name}»:`);
    } else {
      setStatus('Ось що ми підібрали:');
    }
  } catch (error) {
    console.error(error);
    setStatus('Не вдалося отримати дані. Перевірте з\u2019єднання та спробуйте ще раз.');
  } finally {
    setLoading(false);
  }
});
