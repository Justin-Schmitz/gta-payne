import { Game } from './game.js';
import { SavesUI } from './ui/saves.js';
import { DIFFICULTY, getDifficulty } from './data/difficulty.js';
import { CHARACTERS, CHARACTER_ORDER } from './data/characters.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
window.game = game; // handy for debugging in the console
game.savesUI = new SavesUI(game); // named saves on the LAN server (title LOAD GAME, pause SAVE / LOAD)

const title = document.getElementById('title');
const btnContinue = document.getElementById('btn-continue');
const btnNew = document.getElementById('btn-new');
btnContinue.disabled = !game.hasSave();

// difficulty picker (applies to NEW GAME; saved games carry their own)
const DIFF_KEY = 'port-harlow-difficulty';
let chosenDiff = 'normal';
try { chosenDiff = getDifficulty(localStorage.getItem(DIFF_KEY)).id; } catch (e) { /* ignore */ }
const diffButtons = [...document.querySelectorAll('#difficulty [data-diff]')];
const blurb = document.getElementById('diff-blurb');
function pickDiff(id) {
  chosenDiff = getDifficulty(id).id;
  for (const b of diffButtons) b.classList.toggle('sel', b.dataset.diff === chosenDiff);
  blurb.textContent = DIFFICULTY[chosenDiff].blurb;
  try { localStorage.setItem(DIFF_KEY, chosenDiff); } catch (e) { /* ignore */ }
}
for (const b of diffButtons) b.addEventListener('click', () => pickDiff(b.dataset.diff));
pickDiff(chosenDiff);

function begin(newGame, characterId) {
  title.style.display = 'none';
  game.start(newGame, chosenDiff, characterId);
  document.getElementById('pause-diff').textContent = 'DIFFICULTY: ' + game.diff.label;
}
// character select (NEW GAME): four cards, click one to start
const charPanel = document.getElementById('char-select');
const charCards = document.getElementById('char-cards');
const titleMain = [document.querySelector('#title .difficulty'), document.querySelector('#title .buttons'), document.querySelector('#title .controls'), document.querySelector('#title .hint')];
for (const id of CHARACTER_ORDER) {
  const c = CHARACTERS[id];
  const card = document.createElement('button');
  card.className = 'char-card';
  card.style.setProperty('--c', c.color);
  card.innerHTML = `<span class="avatar">${c.initials}</span><span class="cname">${c.name}</span><span class="ctag">${c.tagline}</span><span class="cperk">${c.perk}</span>`;
  card.addEventListener('click', () => { showCharSelect(false); begin(true, id); });
  charCards.appendChild(card);
}
function showCharSelect(on) {
  charPanel.style.display = on ? 'block' : 'none';
  for (const el of titleMain) if (el) el.style.display = on ? 'none' : '';
}
document.getElementById('char-back').addEventListener('click', () => showCharSelect(false));
btnContinue.addEventListener('click', () => begin(false));
btnNew.addEventListener('click', () => showCharSelect(true));
document.getElementById('btn-resume').addEventListener('click', () => game.resume());
document.getElementById('btn-quit').addEventListener('click', () => game.quitToTitle());
document.getElementById('pause').addEventListener('click', (e) => { if (e.target.id === 'pause') game.resume(); });

function loop(now) {
  game.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
