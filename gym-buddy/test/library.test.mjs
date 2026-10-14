import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryEntry, buildLibraryIndex, findExercise, youtubeSearch } from '../src/lib.js';

const rt = (s) => [{ plain_text: s }];
const row = (name, extra = {}) => ({
  Name: { title: rt(name) },
  'Photo Match': { select: { name: 'Exact' } },
  'Photo Note': { rich_text: [] },
  Cue: { rich_text: rt('chest up') },
  Steps: { rich_text: rt('1. Stand tall.\n2. Squat down.\n') },
  'Also Called': { rich_text: rt('Pull-up, Pullups') },
  'Image Start': { url: 'https://eddiezaragoza.com/images/exercises/Pullups/0.jpg' },
  'Image End': { url: 'https://eddiezaragoza.com/images/exercises/Pullups/1.jpg' },
  Video: { url: 'https://www.youtube.com/results?search_query=x' },
  ...extra,
});

test('library row maps to same-origin photos, clean steps, aliases', () => {
  const e = libraryEntry(row('Pull-ups'));
  assert.deepEqual(e.photos, ['/images/exercises/Pullups/0.jpg', '/images/exercises/Pullups/1.jpg']);
  assert.deepEqual(e.steps, ['Stand tall.', 'Squat down.']);
  assert.deepEqual(e.also, ['Pull-up', 'Pullups']);
});
test('foreign photo and video URLs are dropped', () => {
  const e = libraryEntry(row('X', {
    'Image Start': { url: 'https://evil.example/a.jpg' },
    'Image End': { url: 'https://eddiezaragoza.com/images/exercises/../../gym/api' },
    Video: { url: 'javascript:alert(1)' },
  }));
  assert.deepEqual(e.photos, []);
  assert.equal(e.video, null);
});
test('lookup ignores case, punctuation, plural and uses aliases', () => {
  const idx = buildLibraryIndex([libraryEntry(row('Pull-ups')), libraryEntry(row('DB RDL', { 'Also Called': { rich_text: rt('Romanian Deadlift') } }))]);
  assert.equal(findExercise(idx, 'pull ups').name, 'Pull-ups');
  assert.equal(findExercise(idx, 'Pull-up').name, 'Pull-ups');
  assert.equal(findExercise(idx, 'PULLUP').name, 'Pull-ups');
  assert.equal(findExercise(idx, 'romanian deadlift').name, 'DB RDL');
  assert.equal(findExercise(idx, 'DB RDLs').name, 'DB RDL');
  assert.equal(findExercise(idx, 'Pull-ups (strict, max)').name, 'Pull-ups');
  assert.equal(findExercise(idx, 'Pull-ups + dead hang').name, 'Pull-ups');
  assert.equal(findExercise(idx, 'Bench Press'), null);
});
test('youtube fallback link', () => {
  assert.equal(youtubeSearch('Goblet Squat'), 'https://www.youtube.com/results?search_query=Goblet%20Squat%20exercise%20proper%20form');
});
