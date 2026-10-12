'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { inkLevels } = require('../lib/inks');
const { inkName, inkTitles } = require('../lib/i18n');

test('Epson marker attributes become named percentages; unknown and waste markers are skipped', () => {
  const inks = inkLevels({ 'marker-names': ['MB', 'PB', 'C', 'Waste', 'Unknown ink', 'Unknown ink'], 'marker-types': ['ink', 'ink', 'ink', 'waste-ink', 'ink', 'ink'],
    'marker-levels': [79, 54, -3, 40, 20, 10], 'marker-low-levels': [15, 15, 15, 90], 'marker-high-levels': [100, 100, 100, 100, 50, 50] });
  assert.deepEqual(inks.map(i => [i.id, i.level, i.low]), [['mb', 79, 15], ['pb', 54, 15], ['unknown_ink', 40, 15], ['unknown_ink_5', 20, 15]]);
  assert.equal(inkName(inks[0], 'it'), 'Nero opaco');
  assert.equal(inkName(inks[2]), 'Unknown ink');
  assert.equal(inkTitles(inks[1]).de, 'Fotoschwarz');
  assert.deepEqual(inkLevels({}), []);
});
