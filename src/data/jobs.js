import { curb, park, inter } from '../world/city.js';

/**
 * Side-job data: street contacts, vehicle-job landmarks, random-event lines, kill frenzies and
 * time-trial races. Every spoken line lives in JOB_LINES (id -> {who, text}); `npm run voice-lines`
 * exports them (see scripts/voice-lines.js and VOICES.md). Behaviour is in systems/jobs.js and
 * systems/activities.js. All content is original.
 */
export const JOB_LINES = {};
const L = (id, who, text) => { JOB_LINES[id] = { who, text }; return id; };

/** Places a taxi fare can ask for, with a drop-off spot in the road beside each. */
export const LANDMARKS = [
  { name: 'Central Station', ...park(5, 2, 's', 0.5) },
  { name: 'First Harlow Bank', ...park(5, 4, 's', 0.5) },
  { name: 'the Courthouse', ...park(3, 6, 's', 0.5) },
  { name: 'Harlow General Hospital', ...park(2, 7, 's', 0.5) },
  { name: 'the HPD Precinct', ...park(7, 7, 's', 0.5) },
  { name: 'the Chapel of Mercy', ...park(1, 3, 'e', 0.5) },
  { name: 'the Marina', ...park(0, 8, 'e', 0.5) },
  { name: 'Harlow Scrap', ...park(9, 9, 'w', 0.4) },
  { name: 'Pier 9', ...park(5, 9, 's', 0.5) },
  { name: 'Harlow Arms', ...park(8, 2, 's', 0.5) },
  { name: 'the Golden Fig bar', ...park(4, 2, 'e', 0.5) },
  { name: 'Harlow Respray', ...park(4, 4, 'w', 0.5) },
  { name: 'the Fenwick garage', ...park(8, 6, 'n', 0.5) },
  { name: 'Westside Park', ...park(1, 1, 's', 0.5) },
  { name: 'the Suds Laundromat', ...park(2, 5, 'n', 0.5) },
];
export const HOSPITAL = LANDMARKS[3];

/** Vehicle-job offers: typeKey of the car you climb into -> job kind and prompt text. */
export const VEHICLE_JOBS = {
  taxi: { kind: 'taxi', prompt: 'E — START TAXI FARES' },
  police: { kind: 'vigilante', prompt: 'E — START VIGILANTE' },
  ambulance: { kind: 'paramedic', prompt: 'E — START PARAMEDIC' },
};

export const FARE_CFG = {
  taxi: {
    title: 'TAXI FARES', fares: 5, base: 250, perM: 1.2, bonus: 1000,
    start: L('taxi.start', 'Dispatch', 'Dispatch to all cabs: fares are waiting. Pick them up, drop them off, and no small talk.'),
    board: [
      L('taxi.board1', 'Fare', "Take me where the marker says, and don't take the scenic route."),
      L('taxi.board2', 'Fare', "I'm late for everything. Floor it."),
      L('taxi.board3', 'Fare', 'Nice cab. Does it come with brakes? Never mind, go.'),
    ],
    arrive: [
      L('taxi.arrive1', 'Fare', 'Keep the change. There is no change. Keep it anyway.'),
      L('taxi.arrive2', 'Fare', 'Not bad. Not good, but not bad.'),
    ],
    done: L('taxi.done', 'Dispatch', "That's your shift. Nice driving. The cab smells better already."),
  },
  paramedic: {
    title: 'PARAMEDIC', fares: 5, base: 400, perM: 1.0, bonus: 1500,
    start: L('para.start', 'Dispatch', 'Dispatch: injured on the sidewalk. Get there, load them up, and run for Harlow General.'),
    board: [L('para.board', 'Fare', 'Please... hospital... hurry...')],
    arrive: [L('para.arrive', 'Dispatch', 'Patient delivered. Good work out there.')],
    done: L('para.done', 'Dispatch', "Shift's over. You saved some lives tonight."),
  },
};
export const VIGILANTE = {
  title: 'VIGILANTE', targets: 5, reward: 1500, bonus: 2000, time: 90,
  start: L('vig.start', 'Dispatch', 'Dispatch: a gang car just ran a light. It is marked on your map. Bring it down. No paperwork.'),
  down: L('vig.down', 'Dispatch', "That's one less on the streets. There's another, if you have the stomach."),
  done: L('vig.done', 'Dispatch', "Shift's over, officer. The citizens say thanks."),
};

/** Random street events (three types, each at most 60 s). */
export const EVENTS = {
  driveby: { warn: L('ev.driveby.warn', 'Stranger', "Get down! That's the car from the shooting! It's coming this way!"), reward: 1200, killReward: 2000, time: 45 },
  mugging: { help: L('ev.mug.help', 'Stranger', 'Stop him! He took my bag! He went that way!'), thanks: L('ev.mug.thanks', 'Stranger', 'My bag! Thank you, thank you! Take this.'), reward: 1500, time: 60 },
  tail: { ask: L('ev.tail.ask', 'Stranger', "Hey, you! There's a grey car following me and I don't know why. Draw them off and lose them. I'll pay."), thanks: L('ev.tail.thanks', 'Stranger', "They're gone! I owe you. Here."), reward: 2000, time: 60 },
};

/** Race for Dani's street-race contact: AI route as intersections [[i,j],...]. */
const DANI_ROUTE = [[7, 9], [9, 9], [9, 4], [5, 4], [5, 1]];

/**
 * Five street contacts. `at` is a sidewalk spot; `reward` is the first-time pay (repeats pay 40%),
 * both multiplied by the difficulty reward. `p` holds job parameters used by systems/jobs.js.
 */
export const CONTACTS = [
  {
    id: 'cabbie', name: 'Sal Bruno', title: 'STOLEN CAB', at: curb(4, 3, 'e', 0.7), reward: 4000,
    colors: { skin: '#c68642', shirt: '#f1c40f', pants: '#2c3e50', hat: '#222222' },
    p: { home: park(4, 3, 'e', 0.5), time: 130 },
    lines: {
      offer: L('job.cabbie.offer', 'Sal Bruno', "Hey, you! Some punk just drove off in my cab with the meter running. Yellow, you can't miss it. Catch him, bounce him off a lamppost if you have to, and bring it back here."),
      caught: L('job.cabbie.caught', 'Cab Thief', 'Okay, okay! Take the stupid cab! I am out of here!'),
      done: L('job.cabbie.done', 'Sal Bruno', "That's my girl, all in one piece. Mostly. Here, for your trouble."),
    },
  },
  {
    id: 'dock', name: 'Pete Okafor', title: 'CRATE RUN', at: curb(1, 9, 'n', 0.5), reward: 5000,
    colors: { skin: '#8d5524', shirt: '#e67e22', pants: '#34495e', hat: '#f1c40f' },
    p: { truck: park(1, 9, 'n', 0.5), dest: park(9, 3, 's', 0.5), destName: 'the Eastside cold store', time: 110 },
    lines: {
      offer: L('job.dock.offer', 'Pete Okafor', "The boss wants a crate of, uh, fish at the Eastside cold store, and my truck's the only thing with room. I can't leave my post. Take it across town before the clock runs out and I'll make it worth your while."),
      done: L('job.dock.done', 'Pete Okafor', 'Still fresh? Sure. Fish. You are a lifesaver.'),
      damaged: L('job.dock.damaged', 'Pete Okafor', "Lot of rattling in that crate. Fish don't do that. Half pay, and I never saw you."),
    },
  },
  {
    id: 'witness', name: 'Lenny Vasco', title: 'THE WITNESS', at: curb(9, 5, 'n', 0.5), reward: 7000,
    colors: { skin: '#ffdbac', shirt: '#95a5a6', pants: '#5d4037', hat: null },
    p: { dest: park(3, 6, 's', 0.5), time: 170, heat: 2 },
    lines: {
      offer: L('job.witness.offer', 'Lenny Vasco', 'Psst. Over here. I saw something I was not supposed to see, and now two cops want me quiet and the other two want me to testify. I need a ride to the courthouse. Now. Please.'),
      board: L('job.witness.board', 'Lenny Vasco', "Go go go! Drive! Everyone's looking at us!"),
      done: L('job.witness.done', 'Lenny Vasco', "I'm in! I'm... I'm in! Thank you. Here, it's all I've got."),
    },
  },
  {
    id: 'racer', name: 'Dani Reyes', title: 'STREET RACE', at: curb(7, 9, 'n', 0.15), reward: 6000,
    colors: { skin: '#e0ac69', shirt: '#e74c3c', pants: '#111111', hat: '#111111' },
    p: { route: DANI_ROUTE, speed: 24, time: 150 },
    lines: {
      offer: L('job.racer.offer', 'Dani Reyes', "You drive like you've got somewhere to be. I've got a red Viper and a route across the docks and the east side. First to the finish takes the pot. Line up at the start."),
      go: L('job.racer.go', 'Dani Reyes', 'Three, two, one, go!'),
      done: L('job.racer.done', 'Dani Reyes', 'You beat me?! Fine. Fine! Take the pot. Rematch some day.'),
    },
  },
  {
    id: 'shop', name: 'Greta Holm', title: 'PROTECTION', at: curb(1, 6, 's', 0.8), reward: 4500,
    colors: { skin: '#ffdbac', shirt: '#9b59b6', pants: '#2d3436', hat: null },
    p: { hoods: 3, spot: curb(1, 6, 's', 0.3) },
    lines: {
      offer: L('job.shop.offer', 'Greta Holm', 'Three hoods keep leaning on my window and scaring off my customers. You look like someone they would listen to. Scare them off the front of my shop, would you?'),
      done: L('job.shop.done', 'Greta Holm', "Ha! Look at them run. Well, lie there. Thank you, dear. Here's something for the till."),
    },
  },
];

/** Kill frenzies: skull pickups. Pay once (saved in game.save.frenzies). */
export const FRENZIES = [
  { id: 'f1', name: 'DOWNTOWN FRENZY', at: curb(4, 5, 'e', 0.4), weapon: 'pistol', ammo: 60, kills: 8, time: 60, reward: 3000 },
  { id: 'f2', name: 'EASTSIDE FRENZY', at: curb(7, 2, 's', 0.5), weapon: 'uzi', ammo: 150, kills: 12, time: 50, reward: 5000 },
  { id: 'f3', name: 'WESTSIDE FRENZY', at: curb(1, 2, 'n', 0.5), weapon: 'shotgun', ammo: 30, kills: 8, time: 45, reward: 4000 },
  { id: 'f4', name: 'BARBECUE FRENZY', at: curb(5, 7, 'n', 0.5), weapon: 'flame', ammo: 120, kills: 8, time: 50, reward: 4500 },
  { id: 'f5', name: 'DOCKS FRENZY', at: curb(6, 9, 'n', 0.5), weapon: 'rocket', ammo: 10, kills: 10, time: 60, reward: 6000 },
  { id: 'f6', name: 'NORTH SIDE FRENZY', at: curb(3, 0, 's', 0.5), weapon: 'uzi', ammo: 200, kills: 15, time: 70, reward: 7000 },
].map((f) => {
  L('frenzy.' + f.id + '.start', 'Pager', `${f.name.charAt(0)}${f.name.slice(1).toLowerCase()}. ${f.kills} kills in ${f.time} seconds. Make some noise.`);
  return f;
});

/** Time-trial races: a checkpoint course (intersections), par time, first-beat reward. */
export const RACES = [
  { id: 'r1', name: 'DOWNTOWN DASH', nodes: [[3, 3], [7, 3], [7, 6], [3, 6], [3, 3]], target: 55, reward: 3000 },
  { id: 'r2', name: 'DOCKSIDE SPRINT', nodes: [[1, 7], [1, 10], [5, 10], [5, 8], [9, 8], [9, 10]], target: 65, reward: 3500 },
  { id: 'r3', name: 'NORTH SHORE RUN', nodes: [[0, 2], [0, 0], [10, 0], [10, 4], [8, 4], [8, 2]], target: 75, reward: 5000 },
].map((r) => {
  r.pts = r.nodes.map(([i, j]) => inter(i, j));
  L('race.' + r.id + '.start', 'Pager', `${r.name.charAt(0)}${r.name.slice(1).toLowerCase()}. Beat ${r.target} seconds. Clock starts when you cross the line.`);
  return r;
});

export const CONTACT_REPEAT = 0.4; // repeat jobs pay 40%
