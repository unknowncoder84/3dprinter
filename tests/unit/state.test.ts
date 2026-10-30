import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, missingLetters, projectReducer, type ProjectState } from '../../lib/state/projectState';
import { parseProject, projectFileName, ProjectFileError, serializeProject } from '../../lib/storage/projectFile';
import { createDefaultCard, sanitizeCard } from '../../types/flashcard';
import { clampHoleCenter, computeHolePlacement, holeWall, matchPreset } from '../../lib/geometry/hole';
import { svgImage } from './helpers';

const reduce = (s: ProjectState, ...actions: Parameters<typeof projectReducer>[1][]) => actions.reduce(projectReducer, s);
const selected = (s: ProjectState) => s.cards.find((c) => c.id === s.selectedId)!;

test('new card gets the next free letter and the selected card\'s settings; existing cards are preserved', () => {
  let s = createInitialState();
  const first = selected(s);
  s = reduce(s, { type: 'update', id: first.id, patch: { dimensions: { width: 90 } } });
  s = reduce(s, { type: 'add' });
  assert.equal(s.cards.length, 2);
  assert.equal(selected(s).alphabet, 'Bb');
  assert.equal(selected(s).word, 'ball');
  assert.equal(selected(s).dimensions.width, 90, 'inherits the template');
  assert.equal(s.cards[0].alphabet, 'Aa', 'existing card untouched');
  assert.notEqual(s.cards[0].id, s.cards[1].id);
});

test('duplicate creates an independent deep copy', () => {
  let s = createInitialState();
  const a = selected(s);
  s = reduce(s, { type: 'setImage', id: a.id, image: { ...svgImage('<svg xmlns="http://www.w3.org/2000/svg"/>') } });
  s = reduce(s, { type: 'duplicate', id: a.id });
  assert.equal(s.cards.length, 2);
  const [orig, copy] = s.cards;
  assert.notEqual(orig.id, copy.id);
  assert.deepEqual(copy.dimensions, orig.dimensions);
  assert.ok(copy.image && copy.image.dataUrl === orig.image!.dataUrl);
  s = reduce(s, { type: 'update', id: copy.id, patch: { word: 'changed', dimensions: { width: 70 }, holeSettings: { diameter: 8 } } });
  assert.equal(s.cards[0].word, 'ant');
  assert.equal(s.cards[0].dimensions.width, 80);
  assert.equal(s.cards[0].holeSettings.diameter, 5);
  assert.equal(s.cards[1].word, 'changed');
  assert.equal(selected(s).id, copy.id);
});

test('delete removes the card, selects a neighbour and never leaves the project empty', () => {
  let s = reduce(createInitialState(), { type: 'add' }, { type: 'add' });
  assert.equal(s.cards.length, 3);
  const mid = s.cards[1];
  s = reduce(s, { type: 'delete', id: mid.id });
  assert.equal(s.cards.length, 2);
  assert.ok(!s.cards.some((c) => c.id === mid.id));
  assert.ok(s.cards.some((c) => c.id === s.selectedId));
  s = reduce(s, { type: 'delete', id: s.cards[0].id }, { type: 'delete', id: s.cards[0].id });
  assert.equal(s.cards.length, 1, 'a fresh card replaces the last deleted one');
});

test('Generate A-Z adds 26 cards once, keeps custom cards, and only restores what is missing', () => {
  let s = createInitialState();
  s = reduce(s, { type: 'generateAz' });
  assert.equal(s.cards.length, 26);
  assert.deepEqual(s.cards.map((c) => c.alphabet[0]).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const again = reduce(s, { type: 'generateAz' });
  assert.equal(again, s, 'second press changes nothing (same state object)');
  // customise C, remove M, regenerate
  const c = s.cards[2];
  s = reduce(s, { type: 'update', id: c.id, patch: { word: 'cow' } }, { type: 'delete', id: s.cards[12].id });
  assert.deepEqual(missingLetters(s.cards), ['M']);
  s = reduce(s, { type: 'generateAz' });
  assert.equal(s.cards.length, 26);
  assert.equal(s.cards[2].word, 'cow');
  assert.equal(s.cards[12].alphabet, 'Mm');
  assert.equal(new Set(s.cards.map((x) => x.id)).size, 26, 'unique ids');
});

test('resizing the card keeps preset hole positions attached and custom holes inside the card', () => {
  let s = createInitialState();
  const id = selected(s).id;
  s = reduce(s, { type: 'update', id, patch: { holeSettings: { preset: 'top-right' } } });
  assert.deepEqual([selected(s).holeSettings.x, selected(s).holeSettings.y], [73, 7]);
  s = reduce(s, { type: 'update', id, patch: { dimensions: { width: 100 } } });
  assert.deepEqual([selected(s).holeSettings.x, selected(s).holeSettings.y], [93, 7], 'preset follows the new width');
  s = reduce(s, { type: 'update', id, patch: { holeSettings: { preset: 'custom', x: 93, y: 50 } } });
  s = reduce(s, { type: 'update', id, patch: { dimensions: { width: 50 } } });
  const h = selected(s).holeSettings;
  assert.ok(h.x <= 50 - 2.5 - 1.5 + 1e-6, `custom hole pulled back inside (x=${h.x})`);
  assert.ok(holeWall(h.x, h.y, selected(s).dimensions, h.diameter) >= 1.5 - 0.01);
  // corner radius can never exceed half of the smaller side
  s = reduce(s, { type: 'update', id, patch: { dimensions: { cornerRadius: 60, width: 40, height: 100 } } });
  assert.ok(selected(s).dimensions.cornerRadius <= 20);
});

test('hole helpers: clamping, wall thickness and preset detection use real millimetres', () => {
  const dims = { width: 80, height: 100, thickness: 3, cornerRadius: 8 };
  const c = clampHoleCenter(0.5, 0.5, dims, 5, 1.5);
  assert.ok(holeWall(c.x, c.y, dims, 5) >= 1.5 - 0.01);
  const inside = clampHoleCenter(40, 50, dims, 5, 1.5);
  assert.deepEqual(inside, { x: 40, y: 50 }, 'valid positions are not moved');
  const p = computeHolePlacement(7, 7, dims, 5, 1.5);
  assert.equal(p.preset, 'top-left');
  assert.equal(p.adjusted, false);
  assert.equal(computeHolePlacement(40.5, 50, dims, 5, 1.5).preset, 'custom');
  assert.equal(matchPreset(40, 7, dims, 5), 'top-center');
});

test('apply settings copies only the chosen groups', () => {
  let s = reduce(createInitialState(), { type: 'generateAz' });
  const src = s.cards[0];
  s = reduce(s, { type: 'update', id: src.id, patch: { dimensions: { height: 120 }, textSettings: { alphabetSize: 30 } } });
  s = reduce(s, { type: 'applySettings', fromId: src.id, toIds: s.cards.slice(1).map((c) => c.id), groups: ['dimensions'] });
  assert.ok(s.cards.slice(1).every((c) => c.dimensions.height === 120));
  assert.ok(s.cards.slice(1).every((c) => c.textSettings.alphabetSize === 26), 'text style not copied');
  assert.equal(s.cards[5].word, 'fish');
});

test('project file round trip keeps everything; damaged files are rejected', () => {
  let s = createInitialState();
  s = reduce(s, { type: 'setImage', id: selected(s).id, image: svgImage('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>', 'dot.svg') });
  s = reduce(s, { type: 'add' }, { type: 'rename', name: 'Test set' });
  const file = serializeProject(s);
  assert.equal(file.format, 'flashcard-studio-project');
  assert.equal(file.version, 2);
  const back = parseProject(JSON.stringify(file));
  assert.equal(back.project.cards.length, 2);
  assert.equal(back.project.projectName, 'Test set');
  assert.deepEqual(back.project.cards[0], s.cards[0]);
  assert.equal(back.project.cards[0].image?.fileName, 'dot.svg');
  assert.equal(projectFileName('Test set'), 'test-set.flashcards.json');

  assert.throws(() => parseProject('nope'), ProjectFileError);
  assert.throws(() => parseProject(JSON.stringify({ format: 'x', version: 2, cards: [{}] })), /not a Flashcard Studio/);
  assert.throws(() => parseProject(JSON.stringify({ ...file, version: 3 })), /newer version/);
  assert.throws(() => parseProject(JSON.stringify({ ...file, cards: [] })), /no cards/);
  assert.throws(() => parseProject(JSON.stringify({ ...file, cards: 'x' })), /no "cards" list/);
});

test('sanitizeCard repairs hostile values and converts schema v1 cards', () => {
  const hostile = sanitizeCard({
    alphabet: 12345,
    word: { x: 1 },
    dimensions: { width: -50, height: 1e9, thickness: 'abc', cornerRadius: 9999 },
    holeSettings: { diameter: -3, x: 'foo', y: 1e6, preset: 'nonsense' },
    textSettings: { fontId: '<script>', alphabetSize: 0 },
    image: { dataUrl: 'javascript:alert(1)' },
  });
  assert.equal(hostile.image, null, 'non-image data URLs are dropped');
  assert.ok(hostile.dimensions.width >= 30 && hostile.dimensions.height <= 300);
  assert.ok(hostile.dimensions.thickness >= 0.8);
  assert.ok(hostile.dimensions.cornerRadius <= Math.min(hostile.dimensions.width, hostile.dimensions.height) / 2);
  assert.ok(hostile.holeSettings.diameter >= 2);
  assert.equal(hostile.textSettings.fontId, 'poppins-bold');
  const v1 = sanitizeCard({
    id: '1', alphabet: 'Dd', word: 'dog',
    holeSettings: { enabled: true, diameter: 5, position: 'bottom-left', customX: 10, customY: 10 },
    textSettings: { alphabetSize: 24, wordSize: 12, alphabetHeight: 2, wordHeight: 1.5, fontFamily: 'Arial', alphabetY: 15, wordY: 15 },
  });
  assert.equal(v1.holeSettings.preset, 'bottom-left');
  assert.equal(v1.holeSettings.x, 7);
  assert.equal(v1.holeSettings.y, 93);
  assert.equal(v1.textSettings.alphabetSize, createDefaultCard().textSettings.alphabetSize, 'incomparable v1 sizes reset to defaults');
});
