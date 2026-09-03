/* Kitchen manifest.
   One entry per plate. To add a dish: drop the photo in assets/kitchen/ and
   append an object here — nothing else needs touching.

   src   : filename inside assets/kitchen/
   name  : what the dish is
   notes : the reveal. Ingredients, a memory, a feeling — short lines read
           best, two or three is plenty.
   size  : optional grid emphasis — 'big' (2x2), 'tall' (1x2), 'wide' (2x1).
           Use sparingly; the mosaic needs mostly single tiles to breathe.

   NOTE FOR BRYAN: names and notes below are read off the photographs — they
   are placeholders and some are certainly wrong. Correct them. The second
   line of each is where a memory or a feeling goes; that part has to be
   yours, not mine. */
window.KITCHEN = [
  { src: 'beef-wellington.webp',      name: 'Beef Wellington',
    notes: ['Beef, mushroom duxelles, puff pastry', 'Cut it open and hoped'], size: 'big' },

  { src: 'beef-noodle-soup.webp',     name: 'Beef noodle soup',
    notes: ['Shank, noodles, scallion, dark broth'] },

  { src: 'candlelit-fish.webp',       name: 'Fish, green sauce, a bottle',
    notes: ['Two glasses, one candle'], size: 'wide' },

  { src: 'steamed-fish.webp',         name: 'Steamed fish',
    notes: ['Ginger, scallion, hot oil over soy'], size: 'tall' },

  { src: 'lu-rou-fan.webp',           name: 'Lu rou fan',
    notes: ['Braised minced pork, bok choy, marinated egg'] },

  { src: 'bossam.webp',               name: 'Bossam',
    notes: ['Boiled pork belly, napa, kimchi, garlic'] },

  { src: 'dinner-party.webp',         name: 'Dinner for the table',
    notes: ['Caprese, meatballs, rigatoni, steak'], size: 'wide' },

  { src: 'braised-beef-bowl.webp',    name: 'Braised beef bowl',
    notes: ['Cabbage, soft egg, dark broth'] },

  { src: 'pork-belly-spread.webp',    name: 'Pork belly spread',
    notes: ['Napa, tofu, kimchi, chilli'] },

  { src: 'roast-chicken.webp',        name: 'Roast chicken',
    notes: ['Asparagus, mushrooms, rice'] },

  { src: 'watermelon.webp',           name: 'Watermelon',
    notes: ['Hollowed out, eaten from the rind'], size: 'tall' },

  { src: 'skewers.webp',              name: 'Skewers',
    notes: ['Peppers, onion, shrimp, chicken'] },

  { src: 'steak-peppers.webp',        name: 'Steak and peppers',
    notes: ['Seared hard, sliced across the grain'] },

  { src: 'chicken-and-soup.webp',     name: 'White-cut chicken',
    notes: ['Scallion oil, winter melon soup'] },

  { src: 'sliced-pork-scallion.webp', name: 'Sliced pork, scallion',
    notes: ['Cold cut, garlic, a lot of scallion'] },

  { src: 'skillet-chicken.webp',      name: 'Skillet chicken',
    notes: ['One pan, everything in it'] },

  { src: 'steak-and-rice.webp',       name: 'Steak over rice',
    notes: ['Sesame, sauce, a bowl of rice'] },

  { src: 'fish-and-rice.webp',        name: 'Fish and rice',
    notes: ['Steamed whole, scallion on top'] },
];
