const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
async function fetchCategories() {
  const { data } = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/list.php?c=list');
  return (data.drinks || []).map(d => d.strCategory);
}

function normalizeDrinkDetails(drink) {
  const ingredients = [];
  for (let i = 1; i <= 15; i++) {
    const ing = drink[`strIngredient${i}`];
    const mea = drink[`strMeasure${i}`];
    if (ing) ingredients.push({ ingredient: ing, measure: mea || '' });
  }
  return { ...drink, ingredients };
}

// ---------- Pairing logic (diverse & randomized) ----------

// Ignore these when scanning ingredients for a pairing cue
const FILLERS = [
  'ice','salt','sugar','water','soda water','club soda','tonic water','ginger ale',
  'lemon juice','lime juice','orange juice','cranberry juice','pineapple juice',
  'simple syrup','syrup','grenadine','angostura bitters','bitters',
  'mint','basil','rosemary','egg white','cream','milk','half-and-half'
];

// Curated pairing candidates per spirit/liqueur (multiple options for variety)
const PAIRING_CANDIDATES = [
  { keys: ['tequila','mezcal'], options: [
    { type: 'area',     value: 'Mexican' },
    { type: 'category', value: 'Pork' },
    { type: 'category', value: 'Seafood' }
  ]},
  { keys: ['rum'], options: [
    { type: 'area',     value: 'Jamaican' },
    { type: 'area',     value: 'Cuban' },
    { type: 'category', value: 'Dessert' }
  ]},
  { keys: ['gin'], options: [
    { type: 'category', value: 'Seafood' },
    { type: 'category', value: 'Vegetarian' },
    { type: 'area',     value: 'British' }
  ]},
  { keys: ['vodka'], options: [
    { type: 'category', value: 'Pasta' },
    { type: 'area',     value: 'Russian' },
    { type: 'category', value: 'Chicken' }
  ]},
  { keys: ['whiskey','whisky','bourbon','rye','scotch'], options: [
    { type: 'category', value: 'Beef' },
    { type: 'category', value: 'Pork' },
    { type: 'area',     value: 'American' }
  ]},
  { keys: ['brandy','cognac'], options: [
    { type: 'category', value: 'Lamb' },
    { type: 'category', value: 'Beef' },
    { type: 'area',     value: 'French' }
  ]},
  // Aperitifs / bitters / liqueurs
  { keys: ['campari','aperol','vermouth'], options: [
    { type: 'category', value: 'Seafood' },
    { type: 'category', value: 'Pasta' },
    { type: 'area',     value: 'Italian' }
  ]},
  { keys: ['triple sec','cointreau','grand marnier','curaçao','curacao','amaretto'], options: [
    { type: 'category', value: 'Dessert' },
    { type: 'category', value: 'Cake' },
    { type: 'category', value: 'Pancake' }
  ]},
  // Agave variants
  { keys: ['sotol'], options: [
    { type: 'area',     value: 'Mexican' },
    { type: 'category', value: 'Beef' }
  ]},
  // Sugarcane family
  { keys: ['cachaça','cacacha','aguardiente'], options: [
    { type: 'area',     value: 'Brazilian' },
    { type: 'category', value: 'Beef' }
  ]},
  // Anise spirits
  { keys: ['ouzo','pastis','arak','raki','sambuca'], options: [
    { type: 'area',     value: 'Greek' },
    { type: 'category', value: 'Seafood' }
  ]},
  // Rice spirits
  { keys: ['sake','soju','shochu'], options: [
    { type: 'area',     value: 'Japanese' },
    { type: 'category', value: 'Seafood' }
  ]}
];

// Diverse fallbacks (cycled randomly)
const DEFAULT_PAIRINGS = [
  { type: 'area',     value: 'Italian' },
  { type: 'area',     value: 'Thai' },
  { type: 'area',     value: 'Indian' },
  { type: 'category', value: 'Seafood' },
  { type: 'category', value: 'Vegetarian' },
  { type: 'category', value: 'Chicken' }
];

// Utility: random pick
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// From the normalized ingredients, get meaningful keywords (skip fillers)
function extractPairingKeys(ingredients) {
  return ingredients
    .map(i => (i.ingredient || '').toLowerCase().trim())
    .filter(x => x && !FILLERS.includes(x));
}

// Choose a pairing rule (random among valid options for matched spirit/liqueur)
function pickPairingRule(ingredients) {
  const keys = extractPairingKeys(ingredients);
  for (const group of PAIRING_CANDIDATES) {
    if (group.keys.some(k => keys.includes(k))) {
      return pickOne(group.options);
    }
  }
  // nothing matched → pick a random default
  return pickOne(DEFAULT_PAIRINGS);
}

// Fetch meals using TheMealDB by area/category (NOT by ingredient)
async function fetchMealsByRule(rule) {
  try {
    if (rule.type === 'area') {
      const { data } = await axios.get('https://www.themealdb.com/api/json/v1/1/filter.php', {
        params: { a: rule.value }
      });
      const meals = (data.meals || []);
      if (meals.length) return meals.slice(0, 6);
    } else if (rule.type === 'category') {
      const { data } = await axios.get('https://www.themealdb.com/api/json/v1/1/filter.php', {
        params: { c: rule.value }
      });
      const meals = (data.meals || []);
      if (meals.length) return meals.slice(0, 6);
    }
  } catch (e) {
    console.error('Meal pairing fetch failed:', e.message);
  }

  // Random fallback cascade for diversity
  const shuffled = [...DEFAULT_PAIRINGS].sort(() => Math.random() - 0.5);
  for (const fb of shuffled) {
    try {
      if (fb.type === 'area') {
        const { data } = await axios.get('https://www.themealdb.com/api/json/v1/1/filter.php', {
          params: { a: fb.value }
        });
        const meals = (data.meals || []);
        if (meals.length) return meals.slice(0, 6);
      } else {
        const { data } = await axios.get('https://www.themealdb.com/api/json/v1/1/filter.php', {
          params: { c: fb.value }
        });
        const meals = (data.meals || []);
        if (meals.length) return meals.slice(0, 6);
      }
    } catch {}
  }
  return [];
}

// ---------- Routes ----------
app.get('/', async (req, res) => {
  try {
    const categories = await fetchCategories();
    res.render('index', { categories, error: null });
  } catch (err) {
    res.render('error', { message: 'Failed to load home page data. Please try again.' });
  }
});

app.post('/search', async (req, res) => {
  const { name, ingredient } = req.body;

  try {
    let data, heading;

    if (name && name.trim()) {
      const resp = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/search.php', {
        params: { s: name.trim() }
      });
      data = resp.data.drinks || [];
      heading = `Results for name: "${name.trim()}"`;
    } else if (ingredient && ingredient.trim()) {
      const resp = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/filter.php', {
        params: { i: ingredient.trim() }
      });
      data = resp.data.drinks || [];
      heading = `Results with ingredient: "${ingredient.trim()}"`;
    } else {
      return res.redirect('/');
    }

    res.render('results', { drinks: data, heading });
  } catch (err) {
    res.render('error', { message: 'Search failed. Please try different terms.' });
  }
});

app.get('/random', async (req, res) => {
  try {
    const { data } = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/random.php');
    const drink = data.drinks && data.drinks[0];
    if (!drink) throw new Error('No drink found');

    const normalized = normalizeDrinkDetails(drink);
    const pairingRule = pickPairingRule(normalized.ingredients);
    const meals = await fetchMealsByRule(pairingRule);

    res.render('cocktail', { drink: normalized, meals, pairingRule });
  } catch (err) {
    res.render('error', { message: 'Could not fetch a random cocktail right now.' });
  }
});

app.get('/drink/:id', async (req, res) => {
  try {
    const { data } = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/lookup.php', {
      params: { i: req.params.id }
    });
    const drink = data.drinks && data.drinks[0];
    if (!drink) return res.render('error', { message: 'Drink not found.' });

    const normalized = normalizeDrinkDetails(drink);
    const pairingRule = pickPairingRule(normalized.ingredients);
    const meals = await fetchMealsByRule(pairingRule);

    res.render('cocktail', { drink: normalized, meals, pairingRule });
  } catch (err) {
    res.render('error', { message: 'Could not load drink details.' });
  }
});

app.get('/category/:name', async (req, res) => {
  try {
    const categoryName = req.params.name;
    const { data } = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/filter.php', {
      params: { c: categoryName }
    });

    res.render('results', {
      drinks: data.drinks || [],
      heading: `Category: ${categoryName}`
    });
  } catch (err) {
    res.render('error', { message: 'Could not load category.' });
  }
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
